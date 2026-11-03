const CACHE_NAME = 'kaaj-pwa-v1';

const STATIC_PRECACHE = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_PRECACHE).catch((err) => {
        console.warn('PWA Precache partial fail:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Handle cache clearing on logout or explicit action
self.addEventListener('message', (event) => {
  if (event.data?.action === 'clear-cache' || event.data?.type === 'LOGOUT') {
    event.waitUntil(
      caches.keys().then((keys) => {
        return Promise.all(keys.map((k) => caches.delete(k)));
      }).then(() => {
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API routes, WebSockets, auth, sync, share responses, or authenticated calls
  if (
    event.request.method !== 'GET' ||
    event.request.headers.has('Authorization') ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/sync') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/shared') ||
    url.pathname.startsWith('/trash') ||
    url.pathname.startsWith('/search') ||
    url.pathname.startsWith('/assets') ||
    url.pathname.startsWith('/categories') ||
    url.pathname.startsWith('/entries') ||
    url.pathname.startsWith('/backup') ||
    url.pathname.startsWith('/export') ||
    url.pathname.startsWith('/import')
  ) {
    return;
  }

  // Navigation requests: Network-first, fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match('/') || caches.match('/index.html');
        })
    );
    return;
  }

  // Static assets: Cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png'))) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      });
    })
  );
});
