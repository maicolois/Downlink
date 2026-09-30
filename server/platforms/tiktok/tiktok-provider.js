import { PlatformProvider } from '@/server/platforms/common/platform-provider.js';
import { TIKTOK_URL_PATTERNS } from '@/shared/platform-patterns.js';

export class TikTokProvider extends PlatformProvider {
  constructor() {
    super({ name: 'tiktok', patterns: TIKTOK_URL_PATTERNS });
  }

  normalizeUrl(url) {
    const normalized = new URL(super.normalizeUrl(url));
    if (['tiktok.com', 'm.tiktok.com'].includes(normalized.hostname)) {
      normalized.hostname = 'www.tiktok.com';
    }
    normalized.pathname = normalized.pathname.replace(/^\/embed\/v2\//, '/embed/');
    return normalized.href;
  }
}
