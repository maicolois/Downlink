const BROWSERS = {
  chrome: { name: 'Chrome', extensionsUrl: 'chrome://extensions', loadLabel: 'Cargar descomprimida' },
  edge: { name: 'Microsoft Edge', extensionsUrl: 'edge://extensions', loadLabel: 'Cargar desempaquetado' },
  brave: { name: 'Brave', extensionsUrl: 'brave://extensions', loadLabel: 'Cargar descomprimida' },
  opera: { name: 'Opera', extensionsUrl: 'opera://extensions', loadLabel: 'Cargar extensión descomprimida' },
  vivaldi: { name: 'Vivaldi', extensionsUrl: 'vivaldi://extensions', loadLabel: 'Cargar descomprimida' },
  chromium: { name: 'Chromium', extensionsUrl: 'chrome://extensions', loadLabel: 'Cargar descomprimida' },
  firefox: { name: 'Firefox' },
  safari: { name: 'Safari' },
  unknown: { name: 'este navegador' },
};

// Detection only adapts the guide; it must not decide whether a bridge can connect.
export async function detectYouTubeExtensionBrowser(browserNavigator = navigator) {
  const ua = browserNavigator.userAgent || '';
  const brands = (browserNavigator.userAgentData?.brands || []).map(({ brand }) => brand);
  const hasBrand = pattern => brands.some(brand => pattern.test(brand));
  const mobile = browserNavigator.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
    || (/Macintosh|MacIntel/i.test(`${ua} ${browserNavigator.platform || ''}`) && browserNavigator.maxTouchPoints > 1);
  let id = 'unknown';
  // Chromium derivatives also include Chrome and Safari in their user agent.
  if (/Edg(?:A|iOS)?\//i.test(ua) || hasBrand(/Microsoft Edge/i)) id = 'edge';
  else if (/OPR\/|Opera|OPiOS\//i.test(ua) || hasBrand(/Opera/i)) id = 'opera';
  else if (/Vivaldi\//i.test(ua) || hasBrand(/Vivaldi/i)) id = 'vivaldi';
  else if (/Brave\//i.test(ua) || hasBrand(/Brave/i)) id = 'brave';
  else if (/Firefox\/|FxiOS\//i.test(ua)) id = 'firefox';
  else {
    // Brave normally uses Chrome's user agent; its own API distinguishes it.
    try {
      if (await browserNavigator.brave?.isBrave?.()) id = 'brave';
    } catch { /* Privacy settings may hide this API; keep the normal fallback. */ }
    if (id === 'unknown') {
      if (hasBrand(/Google Chrome/i) || /CriOS\//i.test(ua)) id = 'chrome';
      else if (/Chromium\//i.test(ua)) id = 'chromium';
      else if (/Chrome\//i.test(ua)) id = 'chrome';
      else if (hasBrand(/Chromium/i)) id = 'chromium';
      else if (/Safari\//i.test(ua)) id = 'safari';
    }
  }
  return { id, ...BROWSERS[id], mobile };
}

export async function initializeYouTubeExtensionHelp(details) {
  const browser = await detectYouTubeExtensionBrowser();
  const canInstallHere = Boolean(browser.extensionsUrl) && !browser.mobile;
  const target = canInstallHere ? browser : BROWSERS.chrome;
  let explanation = '';
  if (browser.mobile) {
    explanation = `${browser.name} móvil/tablet: instala el puente en Chrome en el ordenador con Downlink.`;
  } else if (!browser.extensionsUrl) {
    explanation = browser.id === 'unknown'
      ? 'Navegador no identificado. Instálala desde Chrome en el ordenador con Downlink.'
      : `La extensión no admite ${browser.name}. Usa Chrome en el ordenador con Downlink.`;
  }
  details.querySelector('summary').textContent = canInstallHere
    ? `Instalar en ${target.name}` : 'Instalar en Chrome · ordenador';
  const compatibility = details.querySelector('[data-extension-compatibility]');
  compatibility.textContent = explanation;
  compatibility.hidden = !explanation;
  details.querySelector('[data-extension-url]').textContent = target.extensionsUrl;
  details.querySelector('[data-extension-load]').textContent = target.loadLabel;
  details.dataset.browser = browser.id;
}
