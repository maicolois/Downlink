import { PlatformProvider } from '@/server/platforms/common/platform-provider.js';
import { YOUTUBE_URL_PATTERNS } from '@/shared/platform-patterns.js';
import { getYouTubeBrowserArgs, normalizeYouTubeBrowser } from '@/server/platforms/youtube/youtube-browser.js';

export class YouTubeProvider extends PlatformProvider {
  constructor({ browser = null, cookiesFile = null, denoPath = null, nodePath = null } = {}) {
    super({
      name: 'youtube',
      patterns: YOUTUBE_URL_PATTERNS
    });
    this.browser = normalizeYouTubeBrowser(browser);
    this.cookiesFile = typeof cookiesFile === 'string' && cookiesFile ? cookiesFile : null;
    this.usesLocalSession = Boolean(this.browser || this.cookiesFile);
    this.denoPath = typeof denoPath === 'string' && denoPath ? denoPath : null;
    this.nodePath = typeof nodePath === 'string' && nodePath ? nodePath : null;
  }

  getRuntimeArgs() {
    if (this.denoPath) return ['--js-runtimes', `deno:${this.denoPath}`];
    return this.nodePath ? ['--js-runtimes', `node:${this.nodePath}`] : [];
  }

  getAuthArgs() {
    return this.cookiesFile
      ? ['--cookies', this.cookiesFile]
      : getYouTubeBrowserArgs(this.browser);
  }

  getInfoYtDlpArgs() {
    // Direct formats already contain the available resolutions. Avoid parsing
    // streaming manifests during metadata-only requests to return them sooner.
    return [
      '--ignore-config',
      ...this.getRuntimeArgs(),
      '--extractor-args', 'youtube:skip=hls,dash',
      ...this.getAuthArgs(),
    ];
  }

  getYtDlpArgs() {
    // Do not let a global yt-dlp config silently inject a cookie jar or a
    // different browser. Downlink's explicit local selection is authoritative.
    return ['--ignore-config', ...this.getRuntimeArgs(), ...this.getAuthArgs()];
  }
}
