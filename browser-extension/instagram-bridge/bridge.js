const CAPTURE_REQUEST = 'downlink-instagram-capture';
const CAPTURE_RESPONSE = 'downlink-instagram-capture-result';

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin
      || event.data?.type !== CAPTURE_REQUEST) return;
  const { requestId, endpoint, captureToken } = event.data;
  if (typeof requestId !== 'string' || typeof endpoint !== 'string' || typeof captureToken !== 'string') return;

  chrome.runtime.sendMessage({ type: CAPTURE_REQUEST, endpoint, captureToken }, (result) => {
    const error = chrome.runtime.lastError?.message;
    window.postMessage({
      type: CAPTURE_RESPONSE,
      requestId,
      ok: !error && result?.ok === true,
      error: error || result?.error || '',
    }, window.location.origin);
  });
});
