import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQrScanner } from '@/public/js/components/qr-scanner.js';

test('camera frames stay local, and the camera stops after a scan or cancellation', async () => {
  const names = ['window', 'document', 'navigator'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let stopped = 0;
  let resolveCamera;
  const camera = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const video = { hidden: true, readyState: 2, videoWidth: 640, videoHeight: 480, async play() {} };
  const frame = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
  const canvas = { getContext: () => ({ drawImage() {}, getImageData: () => frame }) };
  let decoded = null;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { jsQR: () => ({ data: 'local-qr' }) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => camera } } });
  try {
    const scanner = createQrScanner(video, { onCode: value => { decoded = value; }, onError: message => assert.fail(message) });
    await scanner.start();
    assert.equal(decoded, 'local-qr');
    assert.equal(stopped, 1);
    assert.equal(video.hidden, true);
    assert.equal(video.srcObject, null);

    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolveCamera = resolve; });
    const pending = scanner.start();
    scanner.stop();
    resolveCamera(camera);
    await pending;
    assert.equal(stopped, 2, 'a camera that opens after cancellation is stopped immediately');
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
