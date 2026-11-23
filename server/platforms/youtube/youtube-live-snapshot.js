import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// A snapshot materializes one URL per fragment. Bound memory and temp-file use.
const MAX_FRAGMENTS = 500_000;
const MAX_LOOKBACK_SECONDS = 120 * 60 * 60;

// Refresh expiring media URLs without moving the saved endpoint or changing
// format selection. Write beside the private snapshot so rename is atomic.
export async function refreshYouTubeLiveSnapshot(infoFile, rawJson, { checkCancelled = () => {} } = {}) {
  let temporaryFile = null;
  try {
    checkCancelled();
    const snapshot = JSON.parse(await readFile(infoFile, 'utf8'));
    const fresh = typeof rawJson === 'string' ? JSON.parse(rawJson) : structuredClone(rawJson);
    if (typeof snapshot?.id !== 'string' || !snapshot.id || fresh?.id !== snapshot.id
        || !Array.isArray(snapshot.formats) || !snapshot.formats.length || !Array.isArray(fresh.formats)) {
      throw new Error('invalid snapshot');
    }
    const formats = new Map();
    for (const format of fresh.formats) {
      if (format.protocol !== 'http_dash_segments_generator') continue;
      if (typeof format.format_id !== 'string' || formats.has(format.format_id)) throw new Error('ambiguous format');
      formats.set(format.format_id, format);
    }
    for (const format of snapshot.formats) {
      checkCancelled();
      const replacement = formats.get(format.format_id);
      if (!replacement || format.protocol !== 'http_dash_segments' || !Array.isArray(format.fragments)
          || !format.fragments.length) throw new Error('missing format');
      for (const key of ['vcodec', 'acodec']) {
        if (format[key] && replacement[key] && format[key] !== replacement[key]) throw new Error('format changed');
      }
      const url = new URL(replacement.url);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com')) throw new Error('invalid host');
      format.url = url.toString();
      format.extra_param_to_segment_url = url.search.slice(1);
      url.search = '';
      format.fragment_base_url = url.toString();
      if (replacement.http_headers && typeof replacement.http_headers === 'object') format.http_headers = replacement.http_headers;
      else delete format.http_headers;
    }
    checkCancelled();
    temporaryFile = `${infoFile}.${randomUUID()}.tmp`;
    await writeFile(temporaryFile, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    checkCancelled();
    await rename(temporaryFile, infoFile);
    temporaryFile = null;
    return infoFile;
  } catch (error) {
    if (error?.code === 'JOB_CANCELLED') throw error;
    throw Object.assign(new Error('No se pudieron renovar los enlaces de esta captura del directo.'), {
      code: 'YOUTUBE_LIVE_SNAPSHOT_FAILED',
    });
  } finally {
    if (temporaryFile) await rm(temporaryFile, { force: true }).catch(() => {});
  }
}

/** Freeze the fragment lists at the current live edge for yt-dlp --load-info-json. */
export async function createYouTubeLiveSnapshot(rawJson, options = {}) {
  try {
    return await prepareSnapshot(rawJson, options);
  } catch (error) {
    if (error?.code === 'JOB_CANCELLED') throw error;
    const message = error?.message?.startsWith('El directo') || error?.message?.startsWith('No ') || error?.message?.startsWith('La información')
      ? error.message : 'No se pudo preparar la descarga del directo.';
    throw Object.assign(new Error(message), { code: 'YOUTUBE_LIVE_SNAPSHOT_FAILED' });
  }
}

async function prepareSnapshot(rawJson, {
  signal,
  checkCancelled = () => {},
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  checkCancelled();
  let info;
  try {
    info = typeof rawJson === 'string' ? JSON.parse(rawJson) : structuredClone(rawJson);
  } catch {
    throw new Error('No se pudo leer la información del directo.');
  }
  if (!info || info.live_status !== 'is_live' || !Array.isArray(info.formats)) {
    throw new Error('El vídeo ya no está en directo o no tiene formatos disponibles.');
  }
  if (Number.isFinite(info.release_timestamp) && now() / 1000 - info.release_timestamp > MAX_LOOKBACK_SECONDS) {
    throw new Error('El directo supera las 120 horas disponibles desde el inicio.');
  }
  const formats = info.formats.filter((format) => format.protocol === 'http_dash_segments_generator');
  if (!formats.length) throw new Error('No hay formatos del directo disponibles desde el inicio.');

  const heads = await Promise.all(formats.map(async (format) => {
    checkCancelled();
    let url;
    try { url = new URL(format.url); } catch { throw new Error('No se pudo consultar el directo.'); }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com')) {
      throw new Error('El directo tiene una dirección de vídeo no válida.');
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'HEAD', headers: format.http_headers || {}, redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      });
    } catch {
      checkCancelled();
      throw new Error('No se pudo consultar el estado del directo.');
    }
    checkCancelled();
    const value = response.headers.get('x-head-seqnum');
    if ((!response.ok && response.status < 500) || value === null || !/^\d+$/.test(value)) {
      throw new Error('No se pudo determinar hasta dónde está disponible el directo.');
    }
    const head = Number(value);
    if (!Number.isSafeInteger(head) || head < 0) throw new Error('La información del directo no es válida.');
    return head;
  }));
  // One common edge prevents one track extending beyond the other.
  const head = Math.min(...heads);
  if ((head + 1) * formats.length > MAX_FRAGMENTS) {
    throw new Error('El directo es demasiado largo para preparar una descarga desde el inicio.');
  }
  for (const format of formats) {
    checkCancelled();
    const base = new URL(format.url);
    // yt-dlp applies this per-format query to each relative fragment path.
    // Keeping the signed query once avoids duplicating it thousands of times.
    format.extra_param_to_segment_url = base.search.slice(1);
    base.search = '';
    format.fragment_base_url = base.toString();
    format.protocol = 'http_dash_segments';
    format.is_live = false;
    format.fragments = Array.from({ length: head + 1 }, (_, index) => ({ path: `?sq=${index}` }));
  }
  info.formats = formats;
  info.is_live = false;
  info.live_status = 'was_live';
  checkCancelled();
  const directory = await mkdtemp(join(tmpdir(), 'downlink-live-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  const infoFile = join(directory, 'snapshot.json');
  try {
    checkCancelled();
    await writeFile(infoFile, JSON.stringify(info), { mode: 0o600 });
    checkCancelled();
    return { infoFile, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
