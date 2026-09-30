import { PlatformProvider } from '@/server/platforms/common/platform-provider.js';
import { REDDIT_URL_PATTERNS } from '@/shared/platform-patterns.js';

export class RedditProvider extends PlatformProvider {
  constructor() {
    super({ name: 'reddit', patterns: REDDIT_URL_PATTERNS });
  }

  getYtDlpArgs() {
    // Una publicación puede contener varios vídeos; el conversor procesa uno por trabajo.
    return ['--playlist-items', '1'];
  }
}
