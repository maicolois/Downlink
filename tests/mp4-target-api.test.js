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

test('desktop keeps MP4 without extra transcode; mobile and missing targets stay compatible', { timeout: 20_000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp4-target-test-'));
  const log = path.join(temp, 'conversions.log');
  const formatLog = path.join(temp, 'formats.log');
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, [
    '--import', './scripts/register-aliases.mjs', '--import', './tests/fixtures/mp4-target.mjs', 'server/index.js',
  ], { cwd: root, windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
    YT_DLP_PATH: 'mp4-target-fixture', MP4_TARGET_LOG: log, MP4_FORMAT_LOG: formatLog }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const closed = once(child, 'exit');
  const jobs = [];
  t.after(async () => {
    child.kill();
    await closed;
    for (const id of jobs) {
      for (const file of fs.readdirSync(path.join(root, 'downloads'))) {
        if (file.startsWith(`${id}.`)) fs.rmSync(path.join(root, 'downloads', file), { force: true });
      }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* starting */ }
    await delay(50);
  }
  assert.ok(ready, logs);
  const post = (body, headers = {}) => fetch(`${base}/api/download`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const begin = async (extra, headers = {}) => {
    const response = await post({ url: 'https://www.youtube.com/watch?v=fixture1234', format: 'mp4', quality: 'best', ...extra }, headers);
    assert.equal(response.status, 200, logs);
    const { jobId } = await response.json(); jobs.push(jobId);
    for (let i = 0; i < 100; i++) {
      const state = await (await fetch(`${base}/api/status/${jobId}`)).json();
      if (state.status === 'ready' || state.status === 'error') return { jobId, state };
      await delay(50);
    }
    assert.fail(`job did not finish: ${logs}`);
  };
  const desktop = await begin({ mp4Target: 'original' }, { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  assert.equal(desktop.state.status, 'ready', logs);
  assert.equal(fs.readFileSync(path.join(root, 'downloads', `${desktop.jobId}.mp4`), 'utf8'), 'original-fixture');
  assert.equal(fs.existsSync(log), false, 'desktop does not run the conversion');

  const mobile = await begin({ mp4Target: 'original' }, { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  assert.equal(mobile.state.status, 'ready', logs);
  assert.equal(fs.readFileSync(path.join(root, 'downloads', `${mobile.jobId}.mp4`), 'utf8'), 'compatible-fixture');
  const fallback = await begin({});
  assert.equal(fallback.state.status, 'ready', logs);
  assert.equal(fs.readFileSync(path.join(root, 'downloads', `${fallback.jobId}.mp4`), 'utf8'), 'compatible-fixture');
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 2);

  const short = await begin({ url: 'https://www.twitch.tv/videos/1234567890', mp4Target: 'original' });
  assert.equal(short.state.status, 'error', 'Twitch duration check still rejects incomplete original');
  assert.match(short.state.error, /incompleta/i);
  for (const id of ['1234567891', '1234567892']) {
    const vod = await begin({ url: `https://www.twitch.tv/videos/${id}`, quality: '720', mp4Target: 'original' });
    assert.equal(vod.state.status, 'ready', logs);
    const args = JSON.parse(fs.readFileSync(formatLog, 'utf8').trim().split('\n').at(-1));
    assert.doesNotMatch(args[args.indexOf('-f') + 1], /height/,
      'a selected Twitch media playlist has no height metadata to filter');
    assert.equal(id.endsWith('2'), args.at(-1).startsWith('http://127.0.0.1:'),
      'the frozen playlist uses a local URL; the completed playlist stays direct');
  }
  for (const url of ['https://clips.twitch.tv/FixtureClip', 'https://www.youtube.com/watch?v=fixture1234']) {
    const result = await begin({ url, quality: '720', mp4Target: 'original' });
    assert.equal(result.state.status, 'ready', logs);
    const args = JSON.parse(fs.readFileSync(formatLog, 'utf8').trim().split('\n').at(-1));
    assert.match(args[args.indexOf('-f') + 1], /height<=720/,
      'unselected URLs must retain the quality constraint');
  }
  assert.equal((await post({ url: 'https://www.youtube.com/watch?v=fixture1234', format: 'mp4', mp4Target: 'bad' })).status, 400);
});
