import { PlatformProvider } from '@/server/platforms/common/platform-provider.js';
import { X_URL_PATTERNS } from '@/shared/platform-patterns.js';

export class XProvider extends PlatformProvider {
  constructor() {
    super({
      name: 'x',
      patterns: X_URL_PATTERNS
    });
  }
}
