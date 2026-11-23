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

test('retains a failed live snapshot and resumes its same files until explicit cancellation', { timeout: 20_000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-retry-api-'));
  const logPath = path.join(temp, 'calls.jsonl');
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, [
    '--import', './scripts/register-aliases.mjs', '--import', './tests/fixtures/youtube-live-retry.mjs', 'server/index.js',
  ], { cwd: root, windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
    YT_DLP_PATH: 'youtube-live-fixture', YOUTUBE_RETRY_LOG: logPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const closed = once(child, 'exit');
  t.after(async () => {
    child.kill();
    await closed;
    if (fs.existsSync(logPath)) {
      const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      for (const { partial, infoFile } of calls) {
        if (path.dirname(partial) === path.join(root, 'downloads')) fs.rmSync(partial, { force: true });
        const directory = path.dirname(infoFile);
        if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('downlink-live-')) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
    }
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* starting */ }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, logs);
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const response = await post('/api/download', { url: 'https://www.youtube.com/live/livefixture', format: 'mp4', quality: '144' });
  assert.equal(response.status, 200);
  const { jobId } = await response.json();
  const waitForStatus = async (id, expected) => {
    for (let i = 0; i < 100; i++) {
      const status = await (await fetch(`${base}/api/status/${id}`)).json();
      if (status.status === expected) return status;
      await delay(50);
    }
    assert.fail(`Live job did not reach ${expected}: ${logs}`);
  };
  const error = await waitForStatus(jobId, 'error');
  assert.equal(error.retryable, true);
  assert.equal(error.failedFragment, 7);
  assert.equal(error.code, 'YOUTUBE_FRAGMENT_UNAVAILABLE');
  let calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].exists, false);
  assert.ok(fs.existsSync(calls[0].partial));
  assert.ok(fs.existsSync(calls[0].infoFile));
  const replies = await Promise.all([
    post(`/api/retry/${jobId}`), post(`/api/retry/${jobId}`),
  ]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409], 'parallel retry must not start a second worker');
  const retry = replies.find(reply => reply.status === 200);
  assert.equal((await retry.json()).jobId, jobId);
  const secondError = await waitForStatus(jobId, 'error');
  assert.equal(secondError.retryable, true);
  calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 6);
  assert.ok(calls.slice(1).every(call => call.infoFile === calls[0].infoFile));
  assert.ok(calls.slice(1).every(call => call.partial === calls[0].partial));
  assert.ok(calls.slice(1).every(call => call.exists));
  assert.deepEqual(calls.map(call => call.token), Array.from({ length: 6 }, (_, index) => `token=secret${index + 1}`));
  assert.ok(calls.every(call => call.count === 6 && call.last === '?sq=5'), 'retry must keep the original cutoff');
  const cancel = await post(`/api/cancel/${jobId}`);
  assert.equal(cancel.status, 200);
  assert.equal(fs.existsSync(calls[0].partial), false);
  assert.equal(fs.existsSync(calls[0].infoFile), false);
  assert.equal((await post(`/api/retry/${jobId}`)).status, 409);

  const secondJob = await (await post('/api/download', {
    url: 'https://www.youtube.com/live/livefixture', format: 'mp4', quality: '144',
  })).json();
  await waitForStatus(secondJob.jobId, 'error');
  fs.writeFileSync(`${logPath}.succeed`, 'yes');
  const resume = await post(`/api/retry/${secondJob.jobId}`);
  assert.equal(resume.status, 200);
  const finished = await waitForStatus(secondJob.jobId, 'ready');
  assert.equal(finished.retryable, false);
  calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
  const secondSnapshot = calls.at(-1).infoFile;
  assert.equal(fs.existsSync(secondSnapshot), false, 'successful job removes private snapshot');
  assert.equal((await post(`/api/cancel/${secondJob.jobId}`)).status, 200);
});
