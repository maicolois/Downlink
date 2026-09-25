import {
  getDisplayResolution,
  getVideoResolutionLabel,
} from '../../../shared/video-resolutions.js';

function mergePlaylistEntry(entry, parent, fallbackIndex) {
  const { entries: _parentEntries, ...parentInfo } = parent;
  const { entries: childEntries, ...entryInfo } = entry;

  return {
    ...parentInfo,
    ...entryInfo,
    ...(Array.isArray(childEntries) ? { entries: childEntries } : {}),
    title: entry.title || parent.title,
    uploader: entry.uploader || parent.uploader,
    channel: entry.channel || parent.channel,
    thumbnail: entry.thumbnail || parent.thumbnail,
    duration: getVideoDuration(entry) ?? getVideoDuration(parent),
    duration_string: entry.duration_string || parent.duration_string,
    view_count: getViewCount(entry) ?? getViewCount(parent),
    playlist_index: entry.playlist_index ?? fallbackIndex,
  };
}

function hasDownloadableVideo(info) {
  if (!info || typeof info !== 'object') return false;
  if (info.vcodec && info.vcodec !== 'none') return true;

  if (Array.isArray(info.formats)) {
    return info.formats.some(format => format && (
      (format.vcodec && format.vcodec !== 'none')
      || /^(?:mp4|mov|mkv|webm|m4v)$/i.test(String(format.ext || ''))
    ));
  }

  return /^(?:mp4|mov|mkv|webm|m4v)$/i.test(String(info.ext || ''));
}

function collectPlaylistVideos(info) {
  if (!Array.isArray(info.entries)) return [info];

  const videos = [];
  info.entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const merged = mergePlaylistEntry(entry, info, index + 1);
    if (Array.isArray(merged.entries)) {
      videos.push(...collectPlaylistVideos(merged));
    } else if (hasDownloadableVideo(merged)) {
      videos.push(merged);
    }
  });
  return videos;
}

export function parseVideoInfoCollection(raw) {
  const info = JSON.parse(raw);
  if (!info || typeof info !== 'object') {
    throw new Error('No se pudo leer la información del vídeo.');
  }

  const videos = collectPlaylistVideos(info);
  if (!videos.length) {
    throw new Error('La publicación no contiene un vídeo descargable.');
  }
  return videos;
}

export function parseVideoInfo(raw) {
  return parseVideoInfoCollection(raw)[0];
}

function parseDurationString(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parts = value.trim().split(':');
  if (!parts.every(part => /^\d+(?:\.\d+)?$/.test(part))) return null;

  return parts.reduce((seconds, part) => (seconds * 60) + Number(part), 0);
}

function getDurationFromMediaUrl(value) {
  if (typeof value !== 'string' || !value.includes('efg=')) return null;

  try {
    const encodedMetadata = new URL(value).searchParams.get('efg');
    if (!encodedMetadata) return null;

    const metadata = JSON.parse(Buffer.from(encodedMetadata, 'base64').toString('utf8'));
    const duration = Number(metadata.duration_s ?? metadata.duration);
    return Number.isFinite(duration) && duration >= 0 ? duration : null;
  } catch {
    return null;
  }
}

export function getVideoDuration(info) {
  if (!info || typeof info !== 'object') return null;

  const directDuration = info.duration;
  if (directDuration !== null && directDuration !== '' && directDuration !== undefined) {
    const duration = Number(directDuration);
    if (Number.isFinite(duration) && duration >= 0) return duration;
  }

  const durationFromString = parseDurationString(info.duration_string);
  if (durationFromString !== null) return durationFromString;

  const mediaUrls = [
    info.url,
    ...(Array.isArray(info.formats) ? info.formats.map(format => format?.url) : []),
  ];
  for (const mediaUrl of mediaUrls) {
    const duration = getDurationFromMediaUrl(mediaUrl);
    if (duration !== null) return duration;
  }

  return null;
}

export function getVideoFormats(info) {
  const formats = new Map();
  const candidates = Array.isArray(info.formats) && info.formats.length ? info.formats : [info];
  for (const format of candidates) {
    if (format.vcodec === 'none') continue;
    const height = Number(format.height);
    if (!Number.isInteger(height) || height <= 0 || formats.has(height)) continue;
    const width = Number(format.width);
    const displayResolution = getDisplayResolution(
      width,
      height,
      format.format_note || format.resolution || format.format
    );
    formats.set(height, {
      height,
      label: getVideoResolutionLabel(displayResolution),
      filesize_approx: format.filesize_approx || format.filesize || null,
      ...((format.is_downlink_source || format.is_downlink_direct) && format.url
        ? {
            sourceUrl: format.url,
            ...(format.vcodec ? { vcodec: format.vcodec } : {}),
          }
        : {}),
    });
  }
  return formats.size
    ? [...formats.values()].sort((a, b) => b.height - a.height)
    : [{ height: 'best', label: 'Mejor disponible', filesize_approx: null }];
}

export function getViewCount(info) {
  if (!info || typeof info !== 'object') return null;

  const candidates = [
    info.view_count,
    info.play_count,
    info.video_view_count,
    info.video_play_count,
    info.ig_play_count,
    info.fb_play_count,
    info.views,
    info.plays,
    info.statistics?.view_count,
    info.statistics?.play_count,
    info.media?.view_count,
    info.media?.play_count,
  ];

  for (const value of candidates) {
    if (value === null || value === '' || value === undefined) continue;
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return count;
  }

  return null;
}
