import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createInstagramAuth } from '../server/auth/instagram-auth.js';

const COOKIE_NAME = 'uc_instagram_session';
const instant = 1_800_000_000_000;
const cookie = (value = 'fixture-session', overrides = {}) => ({
  name: 'sessionid', value, domain: '.instagram.com', path: '/',
  expires: instant / 1000 + 100_000, secure: true, httpOnly: true, ...overrides,
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t, options = {}) {
  let timestamp = instant;
  let latestContext = null;
  const handles = [];
  const revocations = [];
  const auth = createInstagramAuth({
    now: () => timestamp,
    launchLogin: async ({ signal }) => {
      const handle = {
        reads: 0, closes: 0, cookies: [cookie()], signal,
        context: { cookies: async url => {
          assert.equal(url, 'https://www.instagram.com/');
          handle.reads++;
          return handle.cookies;
        } },
        close: async () => { handle.closes++; },
        isClosed: () => handle.closes > 0,
      };
      handles.push(handle);
      return handle;
    },
    notifyRevoke: context => { revocations.push(context); },
    ...options,
  });
  const app = express();
  app.use(express.json());
  app.use('/api', auth.middleware);
  app.use('/api/instagram', auth.router);
  app.all('/api/context', (req, res) => {
    latestContext = auth.getContext(req);
    res.json(latestContext);
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await auth.dispose();
    await new Promise(resolve => server.close(resolve));
  });

  function client() {
    const state = { cookie: '', csrf: '' };
    async function request(endpoint, {
      method = 'GET', headers = {}, sendOrigin = true, sendCsrf = true, sendCookie = true,
    } = {}) {
      const response = await fetch(`${origin}/api/${endpoint}`, {
        method,
        headers: {
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          ...(sendOrigin ? { Origin: origin } : {}),
          ...(sendCookie && state.cookie ? { Cookie: state.cookie } : {}),
          ...(sendCsrf && state.csrf ? { 'X-CSRF-Token': state.csrf } : {}),
          ...headers,
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) state.cookie = setCookie.split(';')[0];
      const body = await response.json();
      if (body?.csrfToken) state.csrf = body.csrfToken;
      return { status: response.status, body, headers: response.headers };
    }
    return {
      state, request,
      status: () => request('instagram/session'),
      start: () => request('instagram/login/start', { method: 'POST' }),
      complete: () => request('instagram/login/complete', { method: 'POST' }),
      cancel: () => request('instagram/login/cancel', { method: 'POST' }),
      disconnect: () => request('instagram/disconnect', { method: 'POST' }),
    };
  }
  return { auth, handles, revocations, client, origin,
    getContext: () => latestContext, advance: value => { timestamp += value; } };
}

test('local sign-in reads the new browser only on confirmation and keeps connection material server-side', async t => {
  const f = await fixture(t);
  const user = f.client();
  const anonymous = await user.request('context');
  assert.equal(anonymous.body, null);
  assert.equal(anonymous.headers.get('set-cookie'), null);
  const initial = await user.status();
  assert.deepEqual({ ...initial.body, csrfToken: null }, {
    available: true, connected: false, pending: false, expiresAt: null, csrfToken: null,
  });
  assert.match(initial.headers.get('set-cookie'), /HttpOnly/);
  assert.match(initial.headers.get('set-cookie'), /SameSite=Strict/);
  assert.match(initial.headers.get('set-cookie'), /Path=\/api/);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  const oldCookie = user.state.cookie;
  const oldCsrf = user.state.csrf;

  assert.equal((await user.start()).body.pending, true);
  assert.equal(f.handles[0].reads, 0);
  await user.status();
  assert.equal(f.handles[0].reads, 0);
  assert.equal((await user.start()).status, 200);
  assert.equal(f.handles.length, 1);
  const complete = await user.complete();
  assert.equal(complete.body.connected, true);
  assert.equal(complete.body.pending, false);
  assert.equal(complete.body.expiresAt, instant + 8 * 60 * 60 * 1000);
  assert.equal(f.handles[0].reads, 1);
  assert.equal(f.handles[0].closes, 1);
  assert.equal(f.handles[0].signal.aborted, true);
  assert.notEqual(user.state.cookie, oldCookie);
  assert.notEqual(user.state.csrf, oldCsrf);
  assert.equal(JSON.stringify(complete.body).includes('fixture-session'), false);
  await user.request('context');
  const context = f.getContext();
  assert.deepEqual(Object.keys(context).sort(), ['expiresAt', 'key', 'ownerId']);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(f.auth.isCurrent(context), true);

  const stranger = f.client();
  assert.equal((await stranger.request('context')).body, null);
  assert.equal((await stranger.request('context', { headers: { Cookie: oldCookie } })).body, null);
  assert.equal((await stranger.status()).body.connected, false);
  assert.equal((await user.disconnect()).body.connected, false);
  assert.equal(f.auth.isCurrent(context), false);
  assert.deepEqual(f.revocations, [context]);
  await assert.rejects(f.auth.withCookieFile(context, () => {}), {
    code: 'INSTAGRAM_SESSION_EXPIRED', status: 401,
  });
});

test('incomplete, unrelated, malformed, or expired login cookies never connect an account', async t => {
  const f = await fixture(t);
  const user = f.client();
  await user.status();
  await user.start();
  const handle = f.handles[0];
  for (const invalid of [[], [cookie('', {})], [cookie('x', { domain: '.example.com' })],
    [cookie('x', { expires: instant / 1000 - 1 })], [cookie('x\nforeign-row')],
    [cookie('x', { domain: '.notinstagram.com' })]]) {
    handle.cookies = invalid;
    const result = await user.complete();
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'INSTAGRAM_LOGIN_INCOMPLETE');
    assert.equal((await user.status()).body.connected, false);
    assert.equal((await user.status()).body.pending, true);
  }
  handle.cookies = [cookie('valid', { expires: instant / 1000 + 50 })];
  assert.equal((await user.complete()).body.expiresAt, instant + 50_000);
});

test('local host, actual peer, same-origin, and CSRF checks protect connected API calls', async t => {
  const f = await fixture(t);
  const user = f.client();
  const remoteHost = await user.request('instagram/session', {
    headers: { Host: 'converter.example', Origin: 'http://converter.example' },
  });
  assert.equal(remoteHost.body.available, false);
  assert.equal(remoteHost.headers.get('set-cookie'), null);
  assert.equal((await user.request('instagram/login/start', { method: 'POST' })).status, 403);
  await user.status();
  for (const params of [{ sendOrigin: false }, { sendCsrf: false },
    { headers: { Origin: 'https://unrelated.example' } },
    { headers: { Host: 'converter.example', Origin: 'http://converter.example' } },
    { headers: { 'X-CSRF-Token': 'é'.repeat(43) } }]) {
    assert.equal((await user.request('instagram/login/start', { method: 'POST', ...params })).status, 403);
  }
  assert.equal(f.handles.length, 0);
  // Merely opening the session widget does not restrict anonymous conversion APIs.
  assert.equal((await user.request('context', { method: 'POST', sendOrigin: false, sendCsrf: false })).status, 200);
  await user.start();
  assert.equal((await user.request('context', { method: 'POST', sendCsrf: false })).status, 403);
  await user.complete();
  assert.equal((await user.request('context', { method: 'POST', sendCsrf: false })).status, 403);
  assert.equal((await user.request('context', { method: 'POST' })).status, 200);
  assert.equal((await user.request('context', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await user.request('context', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  let status;
  f.auth.middleware({
    socket: { remoteAddress: '203.0.113.10' }, method: 'GET',
    headers: { host: new URL(f.origin).host, origin: f.origin, cookie: user.state.cookie,
      'x-forwarded-for': '127.0.0.1' },
  }, { status(value) { status = value; return this; }, json() {} }, () => assert.fail('Remote peer was accepted'));
  assert.equal(status, 403);
});

test('each connection and extractor operation receives an isolated, temporary cookie copy', async t => {
  const f = await fixture(t);
  const first = f.client();
  const second = f.client();
  for (const [user, value] of [[first, 'first-private-session'], [second, 'second-private-session']]) {
    await user.status();
    await user.start();
    f.handles.at(-1).cookies = [cookie(value), cookie('unrelated', { domain: '.example.com' }),
      cookie('ignore-this', { name: 'stale', expires: instant / 1000 - 1 })];
    await user.complete();
  }
  await first.request('context');
  const firstContext = f.getContext();
  await second.request('context');
  const secondContext = f.getContext();
  assert.notEqual(firstContext.key, secondContext.key);
  assert.notEqual(firstContext.ownerId, secondContext.ownerId);
  const paths = [];
  await Promise.all([firstContext, firstContext, secondContext].map((context, index) =>
    f.auth.withCookieFile(context, async filePath => {
      paths.push(filePath);
      const jar = await fs.readFile(filePath, 'utf8');
      assert.match(jar, /^# Netscape HTTP Cookie File\n#HttpOnly_\.instagram\.com\tTRUE\t\/\tTRUE\t\d+\tsessionid\t/);
      assert.match(jar, index === 2 ? /second-private-session/ : /first-private-session/);
      assert.doesNotMatch(jar, /unrelated|ignore-this/);
      await fs.writeFile(filePath, 'extractor can update its own copy');
      await delay(5);
    })));
  assert.equal(new Set(paths).size, 3);
  for (const filePath of paths) await assert.rejects(fs.stat(filePath), { code: 'ENOENT' });
  let failedPath;
  await assert.rejects(f.auth.withCookieFile(firstContext, filePath => {
    failedPath = filePath;
    throw new Error('fixture extractor failure');
  }), /fixture extractor failure/);
  await assert.rejects(fs.stat(failedPath), { code: 'ENOENT' });
  await first.disconnect();
  assert.equal(f.auth.isCurrent(secondContext), true);
});

test('a cancelled browser launch closes when it arrives and cannot reconnect the account', async t => {
  const started = deferred();
  const release = deferred();
  const handle = { closes: 0, context: { cookies: async () => assert.fail('Cancelled login read cookies') },
    close: async () => { handle.closes++; } };
  const f = await fixture(t, { launchLogin: async ({ signal }) => {
    started.resolve(signal);
    await release.promise;
    return handle;
  } });
  const user = f.client();
  await user.status();
  const login = user.start();
  const signal = await started.promise;
  assert.equal((await user.cancel()).body.pending, false);
  assert.equal(signal.aborted, true);
  release.resolve();
  assert.equal((await login).status, 409);
  assert.equal(handle.closes, 1);
  assert.equal((await user.status()).body.connected, false);
});

test('concurrent confirmation and cancellation cannot revive a cancelled connection', async t => {
  const f = await fixture(t);
  const user = f.client();
  await user.status();
  await user.start();
  const started = deferred();
  const release = deferred();
  f.handles[0].context.cookies = async () => {
    started.resolve();
    await release.promise;
    return [cookie()];
  };
  const completing = user.complete();
  await started.promise;
  assert.equal((await user.complete()).status, 409);
  assert.equal((await user.cancel()).body.pending, false);
  release.resolve();
  assert.equal((await completing).status, 409);
  assert.equal((await user.status()).body.connected, false);
  assert.equal(f.handles[0].closes, 1);
});

test('expiry revokes connections and in-flight cookie operations, and pending sign-in closes automatically', async t => {
  const f = await fixture(t, { sessionTtlMs: 1_000, loginTtlMs: 500 });
  const user = f.client();
  await user.status();
  await user.start();
  f.advance(501);
  assert.equal((await user.status()).body.pending, false);
  await delay(0);
  assert.equal(f.handles[0].closes, 1);
  await user.start();
  await user.complete();
  await user.request('context');
  const context = f.getContext();
  let usedPath;
  await assert.rejects(f.auth.withCookieFile(context, async filePath => {
    usedPath = filePath;
    f.advance(1_001);
    return 'private response';
  }), { code: 'INSTAGRAM_SESSION_EXPIRED' });
  await assert.rejects(fs.stat(usedPath), { code: 'ENOENT' });
  assert.equal(f.auth.isCurrent(context), false);
  assert.deepEqual(f.revocations, [context]);
  assert.equal((await user.status()).body.connected, false);
});

test('closing the sign-in browser or disposing the service clears pending state without exposing launcher errors', async t => {
  const f = await fixture(t);
  const user = f.client();
  await user.status();
  await user.start();
  f.handles[0].closes++;
  assert.equal((await user.status()).body.pending, false);
  await user.start();
  await f.auth.dispose();
  assert.equal(f.handles[1].closes, 1);
  assert.equal((await user.status()).body.available, false);
  assert.equal((await user.start()).status, 403);

  const broken = await fixture(t, { launchLogin: () => { throw new Error('sensitive launcher details'); } });
  const other = broken.client();
  await other.status();
  const result = await other.start();
  assert.equal(result.status, 503);
  assert.doesNotMatch(result.body.error, /sensitive launcher details/);
  assert.equal((await other.status()).body.pending, false);
});

test('shutdown waits for active extractor operations to remove their temporary cookie files', { timeout: 5_000 }, async t => {
  const started = deferred();
  const revoked = deferred();
  const release = deferred();
  const f = await fixture(t, { notifyRevoke: context => { revoked.resolve(context); } });
  const user = f.client();
  await user.status();
  await user.start();
  await user.complete();
  await user.request('context');
  const context = f.getContext();
  let usedPath;
  const operation = assert.rejects(f.auth.withCookieFile(context, async filePath => {
    usedPath = filePath;
    started.resolve();
    await revoked.promise;
    // Simulate the extractor taking time to stop after its process is cancelled.
    await release.promise;
    throw new Error('fixture extractor terminated after revocation');
  }), { code: 'INSTAGRAM_SESSION_EXPIRED' });
  await started.promise;
  let disposed = false;
  const shutdown = f.auth.dispose().then(() => { disposed = true; });
  assert.deepEqual(await revoked.promise, context);
  await delay(10);
  assert.equal(disposed, false);
  assert.equal((await fs.stat(usedPath)).isFile(), true);
  release.resolve();
  await shutdown;
  await operation;
  await assert.rejects(fs.stat(usedPath), { code: 'ENOENT' });
  assert.equal(disposed, true);
});

for (const action of ['disconnect', 'replace', 'dispose']) {
  test(`${action} waits for asynchronous revocation cleanup after invalidating the old context`, { timeout: 5_000 }, async t => {
    const notified = deferred();
    const release = deferred();
    t.after(() => release.resolve());
    const f = await fixture(t, { notifyRevoke: async context => {
      notified.resolve(context);
      await release.promise;
    } });
    const user = f.client();
    await user.status();
    await user.start();
    await user.complete();
    await user.request('context');
    const context = f.getContext();
    if (action === 'replace') await user.start();
    let settled = false;
    const pending = (action === 'dispose' ? f.auth.dispose()
      : action === 'replace' ? user.complete() : user.disconnect()).then(result => {
      settled = true;
      return result;
    });
    assert.deepEqual(await notified.promise, context);
    assert.equal(f.auth.isCurrent(context), false);
    await delay(10);
    assert.equal(settled, false);
    release.resolve();
    const result = await pending;
    assert.equal(settled, true);
    if (action !== 'dispose') {
      assert.equal(result.status, 200);
      assert.equal(result.body.connected, action === 'replace');
      assert.equal(result.body.pending, false);
    }
  });
}
