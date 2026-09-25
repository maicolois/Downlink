const MEDIA_SEGMENT = /\.(?:mp4|ts)(?:\?.*)?$/i;
const MUTED_SEGMENT = /-muted(?=\.(?:mp4|ts)(?:\?|$))/i;
const DVR_PLAYLIST = /\/index-dvr\.m3u8(?:\?|$)/i;
const AUDIO_BYTES_PER_SECOND_FLOOR = 8_000;
const MIN_SILENT_SEGMENT_LIMIT = 32 * 1024;

function parsePlaylist(text, playlistUrl) {
  const lines = String(text).split(/\r?\n/);
  const segments = [];
  let duration = 10;

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    const durationMatch = trimmed.match(/^#EXTINF:([\d.]+)/i);
    if (durationMatch) {
      duration = Number(durationMatch[1]) || 10;
      return;
    }
    if (!trimmed || trimmed.startsWith('#') || !MEDIA_SEGMENT.test(trimmed)) return;
    segments.push({
      lineIndex,
      reference: trimmed,
      url: new URL(trimmed, playlistUrl).href,
      duration,
    });
  });

  return { lines, segments };
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Twitch devolvió HTTP ${response.status} al leer la playlist.`);
  return response.text();
}

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch { /* The probe already has the headers it needs. */ }
}

async function probeUrl(url, fetchImpl, { method = 'GET', attempts = 3 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method });
      const result = {
        ok: response.status === 200,
        status: response.status,
        contentLength: Number(response.headers?.get?.('content-length')) || null,
      };
      await cancelBody(response);
      if (result.ok || response.status < 500) return result;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return { ok: false, status: null, contentLength: null };
}

async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function getFileName(reference, playlistUrl) {
  const url = new URL(reference, playlistUrl);
  return url.pathname.split('/').at(-1);
}

function addUnmutedSuffix(fileName) {
  return fileName.replace(/(\.(?:mp4|ts))$/i, '-unmuted$1');
}

function getCandidateFileNames(fileName, markedMuted) {
  if (!markedMuted) return [addUnmutedSuffix(fileName)];
  const original = fileName.replace(MUTED_SEGMENT, '');
  // Twitch's explicit -unmuted variant is directly readable by FFmpeg. Some
  // plain originals only exist in a CloudFront compression cache: fetch() can
  // probe them successfully, but FFmpeg receives 403 later and silently ends
  // the VOD early. Prefer the stable asset and keep the plain name as fallback.
  return [addUnmutedSuffix(original), original];
}

async function findAvailableReplacement(segment, playlistUrls, fetchImpl, markedMuted) {
  const fileName = getFileName(segment.reference, playlistUrls[0]);
  const candidateFileNames = getCandidateFileNames(fileName, markedMuted);

  for (const playlistUrl of playlistUrls) {
    for (const candidateFileName of candidateFileNames) {
      const candidateUrl = new URL(candidateFileName, playlistUrl).href;
      const probe = await probeUrl(candidateUrl, fetchImpl);
      if (probe.ok) return candidateUrl;
    }
  }
  return null;
}

function absolutizePlaylist(lines, playlistUrl) {
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith('#') && MEDIA_SEGMENT.test(trimmed)) {
      return new URL(trimmed, playlistUrl).href;
    }
    return line.replace(/URI="([^"]+)"/gi, (match, uri) => {
      if (/^(?:data:|https?:)/i.test(uri)) return match;
      return `URI="${new URL(uri, playlistUrl).href}"`;
    });
  }).join('\n');
}

async function findSilentAudioIndices(audioPlaylistUrl, fetchImpl, concurrency) {
  const text = await fetchText(audioPlaylistUrl, fetchImpl);
  const { segments } = parsePlaylist(text, audioPlaylistUrl);
  const probes = await mapConcurrent(segments, concurrency, segment => (
    probeUrl(segment.url, fetchImpl, { method: 'HEAD' })
  ));

  const unavailableProbe = probes.find(probe => !probe.ok || probe.contentLength === null);
  if (unavailableProbe) {
    throw new Error('No se pudo comprobar que todos los fragmentos de audio de Twitch estén íntegros.');
  }

  return segments.flatMap((segment, index) => {
    const silentLimit = Math.max(MIN_SILENT_SEGMENT_LIMIT, segment.duration * AUDIO_BYTES_PER_SECOND_FLOOR);
    return probes[index].contentLength < silentLimit ? [index] : [];
  });
}

export async function buildTwitchUnmutedPlaylist({
  playlistUrl,
  candidatePlaylistUrls = [playlistUrl],
  audioPlaylistUrl = null,
  fetchImpl = fetch,
  concurrency = 12,
} = {}) {
  const uniquePlaylistUrls = [...new Set([playlistUrl, ...candidatePlaylistUrls].filter(Boolean))];
  const text = await fetchText(playlistUrl, fetchImpl);
  const parsed = parsePlaylist(text, playlistUrl);
  const markedMutedIndices = parsed.segments.flatMap((segment, index) => (
    MUTED_SEGMENT.test(segment.reference) ? [index] : []
  ));

  let mutedIndices = markedMutedIndices;
  let markedMuted = true;
  if (!mutedIndices.length && audioPlaylistUrl && DVR_PLAYLIST.test(playlistUrl)) {
    mutedIndices = await findSilentAudioIndices(audioPlaylistUrl, fetchImpl, concurrency);
    markedMuted = false;
  }

  if (!mutedIndices.length) {
    return {
      changed: false,
      mutedCount: 0,
      replacedCount: 0,
      unavailableCount: 0,
      playlist: text,
    };
  }

  if (mutedIndices.some(index => !parsed.segments[index])) {
    throw new Error('Las playlists de vídeo y audio de Twitch no contienen los mismos fragmentos.');
  }
  const mutedSegments = mutedIndices.map(index => parsed.segments[index]);
  const replacements = await mapConcurrent(mutedSegments, concurrency, segment => (
    findAvailableReplacement(segment, uniquePlaylistUrls, fetchImpl, markedMuted)
  ));
  const unavailable = replacements.filter(replacement => !replacement).length;

  mutedSegments.forEach((segment, index) => {
    // Keep Twitch's existing fragment when its preserved original no longer
    // exists. A missing recovery candidate must never cancel the download.
    if (replacements[index]) parsed.lines[segment.lineIndex] = replacements[index];
  });

  return {
    changed: replacements.some(Boolean),
    mutedCount: mutedSegments.length,
    replacedCount: replacements.length - unavailable,
    unavailableCount: unavailable,
    playlist: absolutizePlaylist(parsed.lines, playlistUrl),
  };
}

export function isTwitchMediaPlaylist(value) {
  try {
    return /^https?:$/i.test(new URL(value).protocol) && /\.m3u8(?:\?|$)/i.test(value);
  } catch {
    return false;
  }
}
