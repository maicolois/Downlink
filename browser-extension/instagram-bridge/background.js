const CAPTURE_REQUEST = 'downlink-instagram-capture';

function validEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(url.hostname)
      && url.pathname === '/api/instagram/login/import'
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function capture({ endpoint, captureToken }) {
  if (!validEndpoint(endpoint) || !/^[A-Za-z0-9_-]{43}$/.test(captureToken)) {
    throw new Error('La solicitud de conexión no es válida.');
  }
  const cookies = await chrome.cookies.getAll({ domain: 'instagram.com' });
  const instagramCookies = cookies.filter((cookie) => {
    const domain = String(cookie.domain || '').toLowerCase().replace(/^\./, '');
    return domain === 'instagram.com' || domain.endsWith('.instagram.com');
  });
  if (!instagramCookies.some(cookie => cookie.name === 'sessionid' && cookie.value)) {
    throw new Error('Termina de iniciar sesión en Instagram y vuelve a confirmar.');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captureToken, cookies: instagramCookies }),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || 'Downlink no pudo importar la sesión de Instagram.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const senderUrl = sender.tab?.url || sender.url || '';
  let localSender = false;
  try {
    localSender = ['localhost', '127.0.0.1'].includes(new URL(senderUrl).hostname);
  } catch { /* Ignore malformed extension messages. */ }
  if (!localSender || message?.type !== CAPTURE_REQUEST) return false;
  capture(message)
    .then(() => sendResponse({ ok: true }))
    .catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
