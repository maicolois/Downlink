const SUPPORTED_BROWSERS = new Set(['brave', 'chrome', 'edge', 'firefox']);

export const YOUTUBE_BROWSERS = Object.freeze([...SUPPORTED_BROWSERS]);

export function normalizeYouTubeBrowser(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw invalidBrowserError();
  }

  const browser = value.trim().toLowerCase();
  if (!SUPPORTED_BROWSERS.has(browser)) {
    throw invalidBrowserError();
  }
  return browser;
}

export function getYouTubeBrowserArgs(value) {
  const browser = normalizeYouTubeBrowser(value);
  return browser ? ['--cookies-from-browser', browser] : [];
}

function invalidBrowserError() {
  return Object.assign(new Error('Selecciona Chrome, Edge, Firefox o Brave para usar una sesión local de YouTube.'), {
    code: 'YOUTUBE_BROWSER_INVALID',
  });
}
