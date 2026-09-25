import { PlatformProvider } from '../common/platform-provider.js';
import { TWITCH_URL_PATTERNS } from '../../../shared/platform-patterns.js';
import { promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
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

      const manifestPath = path.join(options.tempDirectory, `${options.jobId}.twitch-unmuted.m3u8`);
      await fs.writeFile(manifestPath, prepared.playlist, 'utf8');
      return {
        url: pathToFileURL(manifestPath).href,
        ytDlpArgs: ['--enable-file-urls'],
        cleanup: async () => { try { await fs.unlink(manifestPath); } catch { /* Already cleaned up. */ } },
      };
    } catch {
      // Audio recovery is best effort. Twitch's original URL remains a valid
      // download source even if probing or preparing a local playlist fails.
      return fallback;
    }
  }
}
