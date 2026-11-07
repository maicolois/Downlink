import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import jsQR from 'jsqr';
import pngjs from 'pngjs';
import { createYouTubePairing } from '@/server/auth/youtube-pairing.js';

async function fixture(run) {
  let timestamp = 1_000_000;
  let context = { key: 'first-account', expiresAt: timestamp + 60 * 60 * 1000 };
  const origin = 'https://192.168.0.80:3443';
  const auth = { getContext: () => context };
  const pairing = createYouTubePairing({ youtubeAuth: auth, origin, now: () => timestamp });
  const app = express();
  app.use(express.json());
  // Exercise the authorization decisions without relying on a platform TLS tool.
  app.use((req, _res, next) => {
    req.socket.encrypted = req.headers['x-test-secure'] === 'yes';
    if (req.headers['x-test-host']) req.headers.host = req.headers['x-test-host'];
    next();
  });
  app.use('/pairing', pairing.router);
  app.get('/device', (req, res) => res.json({ device: pairing.device(req)?.id ?? null }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, { mobile = false, secure = true, originHeader, cookie, body, method = 'POST' } = {}) {
    return fetch(`${base}${route}`, {
      method,
      headers: {
        Origin: originHeader ?? (mobile ? origin : base),
        ...(mobile ? { 'X-Test-Host': '192.168.0.80:3443', 'X-Test-Secure': secure ? 'yes' : 'no' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  try { await run({ request, advance: ms => { timestamp += ms; }, setContext: value => { context = value; } }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('pairing requires the local computer, HTTPS, and the same origin; device credentials are revocable', async () => {
  await fixture(async ({ request, setContext }) => {
    assert.equal((await request('/pairing/code', { mobile: true })).status, 403);
    const codeResponse = await request('/pairing/code');
    const { code, qr } = await codeResponse.json();
    assert.match(code, /^\d{8}$/);
    assert.match(qr, /^data:image\/png;base64,/);
    const image = pngjs.PNG.sync.read(Buffer.from(qr.split(',')[1], 'base64'));
    const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
    assert.equal(decoded?.data, `https://192.168.0.80:3443/#youtube-pair=${code}`);
    assert.equal((await request('/pairing/connect', { mobile: true, secure: false, body: { code } })).status, 403);
    assert.equal((await request('/pairing/connect', { mobile: true, originHeader: 'https://example.com', body: { code } })).status, 403);
    const connected = await request('/pairing/connect', { mobile: true, body: { code } });
    assert.equal(connected.status, 200);
    const cookie = connected.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.ok((await (await request('/device', { mobile: true, method: 'GET', cookie })).json()).device);
    assert.equal((await (await request('/device', { mobile: true, secure: false, method: 'GET', cookie })).json()).device, null);
    assert.equal((await request('/pairing/connect', { mobile: true, body: { code } })).status, 401);
    setContext({ key: 'new-account', expiresAt: 99_999_999 });
    assert.equal((await (await request('/device', { mobile: true, method: 'GET', cookie })).json()).device, null);
  });
});

test('codes expire and are invalidated after five wrong attempts', async () => {
  await fixture(async ({ request, advance }) => {
    let { code } = await (await request('/pairing/code')).json();
    const wrong = code === '00000000' ? '00000001' : '00000000';
    for (let i = 0; i < 5; i++) assert.equal((await request('/pairing/connect', { mobile: true, body: { code: wrong } })).status, 401);
    assert.equal((await request('/pairing/connect', { mobile: true, body: { code } })).status, 401);
    ({ code } = await (await request('/pairing/code')).json());
    advance(3 * 60 * 1000);
    assert.equal((await request('/pairing/connect', { mobile: true, body: { code } })).status, 401);
  });
});
