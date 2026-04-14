/**
 * Service Worker – My Memories
 * Provides offline-capable shell caching for the guest upload page.
 * NOTE: Service workers only activate over HTTPS or localhost.
 * On a local HTTP network, the PWA "Add to Home Screen" still works
 * (iOS uses the meta tags + manifest); SW is a bonus for localhost.
 */
const CACHE_NAME = 'my-memories-v1';
const SHELL = [
  '/sw.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
];

// Install: pre-cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL))
      .catch(() => {}) // don't block install if cache fails (e.g. offline)
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API & uploads, cache-fallback for everything else
self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Never intercept API calls or upload requests
  if (url.includes('/api/') || url.includes('/uploads/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful GET responses for the app shell
        if (e.request.method === 'GET' && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
