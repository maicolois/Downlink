const CAPTURE_REQUEST = 'downlink-youtube-capture';
const LOGIN_START_REQUEST = 'downlink-youtube-login-start';
const LOGIN_CHECK_REQUEST = 'downlink-youtube-login-check';
const LOGIN_CANCEL_REQUEST = 'downlink-youtube-login-cancel';
const LOGIN_WINDOW_KEY = 'youtubeLoginWindowId';
const ALLOWED_REQUESTS = new Set([
  CAPTURE_REQUEST,
  LOGIN_START_REQUEST,
  LOGIN_CHECK_REQUEST,
  LOGIN_CANCEL_REQUEST,
]);

function validEndpoint(value) {
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1'].includes(url.hostname)
      && url.protocol === 'http:'
      && url.pathname === '/api/youtube/chrome/capture/import'
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function isYouTubeCookie(cookie) {
  const domain = String(cookie?.domain || '').toLowerCase().replace(/^\./, '');
  return domain === 'youtube.com' || domain.endsWith('.youtube.com');
}

async function capture({ endpoint, captureToken }) {
  const cookies = (await chrome.cookies.getAll({ domain: 'youtube.com' })).filter(isYouTubeCookie);
  const signedIn = cookies.some(cookie => [
    'SAPISID', 'APISID', 'SID', 'LOGIN_INFO',
    '__Secure-1PAPISID', '__Secure-3PAPISID', '__Secure-1PSID', '__Secure-3PSID',
  ].includes(cookie.name) && cookie.value);
  if (!signedIn) {
    throw new Error('Inicia sesión en YouTube en Chrome y vuelve a intentarlo.');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captureToken, cookies }),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || 'Downlink no pudo conectar la sesión de YouTube.');
}

function validRequest({ endpoint, captureToken }) {
  return validEndpoint(endpoint) && /^[A-Za-z0-9_-]{43}$/.test(captureToken);
}

async function signedIn() {
  const cookies = (await chrome.cookies.getAll({ domain: 'youtube.com' })).filter(isYouTubeCookie);
  return cookies.some(cookie => [
    'SAPISID', 'APISID', 'SID', 'LOGIN_INFO',
    '__Secure-1PAPISID', '__Secure-3PAPISID', '__Secure-1PSID', '__Secure-3PSID',
  ].includes(cookie.name) && cookie.value);
}

async function storedLoginWindow() {
  const state = await chrome.storage.session.get(LOGIN_WINDOW_KEY);
  return Number.isInteger(state[LOGIN_WINDOW_KEY]) ? state[LOGIN_WINDOW_KEY] : null;
}

async function closeLoginWindow() {
  const windowId = await storedLoginWindow();
  await chrome.storage.session.remove(LOGIN_WINDOW_KEY);
  if (windowId === null) return;
  await chrome.windows.remove(windowId).catch(() => {});
}

async function loginStart(message) {
  if (await signedIn()) {
    await capture(message);
    return { connected: true };
  }
  await closeLoginWindow();
  const popup = await chrome.windows.create({
    url: 'https://www.youtube.com/signin',
    type: 'popup',
    focused: true,
    width: 720,
    height: 820,
  });
  if (!Number.isInteger(popup?.id)) {
    throw new Error('Chrome no pudo abrir la ventana de inicio de sesión.');
  }
  await chrome.storage.session.set({ [LOGIN_WINDOW_KEY]: popup.id });
  return { pending: true };
}

async function loginCheck(message) {
  if (await signedIn()) {
    await capture(message);
    await closeLoginWindow();
    return { connected: true };
  }
  const windowId = await storedLoginWindow();
  if (windowId === null) throw new Error('La ventana de inicio de sesión ya no está abierta.');
  try {
    await chrome.windows.get(windowId);
  } catch {
    await chrome.storage.session.remove(LOGIN_WINDOW_KEY);
    throw new Error('La ventana de Chrome se cerró antes de iniciar sesión en YouTube.');
  }
  return { pending: true };
}

async function dispatch(message) {
  if (!validRequest(message)) throw new Error('La solicitud de conexión no es válida.');
  if (message.type === CAPTURE_REQUEST) {
    await capture(message);
    return { connected: true };
  }
  if (message.type === LOGIN_START_REQUEST) return loginStart(message);
  if (message.type === LOGIN_CHECK_REQUEST) return loginCheck(message);
  await closeLoginWindow();
  return { cancelled: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderUrl = sender.tab?.url || sender.url || '';
  let localSender = false;
  try {
    localSender = ['localhost', '127.0.0.1'].includes(new URL(senderUrl).hostname);
  } catch { /* Ignore malformed extension messages. */ }
  if (!localSender || !ALLOWED_REQUESTS.has(message?.type)) return false;
  dispatch(message)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
