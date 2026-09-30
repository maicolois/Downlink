import { PlatformProvider } from '@/server/platforms/common/platform-provider.js';
import { YOUTUBE_URL_PATTERNS } from '@/shared/platform-patterns.js';

export class YouTubeProvider extends PlatformProvider {
  constructor() {
    super({
      name: 'youtube',
      patterns: YOUTUBE_URL_PATTERNS
    });
  }

  getInfoYtDlpArgs() {
    // Direct formats already contain the available resolutions. Avoid parsing
    // streaming manifests during metadata-only requests to return them sooner.
    return ['--extractor-args', 'youtube:skip=hls,dash'];
  }
}
