import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const secureOrigin = 'https://192.0.2.1:3443';

test('paired iPhone can hand only its prepared YouTube file to a separate browser', { timeout: 25_000 }, async t => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [
    '--import', './scripts/register-aliases.mjs',
    '--import', './tests/fixtures/youtube-paired-download.mjs',
    'server/index.js',
  ], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), YT_DLP_PATH: 'youtube-paired-fixture' },
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const closed = once(child, 'exit');
  const jobIds = [];
  t.after(async () => {
    child.kill();
    await closed;
    for (const id of jobIds) fs.rmSync(path.join(root, 'downloads', `${id}.mp4`), { force: true });
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* starting */ }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, logs);

  async function request(endpoint, { body, mobile = false, cookie = '', origin, method } = {}) {
    return fetch(base + endpoint, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(mobile ? { 'X-Fixture-Secure': 'yes' } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const localPost = (endpoint, body = {}) => request(endpoint, { body, origin: base });
  const capture = await (await localPost('/api/youtube/chrome/capture/start')).json();
  const imported = await request('/api/youtube/chrome/capture/import', {
    body: { captureToken: capture.captureToken, cookies: [{ domain: '.youtube.com', path: '/', name: 'SAPISID',
      value: 'synthetic-account', secure: true, expirationDate: Date.now() / 1000 + 3600 }] },
    origin: `chrome-extension://${'a'.repeat(32)}`,
  });
  assert.equal(imported.status, 200, logs);
  const { code } = await (await localPost('/api/youtube/pairing/code')).json();
  const connected = await request('/api/youtube/pairing/connect', { mobile: true, origin: secureOrigin, body: { code } });
  assert.equal(connected.status, 200, logs);
  const cookie = connected.headers.get('set-cookie').split(';')[0];

  async function prepare() {
    const start = await request('/api/download', {
      mobile: true, origin: secureOrigin, cookie,
      body: { url: 'https://youtu.be/abcdefghijk', youtubeBrowser: 'chrome', format: 'mp4', quality: 'best' },
    });
    assert.equal(start.status, 200, logs);
    const { jobId } = await start.json();
    jobIds.push(jobId);
    for (let i = 0; i < 60; i++) {
      const response = await request(`/api/status/${jobId}`, { mobile: true, cookie });
      assert.equal(response.status, 200, logs);
      const status = await response.json();
      if (status.status === 'ready') return { jobId, status };
      assert.notEqual(status.status, 'error', status.error || logs);
      await delay(50);
    }
    assert.fail(logs);
  }
  const first = await prepare();
  const second = await prepare();
  const token = first.status.fileAccess?.token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const file = `/api/file/${first.jobId}`;
  assert.equal((await request(file, { mobile: true })).status, 404);
  assert.equal((await request(`${file}?access=${'x'.repeat(43)}`, { mobile: true })).status, 404);
  assert.equal((await request(`${file}?access=${token}`)).status, 404);
  assert.equal((await request(`${file}?access=${token}`, { mobile: true, origin: 'https://example.com' })).status, 404);
  assert.equal((await request(`/api/file/${second.jobId}?access=${token}`, { mobile: true })).status, 404);
  assert.equal((await request(`/api/status/${first.jobId}?access=${token}`, { mobile: true })).status, 404);
  assert.equal((await request(`/api/cancel/${first.jobId}?access=${token}`, { mobile: true, body: {}, origin: secureOrigin })).status, 404);
  const delivered = await request(`${file}?access=${token}`, { mobile: true });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await delivered.text(), 'protected youtube fixture');

  assert.equal((await request('/api/youtube/pairing/disconnect', { mobile: true, cookie, origin: secureOrigin, body: {} })).status, 200);
  assert.equal((await request(`${file}?access=${token}`, { mobile: true })).status, 404);
});
