const CAPTURE_REQUEST = 'downlink-youtube-capture';
const LOGIN_START_REQUEST = 'downlink-youtube-login-start';
const LOGIN_CHECK_REQUEST = 'downlink-youtube-login-check';
const LOGIN_CANCEL_REQUEST = 'downlink-youtube-login-cancel';
const CAPTURE_RESPONSE = 'downlink-youtube-capture-result';
const ALLOWED_REQUESTS = new Set([
  CAPTURE_REQUEST,
  LOGIN_START_REQUEST,
  LOGIN_CHECK_REQUEST,
  LOGIN_CANCEL_REQUEST,
]);

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin
      || !ALLOWED_REQUESTS.has(event.data?.type)) return;
  const { type, requestId, endpoint, captureToken } = event.data;
  if (typeof requestId !== 'string' || typeof endpoint !== 'string' || typeof captureToken !== 'string') return;

  chrome.runtime.sendMessage({ type, endpoint, captureToken }, result => {
    const error = chrome.runtime.lastError?.message;
    window.postMessage({
      type: CAPTURE_RESPONSE,
      requestId,
      ok: !error && result?.ok === true,
      connected: result?.connected === true,
      pending: result?.pending === true,
      cancelled: result?.cancelled === true,
      error: error || result?.error || '',
    }, window.location.origin);
  });
});
