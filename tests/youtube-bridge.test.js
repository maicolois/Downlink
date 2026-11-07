import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../browser-extension/youtube-bridge/background.js', import.meta.url), 'utf8');

function bridgeFixture(signedInInitially) {
  let listener;
  let signedIn = signedInInitially;
  let loginWindow = null;
  const calls = { created: 0, removed: 0, imported: [] };
  const chrome = {
    cookies: { getAll: async () => signedIn
      ? [{ domain: '.youtube.com', name: 'SAPISID', value: 'synthetic' }]
      : [] },
    storage: { session: {
      get: async () => ({ youtubeLoginWindowId: loginWindow }),
      set: async value => { loginWindow = value.youtubeLoginWindowId; },
      remove: async () => { loginWindow = null; },
    } },
    windows: {
      create: async () => { calls.created++; return { id: 17 }; },
      get: async id => ({ id }),
      remove: async () => { calls.removed++; },
    },
    runtime: { onMessage: { addListener: callback => { listener = callback; } } },
  };
  const fetch = async (_url, options) => {
    calls.imported.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ imported: true }) };
  };
  vm.runInNewContext(source, { chrome, fetch, URL, Set });
  const request = type => new Promise((resolve, reject) => {
    const accepted = listener({ type, endpoint: 'http://127.0.0.1:3000/api/youtube/chrome/capture/import',
      captureToken: 'a'.repeat(43) }, { tab: { url: 'http://127.0.0.1:3000/' } }, resolve);
    if (!accepted) reject(new Error('Bridge rejected the request'));
  });
  return { calls, request, signIn: () => { signedIn = true; } };
}

test('one connection request imports the existing YouTube session without opening a window', async () => {
  const fixture = bridgeFixture(true);
  const result = await fixture.request('downlink-youtube-login-start');
  assert.equal(result.connected, true);
  assert.equal(fixture.calls.created, 0);
  assert.equal(fixture.calls.imported.length, 1);
  assert.equal(fixture.calls.imported[0].cookies[0].name, 'SAPISID');
});

test('the same request opens a sign-in window when needed and imports after login', async () => {
  const fixture = bridgeFixture(false);
  const result = await fixture.request('downlink-youtube-login-start');
  assert.equal(result.pending, true);
  assert.equal(fixture.calls.created, 1);
  assert.equal(fixture.calls.imported.length, 0);
  fixture.signIn();
  const completed = await fixture.request('downlink-youtube-login-check');
  assert.equal(completed.connected, true);
  assert.equal(fixture.calls.imported.length, 1);
  assert.equal(fixture.calls.removed, 1);
});
