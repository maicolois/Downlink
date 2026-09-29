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

export function readClipboard() {
  return globalThis.DownlinkNative
    ? globalThis.DownlinkNative.readClipboard()
    : navigator.clipboard.readText();
}

export async function saveDownload(jobId, filename) {
  if (globalThis.DownlinkNative) return globalThis.DownlinkNative.saveDownload(jobId);
  const link = document.createElement('a');
  link.href = `/api/file/${encodeURIComponent(jobId)}`;
  link.download = filename;
  if (isIOSBrowser()) {
    // Let Safari own the download without replacing the converter page.
    link.target = '_blank';
    link.rel = 'noopener';
  }
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { saved: true };
}
