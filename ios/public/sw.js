// Bump this version whenever the app shell changes. Updates activate after the
// existing windows close, so an in-progress download is never forcibly reloaded.
const CACHE = 'downlink-shell-v1';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/main.css', '/css/profile.css', '/css/pwa.css',
  '/js/app.js', '/js/platform.js', '/js/pwa.js', '/js/download-session.js',
  '/js/homepage.js', '/js/fetch-with-retry.js',
  '/js/components/profile-system.js', '/js/components/instagram-account.js',
  '/js/components/input-placeholder.js',
  '/js/backgrounds/contour-background.js', '/js/backgrounds/wave-background.js',
  '/shared/platform-patterns.js', '/shared/video-resolutions.js',
  '/shared/carousel-selection.js', '/shared/instagram-stories.js', '/shared/mp3-qualities.js',
  '/assets/icons/favicon.svg', '/assets/icons/apple-touch-icon.png',
  '/assets/icons/app-192.png', '/assets/icons/app-512.png', '/assets/icons/app-maskable-512.png',
  '/assets/graphics/contours.svg',
  ...['ember-fox', 'ocean-otter', 'violet-robot', 'forest-frog', 'sunset-cat']
    .map(name => `/assets/avatars/${name}.webp`),
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('downlink-shell-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Only bundled, public UI files. Never intercept API calls, cookies, remote
  // thumbnails, partial responses, or downloaded media (including navigations).
  if (request.method !== 'GET' || url.origin !== self.location.origin
      || request.headers.has('range') || !SHELL.includes(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Avoid a navigation network failure when the device is already offline.
    // Keep the catch below for outages that happen while a request is in flight.
    if (!self.navigator.onLine) {
      const cached = await cache.match(url.pathname);
      if (cached) return cached;
    }
    try {
      // Online requests use the current application. The versioned cache is an
      // intact offline fallback, not a mixture updated one asset at a time.
      return await fetch(request);
    } catch (error) {
      const cached = await cache.match(url.pathname);
      if (cached) return cached;
      throw error;
    }
  })());
});
