import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import express from 'express';
import { createYouTubeAuth } from '@/server/auth/youtube-auth.js';

const fixtures = new Set();

async function fixture(options = {}) {
  const auth = createYouTubeAuth(options);
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/youtube', auth.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const value = {
    auth,
    base,
    async request(route, { method = 'GET', origin = base, body } = {}) {
      return fetch(`${base}/api/youtube${route}`, {
        method,
        headers: {
          ...(origin ? { Origin: origin } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    async close() {
      await auth.dispose();
      await new Promise(resolve => server.close(resolve));
    },
  };
  fixtures.add(value);
  return value;
}

afterEach(async () => {
  await Promise.allSettled([...fixtures].map(value => value.close()));
  fixtures.clear();
});

function authorizedCookies() {
  return [
    {
      domain: '.youtube.com', path: '/', name: 'SAPISID', value: 'local-account-cookie',
      secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 3600,
    },
    {
      domain: '.youtube.com', path: '/', name: 'PREF', value: 'hl=es',
      secure: true, httpOnly: false, expirationDate: Date.now() / 1000 + 3600,
    },
    {
      domain: '.example.com', path: '/', name: 'foreign', value: 'must-not-leave-chrome',
      secure: true, expirationDate: Date.now() / 1000 + 3600,
    },
  ];
}

async function connectChrome(f) {
  const started = await f.request('/chrome/capture/start', { method: 'POST', body: {} });
  assert.equal(started.status, 200);
  const { captureToken } = await started.json();
  const imported = await f.request('/chrome/capture/import', {
    method: 'POST',
    origin: `chrome-extension://${'a'.repeat(32)}`,
    body: { captureToken, cookies: authorizedCookies() },
  });
  assert.equal(imported.status, 200);
  return captureToken;
}

test('Chrome import is explicit, YouTube-only, in-memory, and uses an isolated temporary jar', async () => {
  const f = await fixture();
  assert.equal((await (await f.request('/session')).json()).connected, false);
  await connectChrome(f);
  const context = f.auth.getContext();
  assert.ok(context?.key);

  let cookiePath;
  await f.auth.withCookieFile(context, async file => {
    cookiePath = file;
    const contents = await fs.readFile(file, 'utf8');
    assert.match(contents, /^# Netscape HTTP Cookie File/m);
    assert.match(contents, /\.youtube\.com/);
    assert.match(contents, /local-account-cookie/);
    assert.doesNotMatch(contents, /example\.com|must-not-leave-chrome/);
  });
  await assert.rejects(fs.access(cookiePath));
  await assert.rejects(fs.access(path.dirname(cookiePath)));
});

test('capture tokens, extension origin, account cookies, and disconnect are enforced', async () => {
  const f = await fixture();
  assert.equal((await f.request('/chrome/capture/start', {
    method: 'POST', origin: 'https://example.com', body: {},
  })).status, 403);

  const started = await f.request('/chrome/capture/start', { method: 'POST', body: {} });
  const { captureToken } = await started.json();
  assert.equal((await f.request('/chrome/capture/import', {
    method: 'POST', origin: f.base, body: { captureToken, cookies: authorizedCookies() },
  })).status, 403);
  assert.equal((await f.request('/chrome/capture/import', {
    method: 'POST', origin: `chrome-extension://${'b'.repeat(32)}`,
    body: { captureToken: 'x'.repeat(43), cookies: authorizedCookies() },
  })).status, 409);
  assert.equal((await f.request('/chrome/capture/import', {
    method: 'POST', origin: `chrome-extension://${'b'.repeat(32)}`,
    body: { captureToken, cookies: [{ domain: '.youtube.com', name: 'PREF', value: 'x', path: '/' }] },
  })).status, 409);

  await connectChrome(f);
  const context = f.auth.getContext();
  assert.equal((await f.request('/disconnect', { method: 'POST', body: {} })).status, 200);
  assert.equal(f.auth.isCurrent(context), false);
  await assert.rejects(f.auth.withCookieFile(context, async () => {}), {
    code: 'YOUTUBE_CHROME_SESSION_EXPIRED',
  });
});

test('the normal Chrome login popup receives a longer one-time capture window', async () => {
  let timestamp = 1_000;
  const f = await fixture({
    now: () => timestamp,
    captureTtlMs: 10,
    popupCaptureTtlMs: 100,
  });
  const regular = await (await f.request('/chrome/capture/start', {
    method: 'POST', body: {},
  })).json();
  const popup = await (await f.request('/chrome/capture/start', {
    method: 'POST', body: { mode: 'login' },
  })).json();

  timestamp += 20;
  assert.equal((await f.request('/chrome/capture/import', {
    method: 'POST',
    origin: `chrome-extension://${'c'.repeat(32)}`,
    body: { captureToken: regular.captureToken, cookies: authorizedCookies() },
  })).status, 409);
  assert.equal((await f.request('/chrome/capture/import', {
    method: 'POST',
    origin: `chrome-extension://${'c'.repeat(32)}`,
    body: { captureToken: popup.captureToken, cookies: authorizedCookies() },
  })).status, 200);
});

test('the Chrome extension is limited to YouTube and loopback origins', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const manifest = JSON.parse(await fs.readFile(
    path.join(root, 'browser-extension', 'youtube-bridge', 'manifest.json'), 'utf8',
  ));
  assert.deepEqual(manifest.permissions.sort(), ['cookies', 'storage']);
  assert.deepEqual(manifest.host_permissions.sort(), [
    'http://127.0.0.1/*',
    'http://localhost/*',
    'https://*.youtube.com/*',
    'https://youtube.com/*',
  ].sort());
  assert.equal(manifest.host_permissions.some(value => value.includes('<all_urls>')), false);
  const background = await fs.readFile(
    path.join(root, 'browser-extension', 'youtube-bridge', 'background.js'), 'utf8',
  );
  assert.match(background, /chrome\.windows\.create/);
  assert.match(background, /https:\/\/www\.youtube\.com\/signin/);
  assert.match(background, /chrome\.windows\.remove/);
  assert.doesNotMatch(background, /playwright|remote-debugging|no-sandbox/i);
});
