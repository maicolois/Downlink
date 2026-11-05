import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));

async function startServer(t, host) {
  const reservation = net.createServer();
  reservation.listen(0, '0.0.0.0');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));

  const env = { ...process.env, PORT: String(port), YT_DLP_PATH: 'cancellable-test-extractor' };
  delete env.HOST;
  if (host !== undefined) env.HOST = host;
  const child = spawn(process.execPath, [
    '--import', './scripts/register-aliases.mjs',
    '--import', './tests/fixtures/cancellable-download.mjs',
    'server/index.js',
  ], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  const closed = once(child, 'exit');
  t.after(async () => {
    child.kill();
    await closed;
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) return port;
    } catch { /* Wait for the actual HTTP listener. */ }
    if (child.exitCode !== null) break;
    await delay(100);
  }
  assert.fail(`Server did not start: ${logs}`);
}

function connect(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(2_000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
    socket.once('timeout', () => socket.destroy(new Error('TCP connection timed out')));
  });
}

test('default server accepts IPv4 localhost and rejects a different local address', { timeout: 15_000 }, async t => {
  const port = await startServer(t);
  await connect('127.0.0.1', port);
  // A wildcard listener would also accept this address, without needing a LAN adapter.
  await assert.rejects(connect('127.0.0.2', port), { code: 'ECONNREFUSED' });
});

test('explicit wildcard host enables other addresses without enabling remote Instagram login', { timeout: 15_000 }, async t => {
  const port = await startServer(t, '0.0.0.0');
  const base = `http://127.0.0.2:${port}`;
  assert.equal((await fetch(base)).status, 200);
  const response = await fetch(`${base}/api/instagram/session`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).available, false);
});
