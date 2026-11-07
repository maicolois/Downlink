import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveDownload } from '@/public/js/platform.js';

test('iOS forwards a scoped file grant to Safari without forwarding a referrer', async () => {
  const names = ['navigator', 'document', 'DownlinkNative'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const links = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'iPhone', platform: 'iPhone' } });
  Object.defineProperty(globalThis, 'DownlinkNative', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => { const link = { style: {}, click() { this.clicked = true; }, remove() {} }; links.push(link); return link; },
    body: { appendChild() {} },
  } });
  try {
    const token = 'a'.repeat(43);
    await saveDownload('job-id', 'video.mp4', { token });
    assert.equal(links[0].href, `/api/file/job-id?access=${token}`);
    assert.equal(links[0].target, '_blank');
    assert.match(links[0].rel, /noreferrer/);
    assert.equal(links[0].clicked, true);
    await saveDownload('public-job', 'video.mp4');
    assert.equal(links[1].href, '/api/file/public-job');
    await saveDownload('job-id', 'video.mp4', { token: 'invalid&extra=1' });
    assert.equal(links[2].href, '/api/file/job-id');
  } finally {
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
