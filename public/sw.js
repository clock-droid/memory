const CACHE_PREFIX = 'exam-memorizer-';
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_VERSION__`;
const APP_SHELL = __PRECACHE_URLS__;
const APP_SHELL_PATHS = new Set(APP_SHELL);

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  try {
    const requests = APP_SHELL.map((url) => new Request(
      new URL(url, self.location.origin),
      { cache: 'reload' },
    ));
    await cache.addAll(requests);
  } catch (error) {
    // Do not leave a partially populated cache behind. Rejecting installation
    // keeps the previous, complete service worker in control.
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

async function deleteOldAppShells() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
      .map((cacheName) => caches.delete(cacheName)),
  );
}

async function getCachedAppShell(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request, { ignoreSearch: true });
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok || response.status < 500) return response;
    const fallback = await getCachedAppShell('/index.html');
    return fallback ?? response;
  } catch (error) {
    const fallback = await getCachedAppShell('/index.html');
    if (fallback) return fallback;
    throw error;
  }
}

async function handleAppShellAsset(request) {
  const cached = await getCachedAppShell(request);
  if (cached) return cached;
  return fetch(request);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteOldAppShells().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  // Only known, build-generated shell assets are served from this cache.
  // API and unknown static-asset failures must remain failures, never HTML.
  if (APP_SHELL_PATHS.has(url.pathname)) {
    event.respondWith(handleAppShellAsset(event.request));
  }
});
