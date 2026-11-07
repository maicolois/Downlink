import test from 'node:test';
import assert from 'node:assert/strict';
import { detectYouTubeExtensionBrowser } from '@/public/js/components/youtube-extension-help.js';

const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36';
const safariUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';

test('identifies Chromium browsers before the shared Chrome/Safari user-agent tokens', async () => {
  for (const [userAgent, id, extensionsUrl] of [
    [chromeUA, 'chrome', 'chrome://extensions'],
    [`${chromeUA} Edg/142.0`, 'edge', 'edge://extensions'],
    [`${chromeUA} OPR/124.0`, 'opera', 'opera://extensions'],
    [`${chromeUA} Vivaldi/7.6`, 'vivaldi', 'vivaldi://extensions'],
    [chromeUA.replace('Chrome/', 'Chromium/'), 'chromium', 'chrome://extensions'],
  ]) {
    const browser = await detectYouTubeExtensionBrowser({ userAgent });
    assert.equal(browser.id, id);
    assert.equal(browser.extensionsUrl, extensionsUrl);
    assert.equal(browser.mobile, false);
  }
});

test('uses browser brands and Brave detection when the user agent only reveals Chrome', async () => {
  for (const [brand, id] of [['Microsoft Edge', 'edge'], ['Brave', 'brave'], ['Opera', 'opera'], ['Vivaldi', 'vivaldi']]) {
    const browser = await detectYouTubeExtensionBrowser({ userAgent: chromeUA,
      userAgentData: { brands: [{ brand: 'Chromium' }, { brand }] } });
    assert.equal(browser.id, id);
  }
  assert.equal((await detectYouTubeExtensionBrowser({ userAgent: chromeUA,
    brave: { isBrave: async () => true } })).id, 'brave');
  assert.equal((await detectYouTubeExtensionBrowser({ userAgent: chromeUA,
    brave: { isBrave: async () => { throw new Error('Unavailable'); } } })).id, 'chrome');
});

test('recognizes mobile devices including desktop-mode iPad and iOS browser variants', async () => {
  for (const browserNavigator of [
    { userAgent: chromeUA, userAgentData: { mobile: true } },
    { userAgent: chromeUA.replace('Windows NT 10.0; Win64; x64', 'Linux; Android 14') },
    { userAgent: safariUA, platform: 'MacIntel', maxTouchPoints: 5 },
    { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/142.0 Mobile/15E148 Safari/604.1' },
    { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 EdgiOS/142.0 Mobile/15E148 Safari/604.1' },
  ]) assert.equal((await detectYouTubeExtensionBrowser(browserNavigator)).mobile, true);
  assert.equal((await detectYouTubeExtensionBrowser({ userAgent: safariUA, maxTouchPoints: 0 })).mobile, false);
});

test('does not invent an installation URL for Safari, Firefox or an unknown browser', async () => {
  for (const [userAgent, id] of [[safariUA, 'safari'], ['Mozilla/5.0 Gecko/20100101 Firefox/142.0', 'firefox'], ['', 'unknown']]) {
    const browser = await detectYouTubeExtensionBrowser({ userAgent });
    assert.equal(browser.id, id);
    assert.equal(browser.extensionsUrl, undefined);
  }
});
