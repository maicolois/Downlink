// Browsers use the HTTP API. Keep the optional bridge for separately packaged clients.
export const isNativeApp = () => Boolean(globalThis.DownlinkNative);

export const isIOSBrowser = () => !isNativeApp() && (
  /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

export function apiFetch(input, init) {
  return globalThis.DownlinkNative
    ? globalThis.DownlinkNative.fetch(input, init)
    : globalThis.fetch(input, init);
}

export function canReadClipboard(environment = globalThis) {
  if (typeof environment.DownlinkNative?.readClipboard === 'function') return true;
  return environment.isSecureContext === true
    && typeof environment.navigator?.clipboard?.readText === 'function';
}

export function readClipboard(environment = globalThis) {
  if (typeof environment.DownlinkNative?.readClipboard === 'function') {
    return environment.DownlinkNative.readClipboard();
  }
  const clipboard = environment.navigator?.clipboard;
  if (environment.isSecureContext !== true || typeof clipboard?.readText !== 'function') {
    return Promise.reject(Object.assign(
      new Error('El navegador no permite leer el portapapeles desde esta dirección.'),
      { name: 'NotAllowedError' },
    ));
  }
  return clipboard.readText.call(clipboard);
}

export async function saveDownload(jobId, filename, fileAccess = null) {
  if (globalThis.DownlinkNative) return globalThis.DownlinkNative.saveDownload(jobId);
  const link = document.createElement('a');
  const token = fileAccess?.token;
  const query = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? `?access=${encodeURIComponent(token)}` : '';
  link.href = `/api/file/${encodeURIComponent(jobId)}${query}`;
  link.download = filename;
  if (isIOSBrowser()) {
    // Let Safari own the download without replacing the converter page.
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { saved: true };
}
