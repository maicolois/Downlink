import { PlatformProvider } from '../common/platform-provider.js';
import { TWITCH_URL_PATTERNS } from '../../../shared/platform-patterns.js';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { probeTwitchSource } from './twitch-source.js';
import { buildTwitchUnmutedPlaylist, isTwitchMediaPlaylist } from './twitch-unmute.js';

function getDirectTwitchFormat(format) {
  return isTwitchMediaPlaylist(format?.url)
    ? { ...format, is_downlink_direct: true }
    : format;
}

function getAudioSourceUrl(formats) {
  const audio = formats.find(format => (
    format?.url
    && (format.vcodec === 'none' || /^audio[_ ]only$/i.test(String(format.format_id || '')))
    && format.acodec !== 'none'
  ));
  return audio?.is_downlink_direct ? audio.url : null;
}

export async function serveTwitchPlaylist(playlist, token = randomUUID()) {
  const body = Buffer.from(String(playlist), 'utf8');
  const requestPath = `/${encodeURIComponent(token)}.m3u8`;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (!['GET', 'HEAD'].includes(request.method || '') || pathname !== requestPath) {
      response.writeHead(404, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': body.length,
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });

  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  server.on('error', () => { /* A failed temporary listener falls back on cleanup. */ });
  server.unref();

  const address = server.address();
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}${requestPath}`,
    cleanup: async () => {
      if (closed) return;
      closed = true;
      await new Promise(resolve => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}

export class TwitchProvider extends PlatformProvider {
  constructor({ sourceProbe = probeTwitchSource } = {}) {
    super({ name: 'twitch', patterns: TWITCH_URL_PATTERNS });
    this.sourceProbe = sourceProbe;
  }

  getYtDlpArgs({ format, quality, video } = {}) {
    // yt-dlp's native HLS downloader concatenates Twitch's fragmented MP4
    // segments verbatim. Some hardware decoders then display low resolutions
    // (notably 160p) as green video. FFmpeg muxes the same streams into a
    // standard MP4 while downloading, without re-encoding or losing quality.
    const candidates = video?.videoFormats || [];
    const selected = format === 'mp4'
      ? (quality === 'best'
          ? candidates.find(candidate => candidate.sourceUrl)
          : candidates.find(candidate => String(candidate.height) === String(quality)))
      : null;
    const compatibilityTag = /^(?:hevc|h265)$/i.test(String(selected?.vcodec || ''))
      ? ' -tag:v hvc1'
      : '';
    return [
      '--downloader', 'm3u8:ffmpeg',
      '--downloader-args', `ffmpeg:-progress pipe:2 -nostats${compatibilityTag}`,
    ];
  }

  getInfoYtDlpArgs() {
    // Fragment concurrency only affects the actual media download.
    return [];
  }

  async enrichVideoInfos(infos) {
    return Promise.all(infos.map(async info => {
      const extractedFormats = Array.isArray(info.formats) ? info.formats : [];
      const formats = extractedFormats.map(getDirectTwitchFormat);
      const audioSourceUrl = getAudioSourceUrl(formats);
      const enrichedInfo = {
        ...info,
        formats,
        ...(audioSourceUrl ? { downlink_audio_url: audioSourceUrl } : {}),
      };

      try {
        const source = await this.sourceProbe(extractedFormats);
        if (!source) return enrichedInfo;
        const directSource = getDirectTwitchFormat(source);
        const alreadyListed = formats.some(format => Number(format.height) === Number(source.height));
        return alreadyListed ? enrichedInfo : { ...enrichedInfo, formats: [...formats, directSource] };
      } catch {
        // Twitch metadata remains usable when its unadvertised source cannot be probed.
        return enrichedInfo;
      }
    }));
  }

  getDownloadUrl({ url, format, quality, video } = {}) {
    if (format === 'mp3') return video?.audioSourceUrl || url;
    if (format !== 'mp4') return url;
    const candidates = video?.videoFormats || [];
    const selected = quality === 'best'
      ? candidates.find(candidate => candidate.sourceUrl)
      : candidates.find(candidate => String(candidate.height) === String(quality));
    return selected?.sourceUrl || url;
  }

  async prepareDownload(options = {}) {
    const downloadUrl = this.getDownloadUrl(options);
    const fallback = { url: downloadUrl, ytDlpArgs: [], cleanup: null };
    if (!isTwitchMediaPlaylist(downloadUrl)) {
      return fallback;
    }

    try {
      const videoFormats = options.video?.videoFormats || [];
      const selectedIndex = options.format === 'mp4'
        ? videoFormats.findIndex(candidate => candidate.sourceUrl === downloadUrl)
        : -1;
      const candidatePlaylistUrls = options.format === 'mp4'
        ? videoFormats.slice(Math.max(0, selectedIndex)).map(candidate => candidate.sourceUrl).filter(Boolean)
        : [downloadUrl];
      const prepared = await buildTwitchUnmutedPlaylist({
        playlistUrl: downloadUrl,
        candidatePlaylistUrls,
        audioPlaylistUrl: options.video?.audioSourceUrl || null,
      });
      if (!prepared.changed) return fallback;

      const served = await serveTwitchPlaylist(prepared.playlist, options.jobId || randomUUID());
      return {
        url: served.url,
        ytDlpArgs: [],
        cleanup: served.cleanup,
      };
    } catch {
      // Audio recovery is best effort. Twitch's original URL remains a valid
      // download source even if probing or preparing a local playlist fails.
      return fallback;
    }
  }
}
