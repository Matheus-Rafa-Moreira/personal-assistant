const CACHE_NAME = 'pla-shell-v10';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/css/alfred-tokens.css',
  '/css/app.css',
  '/js/app.js',
  '/js/vapid.js',
  '/vendor/fullcalendar-6.1.15.min.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-1024.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  // Individual puts (not addAll): one missing/blocked file must not abort the
  // whole install and strand the app on an older service worker.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL_FILES.map((file) =>
          fetch(file, { cache: 'reload' })
            .then((res) => (res.ok ? cache.put(file, res) : null))
            .catch(() => null)
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Network-first for app code, cache only as an offline fallback.
//
// The previous cache-first policy could permanently pin a bad response — most
// dangerously a Cloudflare Access login page served in place of a script when a
// session expired — which left the chrome rendering and the calendar blank with
// no error. Network-first means a bad copy can never outlive one refresh.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Live data always comes from the network.
  if (url.pathname.startsWith('/api/')) return;

  // Never manage cross-origin requests; let the browser handle them normally.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Only cache genuine successes. An Access redirect or error page must
        // never be stored as if it were app code.
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});

// V3 opt-in reminders: show the push as a notification, and focus/open the
// app on tap so Matt lands back on the calendar.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Reminder', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Reminder';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const existing = clientsArr.find((c) => 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow('/');
    })
  );
});
