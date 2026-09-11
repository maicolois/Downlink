import express from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COOKIE_NAME = 'uc_instagram_session';
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;
const token = () => randomBytes(32).toString('base64url');

function authError(message, status = 401, code = 'INSTAGRAM_SESSION_EXPIRED') {
  return Object.assign(new Error(message), { status, code });
}

function localOrigin(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return null;
  const host = req.headers.host;
  if (typeof host !== 'string' || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return null;
  try {
    return new URL(`${req.socket.encrypted ? 'https' : 'http'}://${host}`).origin;
  } catch {
    return null;
  }
}

function sameOrigin(req, { requireOrigin = false } = {}) {
  const expected = localOrigin(req);
  if (!expected || req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  return origin === undefined ? !requireOrigin : origin === expected;
}

function readSessionToken(req) {
  const parts = String(req.headers.cookie || '').split(';');
  const matches = parts.map(part => part.trim()).filter(part => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function validCsrf(req, session) {
  const supplied = req.headers['x-csrf-token'];
  if (typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken));
}

function instagramCookies(cookies, timestamp) {
  if (!Array.isArray(cookies)) return [];
  return cookies.filter(cookie => {
    if (!cookie || typeof cookie.domain !== 'string') return false;
    const domain = cookie.domain.toLowerCase().replace(/^\./, '');
    if (domain !== 'instagram.com' && !domain.endsWith('.instagram.com')) return false;
    if (!/^[a-z0-9.-]+$/.test(domain)) return false;
    if (![cookie.name, cookie.value, cookie.path || '/'].every(value => typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value))) return false;
    if (!cookie.name || (cookie.expires > 0 && cookie.expires * 1000 <= timestamp)) return false;
    return true;
  }).map(cookie => ({
    domain: cookie.domain.toLowerCase(), path: cookie.path || '/', name: cookie.name,
    value: cookie.value, expires: Number.isFinite(cookie.expires) ? cookie.expires : -1,
    secure: cookie.secure === true, httpOnly: cookie.httpOnly === true,
  }));
}

function cookieJar(cookies) {
  return '# Netscape HTTP Cookie File\n' + cookies.map(cookie => [
    `${cookie.httpOnly ? '#HttpOnly_' : ''}${cookie.domain}`,
    cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE', cookie.path,
    cookie.secure ? 'TRUE' : 'FALSE', cookie.expires > 0 ? Math.floor(cookie.expires) : 0,
    cookie.name, cookie.value,
  ].join('\t')).join('\n') + '\n';
}

// The user signs in directly on Instagram in a new, visible, temporary browser.
// No existing browser profile, login form, password, or network interception is used.
async function launchInstagramLogin({ signal }) {
  const { chromium } = await import('playwright-core');
  for (const channel of ['chrome', 'msedge']) {
    if (signal.aborted) throw authError('La conexión se ha cancelado.', 409, 'INSTAGRAM_LOGIN_CANCELLED');
    let browser;
    try {
      browser = await chromium.launch({ channel, headless: false, timeout: 15_000 });
    } catch {
      continue;
    }
    let closing;
    const close = () => {
      if (!closing) {
        signal.removeEventListener('abort', onAbort);
        closing = browser.close().catch(() => {});
      }
      return closing;
    };
    const onAbort = () => { void close(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal.aborted) throw new Error('cancelled');
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (signal.aborted) throw new Error('cancelled');
      return { context, close, isClosed: () => !browser.isConnected() };
    } catch {
      await close();
      if (signal.aborted) throw authError('La conexión se ha cancelado.', 409, 'INSTAGRAM_LOGIN_CANCELLED');
      throw authError('No se pudo abrir Instagram. Comprueba la conexión e inténtalo de nuevo.', 503, 'INSTAGRAM_LOGIN_UNAVAILABLE');
    }
  }
  throw authError('Instala Google Chrome o Microsoft Edge en este ordenador para conectar Instagram.', 503, 'INSTAGRAM_LOGIN_UNAVAILABLE');
}

/**
 * Local-only, per-browser Instagram connections, held in memory until logout/expiry.
 * launchLogin may be injected for tests; it returns { context, close, isClosed? }.
 * notifyRevoke receives the same public { ownerId, key, expiresAt } as getContext.
 */
export function createInstagramAuth({
  launchLogin = launchInstagramLogin, now = Date.now, notifyRevoke = () => {},
  sessionTtlMs = EIGHT_HOURS, loginTtlMs = FIVE_MINUTES, cleanupIntervalMs = 30_000,
} = {}) {
  const sessions = new Map();
  const requests = new WeakMap();
  const closes = new Set();
  const launches = new Set();
  const cookieOperations = new Set();
  const revocations = new Set();
  const router = express.Router();
  let disposed = false;
  const sessionLifetime = Math.min(EIGHT_HOURS, Math.max(1, sessionTtlMs));
  const loginLifetime = Math.min(FIVE_MINUTES, Math.max(1, loginTtlMs));

  function publicContext(session) {
    return session.connection ? Object.freeze({
      ownerId: session.ownerId, key: session.connection.key, expiresAt: session.connection.expiresAt,
    }) : null;
  }

  function closeHandle(handle) {
    if (!handle || handle.closedByApp) return Promise.resolve();
    handle.closedByApp = true;
    const close = Promise.resolve().then(() => handle.close()).catch(() => {});
    closes.add(close);
    close.finally(() => closes.delete(close));
    return close;
  }

  function cancelPending(session) {
    const pending = session.pending;
    if (!pending) return Promise.resolve();
    session.pending = null;
    pending.controller.abort();
    return closeHandle(pending.handle);
  }

  function revoke(session) {
    const context = publicContext(session);
    session.connection = null;
    if (!context) return Promise.resolve();
    let revocation;
    try {
      revocation = Promise.resolve(notifyRevoke(context)).catch(() => {});
    } catch { /* Revocation must succeed even if a consumer has already stopped. */
      return Promise.resolve();
    }
    revocations.add(revocation);
    revocation.finally(() => revocations.delete(revocation));
    return revocation;
  }

  function cleanSession(session) {
    if (disposed || session.expiresAt <= now()) {
      revoke(session);
      void cancelPending(session);
      sessions.delete(session.token);
      return false;
    }
    if (session.connection?.expiresAt <= now()) revoke(session);
    if (session.pending && (session.pending.expiresAt <= now() || session.pending.handle?.isClosed?.())) {
      void cancelPending(session);
    }
    return true;
  }

  function setSessionCookie(req, res, session) {
    res.cookie(COOKIE_NAME, session.token, {
      httpOnly: true, sameSite: 'strict', secure: Boolean(req.socket.encrypted),
      path: '/api', maxAge: Math.max(0, session.expiresAt - now()),
    });
  }

  function newSession(req, res) {
    const session = {
      token: token(), ownerId: randomUUID(), csrfToken: token(),
      expiresAt: now() + sessionLifetime, connection: null, pending: null,
    };
    sessions.set(session.token, session);
    requests.set(req, session);
    setSessionCookie(req, res, session);
    return session;
  }

  function rotateSession(req, res, session) {
    sessions.delete(session.token);
    session.token = token();
    session.csrfToken = token();
    session.expiresAt = now() + sessionLifetime;
    sessions.set(session.token, session);
    setSessionCookie(req, res, session);
  }

  function getSession(req) {
    const session = requests.get(req);
    return session && cleanSession(session) ? session : null;
  }

  function state(req, session) {
    return {
      available: !disposed && sameOrigin(req), connected: Boolean(session?.connection),
      pending: Boolean(session?.pending), expiresAt: session?.connection?.expiresAt ?? null,
      csrfToken: session?.csrfToken ?? null,
    };
  }

  function sendState(req, res, session) {
    res.set('Cache-Control', 'no-store');
    res.json(state(req, session && cleanSession(session) ? session : null));
  }

  function middleware(req, res, next) {
    const session = sessions.get(readSessionToken(req));
    if (session && cleanSession(session)) {
      // The app's permissive anonymous API CORS never applies to account data.
      if ((session.connection || session.pending)
          && (!sameOrigin(req, { requireOrigin: !['GET', 'HEAD', 'OPTIONS'].includes(req.method) })
          || (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !validCsrf(req, session)))) {
        return res.status(403).json({ error: 'La conexión de Instagram solo está disponible desde esta aplicación local.', code: 'INSTAGRAM_LOCAL_ONLY' });
      }
      requests.set(req, session);
      res.set('Cache-Control', 'no-store');
    }
    next();
  }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.path === '/session') return next();
    if (disposed || !sameOrigin(req, { requireOrigin: true })) {
      return res.status(403).json({ error: 'Conecta Instagram desde localhost en el ordenador donde ejecutas la aplicación.', code: 'INSTAGRAM_LOCAL_ONLY' });
    }
    const session = getSession(req);
    if (!session || !validCsrf(req, session)) {
      return res.status(403).json({ error: 'Actualiza la página antes de conectar Instagram.', code: 'INSTAGRAM_CSRF_INVALID' });
    }
    next();
  });

  router.get('/session', (req, res) => {
    if (disposed || !sameOrigin(req)) return sendState(req, res, null);
    sendState(req, res, getSession(req) || newSession(req, res));
  });

  router.post('/login/start', async (req, res) => {
    const session = getSession(req);
    if (session.pending) return sendState(req, res, session);
    const pending = { controller: new AbortController(), expiresAt: now() + loginLifetime, handle: null, completing: false };
    session.pending = pending;
    const launch = Promise.resolve().then(() => launchLogin({ signal: pending.controller.signal }));
    launches.add(launch);
    try {
      const handle = await launch;
      if (!handle?.context || typeof handle.context.cookies !== 'function' || typeof handle.close !== 'function') {
        await closeHandle(handle);
        throw new Error('Invalid login browser');
      }
      pending.handle = handle;
      if (!cleanSession(session) || session.pending !== pending) {
        await closeHandle(handle);
        return res.status(409).json({ error: 'La conexión se ha cancelado. Vuelve a intentarlo.', code: 'INSTAGRAM_LOGIN_CANCELLED' });
      }
      sendState(req, res, session);
    } catch (error) {
      if (session.pending === pending) await cancelPending(session);
      const expectedError = error?.code === 'INSTAGRAM_LOGIN_UNAVAILABLE' || error?.code === 'INSTAGRAM_LOGIN_CANCELLED';
      res.status(expectedError ? error.status : 503).json({
        error: expectedError ? error.message : 'No se pudo abrir Instagram. Comprueba que Chrome o Edge estén instalados e inténtalo de nuevo.',
        code: expectedError ? error.code : 'INSTAGRAM_LOGIN_UNAVAILABLE',
      });
    } finally {
      launches.delete(launch);
    }
  });

  router.post('/login/complete', async (req, res) => {
    const session = getSession(req);
    const pending = session.pending;
    if (!pending?.handle || pending.completing) {
      return res.status(409).json({ error: 'Abre Instagram e inicia sesión antes de confirmar.', code: 'INSTAGRAM_LOGIN_NOT_READY' });
    }
    pending.completing = true;
    try {
      // Only this explicit user action reads the session created in our new browser.
      const cookies = instagramCookies(await pending.handle.context.cookies('https://www.instagram.com/'), now());
      if (!cleanSession(session) || session.pending !== pending) {
        return res.status(409).json({ error: 'La conexión se ha cancelado o ha caducado.', code: 'INSTAGRAM_LOGIN_CANCELLED' });
      }
      const signedIn = cookies.find(cookie => cookie.name === 'sessionid' && cookie.value);
      if (!signedIn) {
        return res.status(409).json({ error: 'Termina de iniciar sesión en Instagram, incluida la verificación si aparece, y vuelve a confirmar.', code: 'INSTAGRAM_LOGIN_INCOMPLETE' });
      }
      const revocation = revoke(session);
      session.connection = {
        key: randomUUID(), cookies,
        expiresAt: Math.min(now() + sessionLifetime, signedIn.expires > 0 ? signedIn.expires * 1000 : Infinity),
      };
      rotateSession(req, res, session);
      await Promise.all([revocation, cancelPending(session)]);
      sendState(req, res, session);
    } catch {
      res.status(409).json({ error: 'No se pudo confirmar la sesión. Abre Instagram de nuevo e inténtalo otra vez.', code: 'INSTAGRAM_LOGIN_INCOMPLETE' });
    } finally {
      pending.completing = false;
    }
  });

  router.post('/login/cancel', async (req, res) => {
    const session = getSession(req);
    await cancelPending(session);
    sendState(req, res, session);
  });

  router.post('/disconnect', async (req, res) => {
    const session = getSession(req);
    const revocation = revoke(session);
    rotateSession(req, res, session);
    await Promise.all([revocation, cancelPending(session)]);
    sendState(req, res, session);
  });

  function getContext(req) {
    const session = getSession(req);
    return session ? publicContext(session) : null;
  }

  function findConnection(context) {
    if (!context || disposed) return null;
    for (const session of sessions.values()) {
      if (session.ownerId === context.ownerId && cleanSession(session)
          && session.connection?.key === context.key) return session.connection;
    }
    return null;
  }

  const isCurrent = context => Boolean(findConnection(context));

  async function withCookieFile(context, callback) {
    const connection = findConnection(context);
    if (!connection) throw authError('La conexión de Instagram ha caducado. Vuelve a conectar tu cuenta.');
    const operation = (async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ultimate-converter-instagram-'));
      const cookiePath = path.join(directory, 'cookies.txt');
      try {
        await fs.chmod(directory, 0o700);
        await fs.writeFile(cookiePath, cookieJar(connection.cookies), { mode: 0o600, flag: 'wx' });
        if (!isCurrent(context)) throw authError('La conexión de Instagram ha caducado. Vuelve a conectar tu cuenta.');
        let result;
        try {
          result = await callback(cookiePath);
        } catch (error) {
          if (!isCurrent(context)) throw authError('La conexión de Instagram ha caducado. Vuelve a conectar tu cuenta.');
          throw error;
        }
        if (!isCurrent(context)) throw authError('La conexión de Instagram ha caducado. Vuelve a conectar tu cuenta.');
        return result;
      } finally {
        // Remove only the exact directory created by this operation in the system temp folder.
        if (path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir())
            && path.basename(directory).startsWith('ultimate-converter-instagram-')) {
          await fs.rm(directory, { recursive: true, force: true });
        }
      }
    })();
    // Register before yielding so shutdown also waits for files still being created.
    cookieOperations.add(operation);
    try {
      return await operation;
    } finally {
      cookieOperations.delete(operation);
    }
  }

  const interval = setInterval(() => {
    for (const session of sessions.values()) cleanSession(session);
  }, Math.max(1, cleanupIntervalMs));
  interval.unref();

  async function dispose() {
    disposed = true;
    clearInterval(interval);
    for (const session of sessions.values()) cleanSession(session);
    await Promise.allSettled([...launches]);
    await Promise.allSettled([...closes]);
    await Promise.allSettled([...cookieOperations]);
    await Promise.allSettled([...revocations]);
  }

  return { router, middleware, getContext, isCurrent, withCookieFile, dispose };
}
