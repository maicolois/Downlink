import { PlatformProvider } from '../common/platform-provider.js';
import { TWITCH_URL_PATTERNS } from '../../../shared/platform-patterns.js';

export class TwitchProvider extends PlatformProvider {
  constructor() {
    super({ name: 'twitch', patterns: TWITCH_URL_PATTERNS });
  }

  getYtDlpArgs() {
    // Twitch VODs are HLS playlists with thousands of small fragments. Fetching
    // a few at a time avoids making multi-hour videos needlessly slow.
    return ['--concurrent-fragments', '8'];
  }

  getInfoYtDlpArgs() {
    // Fragment concurrency only affects the actual media download.
    return [];
  }
}
