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

test('YouTube retries missing formats with manifests but does not retry authentication failures', { timeout: 20_000 }, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-fallback-'));
  const logPath = path.join(temp, 'calls.jsonl');
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, [
    '--import', './scripts/register-aliases.mjs', '--import', './tests/fixtures/youtube-info-fallback.mjs', 'server/index.js',
  ], { cwd: root, windowsHide: true, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
    YT_DLP_PATH: 'youtube-info-fixture', YOUTUBE_FIXTURE_LOG: logPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const closed = once(child, 'exit');
  t.after(async () => { child.kill(); await closed; fs.rmSync(temp, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* starting */ }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.ok(ready, logs);
  const info = id => fetch(`${base}/api/info`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${id}` }) });
  const live = await info('livefixture');
  assert.equal(live.status, 200);
  const liveInfo = await live.json();
  assert.equal(liveInfo.title, 'Live fixture');
  assert.equal(liveInfo.isLive, true);
  assert.equal((await info('livefixture')).status, 200);
  assert.equal((await info('autherror12')).status, 401);
  const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const liveCalls = calls.filter(args => args.at(-1).includes('livefixture'));
  assert.equal(liveCalls.length, 4, 'Live metadata is refreshed instead of cached');
  assert.ok(liveCalls[0].includes('youtube:skip=hls,dash'));
  assert.ok(!liveCalls[1].includes('youtube:skip=hls,dash'));
  assert.ok(liveCalls.every(args => args.includes('--ignore-config')));
  assert.equal(calls.filter(args => args.at(-1).includes('autherror12')).length, 1);
});
