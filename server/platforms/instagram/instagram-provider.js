import { PlatformProvider } from '@/server/platforms/common/platform-provider.js';
import { INSTAGRAM_URL_PATTERNS } from '@/shared/platform-patterns.js';
import { getInstagramStorySource, isValidInstagramStoryVideoId } from '@/shared/instagram-stories.js';
import { enrichInstagramViewCounts } from '@/server/platforms/instagram/instagram-view-count.js';
import { getInstagramCookieArgs } from '@/server/platforms/instagram/instagram-cookies.js';

export class InstagramProvider extends PlatformProvider {
  constructor({ cookiesFile = process.env.INSTAGRAM_COOKIES_FILE } = {}) {
    super({ name: 'instagram', patterns: INSTAGRAM_URL_PATTERNS });
    this.cookiesFile = cookiesFile;
  }

  getYtDlpArgs({ playlistItem = 1, url, videoId } = {}) {
    const story = getInstagramStorySource(url);
    if (story) {
      if (!isValidInstagramStoryVideoId(videoId)) {
        const error = new Error('Selecciona una story válida antes de descargarla.');
        error.code = 'INSTAGRAM_STORY_INVALID_ID';
        throw error;
      }
      return [
        '--ignore-config',
        story.kind === 'story' ? '--no-playlist' : '--yes-playlist',
        '--match-filters', `id = '${videoId}'`,
        ...getInstagramCookieArgs(this.cookiesFile),
      ];
    }
    // Ignore machine-wide configuration so an anonymous request cannot inherit a session.
    return ['--ignore-config', '--playlist-items', String(playlistItem), ...getInstagramCookieArgs(this.cookiesFile)];
  }

  normalizeUrl(url) {
    const story = getInstagramStorySource(url);
    if (story) return story.url;
    const normalized = super.normalizeUrl(url);
    try {
      const parsed = new URL(normalized);
      const match = parsed.pathname.match(/^\/(?:[^/]+\/)?(p|reels?|tv)\/([^/]+)/i);
      if (!match) return normalized;
      const type = /^reels?$/i.test(match[1]) ? 'reel' : match[1].toLowerCase();
      return `https://www.instagram.com/${type}/${match[2]}/`;
    } catch {
      return normalized;
    }
  }

  getInfoYtDlpArgs({ url } = {}) {
    const story = getInstagramStorySource(url);
    if (story) {
      return [
        '--ignore-config',
        story.kind === 'story' ? '--no-playlist' : '--yes-playlist',
        ...getInstagramCookieArgs(this.cookiesFile),
      ];
    }
    // Read the complete publication so every video in a carousel is available.
    // Image-only positions are reported as extraction errors by yt-dlp.
    return ['--ignore-config', '--yes-playlist', '--ignore-errors', ...getInstagramCookieArgs(this.cookiesFile)];
  }

  async enrichVideoInfos(infos, { url } = {}) {
    if (getInstagramStorySource(url)) return infos;
    return enrichInstagramViewCounts(infos);
  }
}
