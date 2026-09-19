const CACHE_NAME = 'pump-protector-v8';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Always fetch fresh from network for all requests during development
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
