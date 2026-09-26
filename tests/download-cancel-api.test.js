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

test('YouTube and Twitch report download details and cancellation removes partial files', { timeout: 20_000 }, async t => {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', './tests/fixtures/cancellable-download.mjs', 'server/index.js'], {
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), YT_DLP_PATH: 'cancellable-test-extractor', INSTAGRAM_COOKIES_FILE: '' }
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const closed = once(child, 'exit');
  const jobIds = [];

  t.after(async () => {
    child.kill();
    await closed;
    for (const jobId of jobIds) {
      for (const file of fs.readdirSync(path.join(root, 'downloads'))) {
        if (file.startsWith(`${jobId}.`)) fs.rmSync(path.join(root, 'downloads', file), { force: true });
      }
    }
  });

  let ready = false;
  for (let index = 0; index < 60; index += 1) {
    try {
      if ((await fetch(base)).ok) { ready = true; break; }
    } catch { /* Server is starting. */ }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, logs);

  const url = 'https://www.youtube.com/watch?v=abcdefghijk';
  const info = await fetch(`${base}/api/info`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
  });
  assert.equal(info.status, 200);

  const started = await fetch(`${base}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, format: 'mp4', quality: 'best' })
  });
  assert.equal(started.status, 200);
  const jobId = (await started.json()).jobId;
  jobIds.push(jobId);

  let partialAppeared = false;
  for (let index = 0; index < 50; index += 1) {
    partialAppeared = fs.readdirSync(path.join(root, 'downloads')).some(file => file.startsWith(`${jobId}.`));
    if (partialAppeared) break;
    await delay(25);
  }
  assert.equal(partialAppeared, true, logs);

  let progress;
  for (let index = 0; index < 50; index += 1) {
    progress = await (await fetch(`${base}/api/status/${jobId}`)).json();
    if (progress.progressDetail.includes('Velocidad:')) break;
    await delay(25);
  }
  assert.equal(progress.status, 'downloading');
  assert.equal(progress.progressDetail, 'Descargando archivo · Velocidad: 1 MB/s · 30 s restantes');

  const cancelled = await fetch(`${base}/api/cancel/${jobId}`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.deepEqual(await cancelled.json(), { status: 'cancelled' });

  const status = await (await fetch(`${base}/api/status/${jobId}`)).json();
  assert.equal(status.status, 'cancelled');
  assert.equal(status.progressDetail, 'Descarga cancelada');
  assert.equal(fs.readdirSync(path.join(root, 'downloads')).some(file => file.startsWith(`${jobId}.`)), false);
  assert.equal((await fetch(`${base}/api/file/${jobId}`)).status, 400);
  assert.equal((await fetch(`${base}/api/cancel/${jobId}`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${base}/api/cancel/unknown`, { method: 'POST' })).status, 404);

  const startingUrl = 'https://www.youtube.com/watch?v=lmnopqrstuv&slowmetadata=1';
  const starting = await fetch(`${base}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: startingUrl, format: 'mp4', quality: 'best' })
  });
  assert.equal(starting.status, 200);
  const startingJobId = (await starting.json()).jobId;
  jobIds.push(startingJobId);
  assert.equal((await fetch(`${base}/api/cancel/${startingJobId}`, { method: 'POST' })).status, 200);
  const startingStatus = await (await fetch(`${base}/api/status/${startingJobId}`)).json();
  assert.equal(startingStatus.status, 'cancelled');
  assert.equal(fs.readdirSync(path.join(root, 'downloads')).some(file => file.startsWith(`${startingJobId}.`)), false);

  const twitchStarted = await fetch(`${base}/api/download`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.twitch.tv/videos/1234567890', format: 'mp4', quality: 'best' }),
  });
  assert.equal(twitchStarted.status, 200);
  const twitchJobId = (await twitchStarted.json()).jobId;
  jobIds.push(twitchJobId);
  for (let index = 0; index < 50; index += 1) {
    progress = await (await fetch(`${base}/api/status/${twitchJobId}`)).json();
    if (progress.progressDetail.includes('Velocidad:')) break;
    await delay(25);
  }
  assert.equal(progress.status, 'downloading', logs);
  assert.equal(progress.progress, '25%');
  assert.match(progress.progressDetail, /^Descargando archivo · Velocidad: [\d,]+ (?:B|KB|MB)\/s · 23 s restantes$/);
  assert.equal((await fetch(`${base}/api/cancel/${twitchJobId}`, { method: 'POST' })).status, 200);
  assert.equal((await (await fetch(`${base}/api/status/${twitchJobId}`)).json()).status, 'cancelled');
  assert.equal(fs.readdirSync(path.join(root, 'downloads')).some(file => file.startsWith(`${twitchJobId}.`)), false);
});
