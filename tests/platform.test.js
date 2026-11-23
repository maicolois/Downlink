import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadClipboard, getMp4Target, readClipboard } from '@/public/js/platform.js';

test('preserves MP4 on desktop while mobile, native and unknown clients remain compatible', () => {
  const nav = (userAgent, extra = {}) => ({ navigator: { userAgent, ...extra } });
  assert.equal(getMp4Target(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')), 'original');
  assert.equal(getMp4Target(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', { platform: 'MacIntel', maxTouchPoints: 0 })), 'original');
  assert.equal(getMp4Target(nav('Mozilla/5.0 (X11; Linux x86_64) Chrome/130')), 'original');
  assert.equal(getMp4Target(nav('Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/130')), 'compatible');
  assert.equal(getMp4Target(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/605')), 'compatible');
  assert.equal(getMp4Target(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', { platform: 'MacIntel', maxTouchPoints: 5 })), 'compatible');
  assert.equal(getMp4Target(nav('Mozilla/5.0 (Windows NT 10.0)', { userAgentData: { mobile: true } })), 'compatible');
  assert.equal(getMp4Target(nav('Mozilla/5.0 (X11; Linux x86_64)', { userAgentData: { mobile: false, platform: 'Android' } })), 'compatible');
  assert.equal(getMp4Target({ DownlinkNative: {}, navigator: { userAgent: 'Windows NT 10.0' } }), 'compatible');
  assert.equal(getMp4Target({ navigator: { userAgent: 'unknown' } }), 'compatible');
  assert.equal(getMp4Target({}), 'compatible');
});

test('only exposes automatic clipboard reads in native or secure browser contexts', async () => {
  const insecure = {
    isSecureContext: false,
    navigator: { clipboard: { readText: async () => 'private' } },
  };
  assert.equal(canReadClipboard(insecure), false);
  await assert.rejects(readClipboard(insecure), { name: 'NotAllowedError' });

  const secure = {
    isSecureContext: true,
    navigator: { clipboard: { readText: async () => 'https://example.com/video' } },
  };
  assert.equal(canReadClipboard(secure), true);
  assert.equal(await readClipboard(secure), 'https://example.com/video');

  const native = {
    isSecureContext: false,
    DownlinkNative: { readClipboard: async () => 'native-value' },
  };
  assert.equal(canReadClipboard(native), true);
  assert.equal(await readClipboard(native), 'native-value');
});
