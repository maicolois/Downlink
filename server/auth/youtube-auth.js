import express from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CONNECTION_TTL_MS = 8 * 60 * 60 * 1000;
const CAPTURE_TTL_MS = 60 * 1000;
const POPUP_CAPTURE_TTL_MS = 5 * 60 * 1000;
const token = () => randomBytes(32).toString('base64url');
const AUTH_COOKIE_NAMES = new Set([
  'SAPISID', 'APISID', 'SID', 'LOGIN_INFO',
  '__Secure-1PAPISID', '__Secure-3PAPISID',
  '__Secure-1PSID', '__Secure-3PSID',
]);

function youtubeAuthError(message, status = 401, code = 'YOUTUBE_CHROME_SESSION_EXPIRED') {
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

export function isYouTubeLocalRequest(req, { requireOrigin = false } = {}) {
  const expected = localOrigin(req);
  if (!expected || req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  return origin === undefined ? !requireOrigin : origin === expected;
}

const sameOrigin = isYouTubeLocalRequest;

function isExtensionImport(req) {
  return Boolean(localOrigin(req))
    && /^chrome-extension:\/\/[a-p]{32}$/i.test(String(req.headers.origin || ''));
}

function youtubeCookies(cookies, timestamp) {
  if (!Array.isArray(cookies)) return [];
  const unique = new Map();
  for (const cookie of cookies) {
    if (!cookie || typeof cookie.domain !== 'string') continue;
    const domain = cookie.domain.toLowerCase().replace(/^\./, '');
    if (domain !== 'youtube.com' && !domain.endsWith('.youtube.com')) continue;
    if (!/^[a-z0-9.-]+$/.test(domain)) continue;
    const values = [cookie.name, cookie.value, cookie.path || '/'];
    if (!values.every(value => typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value))) continue;
    const rawExpires = Number.isFinite(cookie.expirationDate) ? cookie.expirationDate : cookie.expires;
    if (!cookie.name || (rawExpires > 0 && rawExpires * 1000 <= timestamp)) continue;
    const normalized = {
      domain: cookie.domain.toLowerCase(),
      path: cookie.path || '/',
      name: cookie.name,
      value: cookie.value,
      expires: Number.isFinite(rawExpires) ? rawExpires : -1,
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
    };
    const key = `${normalized.domain}\0${normalized.path}\0${normalized.name}`;
    const previous = unique.get(key);
    if (!previous || normalized.expires > previous.expires) unique.set(key, normalized);
  }
  return [...unique.values()];
}

function hasAuthorizedAccount(cookies) {
  return cookies.some(cookie => AUTH_COOKIE_NAMES.has(cookie.name) && cookie.value);
}

function cookieJar(cookies) {
  return '# Netscape HTTP Cookie File\n' + cookies.map(cookie => [
    `${cookie.httpOnly ? '#HttpOnly_' : ''}${cookie.domain}`,
    cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE',
    cookie.path,
    cookie.secure ? 'TRUE' : 'FALSE',
    cookie.expires > 0 ? Math.floor(cookie.expires) : 0,
    cookie.name,
    cookie.value,
  ].join('\t')).join('\n') + '\n';
}

/**
 * Receives an explicitly approved YouTube cookie snapshot from the local Chrome
 * extension. Cookies stay in memory and are materialized only while yt-dlp is
 * running.
 */
export function createYouTubeAuth({
  now = Date.now,
  notifyRevoke = () => {},
  remoteSession = () => null,
  pairingAvailable = () => false,
  connectionTtlMs = CONNECTION_TTL_MS,
  captureTtlMs = CAPTURE_TTL_MS,
  popupCaptureTtlMs = POPUP_CAPTURE_TTL_MS,
  cleanupIntervalMs = 30_000,
} = {}) {
  const router = express.Router();
  const pending = new Map();
  const cookieOperations = new Set();
  const revocations = new Set();
  let connection = null;
  let disposed = false;

  function publicContext() {
    clean();
    return connection ? Object.freeze({ key: connection.key, expiresAt: connection.expiresAt }) : null;
  }

  function revoke() {
    const context = connection ? Object.freeze({ key: connection.key, expiresAt: connection.expiresAt }) : null;
    connection = null;
    if (!context) return Promise.resolve();
    let revocation;
    try {
      revocation = Promise.resolve(notifyRevoke(context)).catch(() => {});
    } catch {
      return Promise.resolve();
    }
    revocations.add(revocation);
    revocation.finally(() => revocations.delete(revocation));
    return revocation;
  }

  async function replaceConnection(cookies) {
    const previousRevocation = revoke();
    const authExpiries = cookies
      .filter(cookie => AUTH_COOKIE_NAMES.has(cookie.name) && cookie.expires > 0)
      .map(cookie => cookie.expires * 1000);
    connection = {
      key: randomUUID(),
      cookies,
      expiresAt: Math.min(
        now() + Math.max(1, connectionTtlMs),
        authExpiries.length ? Math.max(...authExpiries) : Infinity,
      ),
    };
    await previousRevocation;
  }

  function clean() {
    const timestamp = now();
    for (const [captureToken, expiresAt] of pending) {
      if (expiresAt <= timestamp) pending.delete(captureToken);
    }
    if (connection?.expiresAt <= timestamp) void revoke();
  }

  function state() {
    const context = publicContext();
    return {
      available: !disposed,
      connected: Boolean(context),
      expiresAt: context?.expiresAt ?? null,
      pairingAvailable: pairingAvailable(),
    };
  }

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    clean();
    if (disposed) {
      return res.status(503).json({
        code: 'YOUTUBE_CHROME_UNAVAILABLE',
        error: 'La conexión local de Chrome no está disponible.',
      });
    }
    if (req.method === 'GET' && req.path === '/session') return next();
    if (req.method === 'POST' && req.path === '/chrome/capture/import') {
      if (isExtensionImport(req)) return next();
      return res.status(403).json({
        code: 'YOUTUBE_CHROME_EXTENSION_REQUIRED',
        error: 'La sesión de Chrome solo puede importarse mediante la extensión local de Downlink.',
      });
    }
    if (!sameOrigin(req, { requireOrigin: true })) {
      return res.status(403).json({
        code: 'YOUTUBE_LOCAL_ONLY',
        error: 'La sesión de YouTube solo puede conectarse desde esta aplicación local.',
      });
    }
    next();
  });

  router.get('/session', (req, res) => {
    if (!sameOrigin(req)) {
      const remote = remoteSession(req);
      if (remote) return res.json({ available: true, remote: true, connected: Boolean(remote.connected), expiresAt: remote.expiresAt || null });
      return res.status(403).json({ code: 'YOUTUBE_LOCAL_ONLY', error: 'Downlink debe abrirse en localhost.' });
    }
    res.json(state());
  });

  router.post('/chrome/capture/start', (req, res) => {
    const captureToken = token();
    const ttl = req.body?.mode === 'login' ? popupCaptureTtlMs : captureTtlMs;
    pending.set(captureToken, now() + Math.max(1, ttl));
    res.json({ ...state(), captureToken });
  });

  router.post('/chrome/capture/import', async (req, res) => {
    const supplied = typeof req.body?.captureToken === 'string' ? req.body.captureToken : '';
    let matched = null;
    if (/^[A-Za-z0-9_-]{43}$/.test(supplied)) {
      for (const captureToken of pending.keys()) {
        if (timingSafeEqual(Buffer.from(supplied), Buffer.from(captureToken))) {
          matched = captureToken;
          break;
        }
      }
    }
    if (!matched) {
      return res.status(409).json({
        code: 'YOUTUBE_CHROME_CAPTURE_EXPIRED',
        error: 'La solicitud de Chrome ha caducado. Vuelve a pulsar “Usar esta sesión local”.',
      });
    }
    pending.delete(matched);
    const cookies = youtubeCookies(req.body?.cookies, now());
    if (!hasAuthorizedAccount(cookies)) {
      return res.status(409).json({
        code: 'YOUTUBE_CHROME_LOGIN_REQUIRED',
        error: 'Inicia sesión en YouTube en Chrome y vuelve a intentarlo.',
      });
    }
    await replaceConnection(cookies);
    res.json({ imported: true, ...state() });
  });

  router.post('/disconnect', async (_req, res) => {
    pending.clear();
    await revoke();
    res.json(state());
  });

  function getContext() {
    return publicContext();
  }

  function findConnection(context) {
    clean();
    return context && connection?.key === context.key ? connection : null;
  }

  const isCurrent = context => Boolean(findConnection(context));

  async function withCookieFile(context, callback) {
    const current = findConnection(context);
    if (!current) {
      throw youtubeAuthError('La sesión de Chrome ha caducado. Vuelve a conectarla desde Sesión de YouTube.');
    }
    const operation = (async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'downlink-youtube-'));
      const cookiePath = path.join(directory, 'cookies.txt');
      try {
        await fs.chmod(directory, 0o700);
        await fs.writeFile(cookiePath, cookieJar(current.cookies), { mode: 0o600, flag: 'wx' });
        if (!isCurrent(context)) throw youtubeAuthError('La sesión de Chrome se ha desconectado.');
        const result = await callback(cookiePath);
        if (!isCurrent(context)) throw youtubeAuthError('La sesión de Chrome se ha desconectado.');
        return result;
      } finally {
        if (path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir())
            && path.basename(directory).startsWith('downlink-youtube-')) {
          await fs.rm(directory, { recursive: true, force: true });
        }
      }
    })();
    cookieOperations.add(operation);
    try {
      return await operation;
    } finally {
      cookieOperations.delete(operation);
    }
  }

  const interval = setInterval(clean, Math.max(1, cleanupIntervalMs));
  interval.unref();

  async function dispose() {
    disposed = true;
    clearInterval(interval);
    pending.clear();
    await revoke();
    await Promise.allSettled([...cookieOperations]);
    await Promise.allSettled([...revocations]);
  }

  return { router, getContext, isCurrent, withCookieFile, dispose };
}
