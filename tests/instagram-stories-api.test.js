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

test('stories API analyzes, downloads the selected ID and reports access/expiry failures', { timeout: 20_000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'converter-stories-api-'));
  const logPath = path.join(temp, 'extractor.jsonl');
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['--import', './tests/fixtures/instagram-extractor.mjs', 'server/index.js'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PORT: String(port), YT_DLP_PATH: 'instagram-story-test-extractor',
      INSTAGRAM_COOKIES_FILE: '', STORY_FIXTURE_LOG: logPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const closed = once(child, 'exit');
  const jobs = [];
  t.after(async () => {
    child.kill();
    await closed;
    for (const jobId of jobs) fs.rmSync(path.join(root, 'downloads', `${jobId}.mp4`), { force: true });
    fs.rmSync(logPath, { force: true });
    fs.rmdirSync(temp);
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* starting */ }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, logs);
  const post = async (endpoint, body) => {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const download = async (url, videoId = 'Story_B') => {
    const start = await post('download', { url, videoId, format: 'mp4', quality: 'best' });
    assert.equal(start.status, 200);
    jobs.push(start.body.jobId);
    for (let i = 0; i < 50; i++) {
      const state = await (await fetch(`${base}/api/status/${start.body.jobId}`)).json();
      if (['ready', 'error'].includes(state.status)) return { ...state, jobId: start.body.jobId };
      await delay(50);
    }
    assert.fail('Download did not settle');
  };

  const info = await post('info', { url: '@fixtureuser' });
  assert.equal(info.status, 200);
  assert.equal(info.body.contentType, 'instagram-story');
  assert.equal(info.body.title, 'Story de @fixtureuser');
  assert.deepEqual(info.body.videos.map(video => video.id), ['Story_A', 'Story_B']);
  const selected = await download('https://www.instagram.com/fixtureuser/');
  assert.equal(selected.status, 'ready', selected.error);
  assert.match(selected.filename, /Story_B\.mp4$/);
  assert.equal(await (await fetch(`${base}/api/file/${selected.jobId}`)).text(), 'offline story fixture: Story_B');

  const single = await post('info', { url: 'https://www.instagram.com/stories/individual/123456/' });
  assert.equal(single.body.videoCount, 1);
  assert.equal(single.body.id, 'Story_B');
  assert.equal((await download('https://www.instagram.com/stories/individual/123456/')).status, 'ready');
  const highlight = await post('info', { url: 'https://www.instagram.com/stories/highlights/123456/' });
  assert.equal(highlight.body.videoCount, 2);
  assert.equal((await download('https://www.instagram.com/stories/highlights/123456/')).status, 'ready');

  for (const url of ['@expired', '@missing']) {
    const result = await download(url);
    assert.equal(result.status, 'error');
    assert.match(result.error, /ya no está disponible/);
    assert.equal(fs.existsSync(path.join(root, 'downloads', `${result.jobId}.mp4`)), false);
  }
  const login = await post('info', { url: '@authuser' });
  assert.equal(login.status, 401);
  assert.equal(login.body.code, 'INSTAGRAM_LOGIN_REQUIRED');
  const empty = await post('info', { url: '@photos' });
  assert.equal(empty.status, 404);
  assert.equal(empty.body.code, 'INSTAGRAM_STORIES_EMPTY');
  for (const videoId of [undefined, '', "Story_B' | id != 'Story_B", 123, {}]) {
    assert.equal((await post('download', { url: '@fixtureuser', videoId, format: 'mp4' })).status, 400);
  }
  const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.filter(args => !args.includes('--version')).every(args => args.includes('--ignore-config')));
  assert.ok(calls.some(args => args.includes('--dump-single-json') && args.at(-1) === 'https://www.instagram.com/stories/fixtureuser/'));
  assert.ok(calls.filter(args => args.includes('-o')).every(args => args.includes('--match-filters') && !args.includes('--playlist-items')));
  assert.equal(calls.filter(args => args.includes('-o') && args.at(-1).includes('/missing/')).length, 0);
});
