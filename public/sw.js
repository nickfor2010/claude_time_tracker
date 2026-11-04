// Parsley Time service worker: app shell offline, API always from the network.
const CACHE = 'parsley-time-v7';
const SHELL = ['/', '/index.html', '/admin.html', '/css/app.css', '/js/common.js', '/js/i18n.js', '/js/employee.js', '/js/admin.js',
  '/icons/icon-192.png', '/favicon.ico', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // never cache punches
  // Network first so updates show up immediately; fall back to cache when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (url.origin === location.origin || url.host.includes('fonts.g'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

// ---------- notifications ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Parsley', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    tag: d.tag,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin);
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = wins.find((w) => new URL(w.url).pathname === url.pathname);
    if (same) { await same.focus(); if ('navigate' in same) return same.navigate(url.href); return; }
    return self.clients.openWindow(url.href);
  })());
});
