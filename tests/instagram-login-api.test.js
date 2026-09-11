import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));

test('connected accounts isolate metadata, private downloads and revocation through the real API', { timeout: 25_000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-login-api-'));
  const logPath = path.join(temp, 'extractor.jsonl');
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', './tests/fixtures/instagram-login.mjs', 'server/index.js'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), YT_DLP_PATH: 'instagram-story-test-extractor',
      INSTAGRAM_COOKIES_FILE: '', STORY_FIXTURE_LOG: logPath },
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
    fs.rmSync(logPath, { force: true });
    fs.rmdirSync(temp);
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* starting */ }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, logs);

  function client() {
    let cookie = '';
    let csrf = '';
    return {
      async request(endpoint, body, overrides = {}) {
        const response = await fetch(base + endpoint, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { Cookie: cookie, Origin: base, 'X-CSRF-Token': csrf,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...overrides },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        if (endpoint.startsWith('/api/file/')) return { status: response.status, text: await response.text() };
        const data = await response.json();
        if (data.csrfToken) csrf = data.csrfToken;
        return { status: response.status, data, cache: response.headers.get('cache-control') };
      },
    };
  }
  const alice = client(), bob = client(), anonymous = client();
  for (const user of [alice, bob]) {
    assert.equal((await user.request('/api/instagram/session')).data.connected, false);
    assert.equal((await user.request('/api/instagram/login/start', {})).data.pending, true);
    const connected = await user.request('/api/instagram/login/complete', {});
    assert.equal(connected.data.connected, true);
    assert.equal(JSON.stringify(connected.data).includes('fixture-account'), false);
  }

  for (const url of ['@privatefixture', 'https://instagram.com/p/PrivatePost/']) {
    const [a, b, guest] = await Promise.all([
      alice.request('/api/info', { url }), bob.request('/api/info', { url }), anonymous.request('/api/info', { url }),
    ]);
    assert.equal(a.data.channel, 'fixture-account-1');
    assert.equal(b.data.channel, 'fixture-account-2');
    assert.notEqual(guest.status, 200);
    assert.equal(a.cache, 'no-store');
    assert.equal(b.cache, 'no-store');
    assert.equal((await alice.request('/api/info', { url }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  }
  assert.equal((await alice.request('/api/info', { url: '@privatefixture' }, { Origin: 'https://example.com' })).status, 403);

  const download = async (user, url) => {
    const start = await user.request('/api/download', { url, videoId: 'Story_B', playlistItem: url.startsWith('@') ? null : 1, format: 'mp4' });
    assert.equal(start.status, 200);
    const id = start.data.jobId;
    jobIds.push(id);
    for (let i = 0; i < 50; i++) {
      const result = await user.request(`/api/status/${id}`);
      if (result.data.status === 'ready') return id;
      assert.notEqual(result.data.status, 'error', result.data.error);
      await delay(50);
    }
    assert.fail('Download did not finish');
  };
  const storyId = await download(alice, '@privatefixture');
  const postId = await download(bob, 'https://instagram.com/p/PrivatePost/');
  assert.equal((await bob.request(`/api/status/${storyId}`)).status, 404);
  assert.equal((await anonymous.request(`/api/file/${storyId}`)).status, 404);
  assert.equal((await bob.request(`/api/file/${storyId}`)).status, 404);
  assert.match((await alice.request(`/api/file/${storyId}`)).text, /fixture-account-1/);
  assert.match((await bob.request(`/api/file/${postId}`)).text, /fixture-account-2/);

  const disconnected = await alice.request('/api/instagram/disconnect', {});
  assert.equal(disconnected.data.connected, false);
  assert.equal((await alice.request(`/api/status/${storyId}`)).status, 404);
  assert.equal((await alice.request(`/api/file/${storyId}`)).status, 404);
  assert.equal(fs.existsSync(path.join(root, 'downloads', `${storyId}.mp4`)), false);
  assert.equal((await bob.request(`/api/status/${postId}`)).status, 200);
  assert.equal((await alice.request('/api/info', { url: '@privatefixture' })).status, 401);
  await bob.request('/api/instagram/disconnect', {});
  assert.equal(fs.existsSync(path.join(root, 'downloads', `${postId}.mp4`)), false);

  const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  for (const args of calls.filter(args => args.includes('--cookies'))) {
    assert.ok(args.includes('--ignore-config'));
    assert.equal(fs.existsSync(args[args.indexOf('--cookies') + 1]), false, 'Temporary cookies must be removed');
  }
  assert.doesNotMatch(logs, /fixture-account-\d|ultimate-converter-instagram-/);
});
