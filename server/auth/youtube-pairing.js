import express from 'express';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { isYouTubeLocalRequest } from '@/server/auth/youtube-auth.js';

const PAIRING_TTL_MS = 3 * 60 * 1000;
const DEVICE_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'downlink_youtube_device';

// Only the explicitly configured HTTPS listener can issue or accept a device
// credential. YouTube cookies themselves never leave the server.
export function createYouTubePairing({ youtubeAuth, origin = null, now = Date.now } = {}) {
  const router = express.Router();
  const devices = new Map();
  let pending = null;

  function secureRequest(req, requireOrigin = false) {
    if (!origin || !req.socket.encrypted || req.headers['sec-fetch-site'] === 'cross-site') return false;
    let expected;
    try { expected = new URL(origin); } catch { return false; }
    if (expected.protocol !== 'https:' || req.headers.host !== expected.host) return false;
    const supplied = req.headers.origin;
    return supplied === undefined ? !requireOrigin : supplied === expected.origin;
  }

  function device(req, { requireOrigin = false } = {}) {
    if (!secureRequest(req, requireOrigin)) return null;
    const matching = String(req.headers.cookie || '').split(';')
      .map(part => part.trim()).filter(part => part.startsWith(`${COOKIE}=`));
    if (matching.length !== 1) return null;
    const token = matching[0].slice(COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const entry = devices.get(token);
    const context = youtubeAuth.getContext();
    if (!entry || entry.expiresAt <= now() || !context || context.key !== entry.contextKey) {
      devices.delete(token);
      return null;
    }
    return entry;
  }

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.post('/code', async (req, res, next) => {
    if (!isYouTubeLocalRequest(req, { requireOrigin: true })) return res.status(403).json({ error: 'Genera el código desde Downlink en el ordenador.' });
    if (!origin) return res.status(503).json({ error: 'La conexión segura del iPhone todavía no está configurada.' });
    const context = youtubeAuth.getContext();
    if (!context) return res.status(401).json({ error: 'Conecta primero YouTube en el ordenador.' });
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const grant = { code, contextKey: context.key, expiresAt: now() + PAIRING_TTL_MS, attempts: 0 };
    pending = grant;
    try {
      // A fragment never reaches the HTTP server in a request or Referer.
      const link = `${origin}/#youtube-pair=${code}`;
      const qr = await QRCode.toDataURL(link, { errorCorrectionLevel: 'M', margin: 2, width: 240 });
      if (pending !== grant) return res.status(409).json({ error: 'Se ha generado otro código. Utiliza el más reciente.' });
      return res.json({ code, qr, expiresAt: grant.expiresAt, origin });
    } catch (error) {
      if (pending === grant) pending = null;
      return next(error);
    }
  });

  router.post('/connect', (req, res) => {
    if (!secureRequest(req, true)) return res.status(403).json({ error: 'Abre la dirección segura de Downlink en el iPhone.' });
    const context = youtubeAuth.getContext();
    if (!pending || pending.expiresAt <= now() || !context || pending.contextKey !== context.key) {
      pending = null;
      return res.status(401).json({ error: 'El código ha caducado o la sesión del ordenador se ha desconectado. Genera otro código.' });
    }
    const supplied = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const matches = /^\d{8}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(pending.code));
    if (!matches) {
      pending.attempts += 1;
      if (pending.attempts >= 5) pending = null;
      return res.status(401).json({ error: pending ? 'Código incorrecto. Compruébalo y vuelve a intentarlo.' : 'Demasiados intentos. Genera un código nuevo en el ordenador.' });
    }
    pending = null;
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(context.expiresAt, now() + DEVICE_TTL_MS);
    devices.set(token, { id: randomUUID(), contextKey: context.key, expiresAt });
    res.cookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: Math.max(0, expiresAt - now()) });
    return res.json({ connected: true, expiresAt });
  });

  router.post('/disconnect', (req, res) => {
    if (!secureRequest(req, true)) return res.status(403).json({ error: 'Abre la dirección segura de Downlink en el iPhone.' });
    const matching = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
    if (matching) devices.delete(matching.slice(COOKIE.length + 1));
    res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
    return res.json({ connected: false });
  });

  return { router, device, secureRequest };
}
