import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const DEFAULT_FFPROBE_PATH = require('ffprobe-static').path;
const TWITCH_QUALITY_SEGMENT = /^(?:chunked|\d+p(?:\d+)?)$/i;

function parseFrameRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const frameRate = numerator / denominator;
  return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null;
}

export function deriveTwitchSourceUrl(formats = []) {
  const candidates = formats
    .filter(format => format?.url && /^m3u8/i.test(String(format.protocol || '')))
    .sort((left, right) => (Number(right.height) || 0) - (Number(left.height) || 0));

  for (const format of candidates) {
    try {
      const sourceUrl = new URL(format.url);
      const segments = sourceUrl.pathname.split('/');
      const qualityIndex = segments.findIndex(segment => TWITCH_QUALITY_SEGMENT.test(segment));
      if (qualityIndex < 0 || segments[qualityIndex].toLowerCase() === 'chunked') continue;
      segments[qualityIndex] = 'chunked';
      sourceUrl.pathname = segments.join('/');
      return sourceUrl.toString();
    } catch { /* Ignore malformed extractor URLs. */ }
  }

  return null;
}

export async function probeTwitchSource(
  formats,
  { spawnImpl = spawn, ffprobePath = DEFAULT_FFPROBE_PATH, timeoutMs = 10_000 } = {},
) {
  const url = deriveTwitchSourceUrl(formats);
  if (!url) return null;

  return new Promise(resolve => {
    const proc = spawnImpl(ffprobePath, [
      '-v', 'error',
      '-read_intervals', '%+1',
      '-show_entries', 'stream=codec_name,codec_type,width,height,avg_frame_rate',
      '-of', 'json',
      url,
    ], { windowsHide: true });
    let stdout = '';
    let settled = false;

    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* Process already finished. */ }
      finish(null);
    }, timeoutMs);
    timer.unref?.();

    proc.stdout?.on('data', chunk => {
      if (stdout.length < 1_000_000) stdout += chunk.toString();
    });
    proc.once('error', () => finish(null));
    proc.once('close', code => {
      if (code !== 0) return finish(null);
      try {
        const result = JSON.parse(stdout);
        const streams = Array.isArray(result.streams) ? result.streams : [];
        const video = streams.find(stream => stream.codec_type === 'video');
        const audio = streams.find(stream => stream.codec_type === 'audio');
        const width = Number(video?.width);
        const height = Number(video?.height);
        if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
          return finish(null);
        }

        finish({
          format_id: 'chunked',
          format_note: 'Source',
          url,
          protocol: 'm3u8_native',
          ext: 'mp4',
          width,
          height,
          fps: parseFrameRate(video.avg_frame_rate),
          vcodec: video.codec_name || 'unknown',
          acodec: audio?.codec_name || 'unknown',
          is_downlink_source: true,
        });
      } catch {
        finish(null);
      }
    });
  });
}
