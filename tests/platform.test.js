import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadClipboard, readClipboard } from '@/public/js/platform.js';

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
