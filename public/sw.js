// Service worker: shows the little hearts, keeps the app shell for offline launches.
const CACHE = 'pense-a-toi-v5';
const SHELL = ['/', '/style.css', '/app.js', '/scene.js', '/life.js', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Network first, cached shell as a fallback when offline. API calls are never cached.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(event.request);
      if (res.ok && SHELL.includes(url.pathname)) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(url.pathname, copy));
      }
      return res;
    } catch {
      const cached = await caches.match(event.request.mode === 'navigate' ? '/' : url.pathname);
      return cached || Response.error();
    }
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title || 'Pense à toi 💗', {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    });
    if (data.badge && self.navigator.setAppBadge) await self.navigator.setAppBadge(data.badge).catch(() => {});
    for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'push' });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length) {
      const client = clients[0];
      client.postMessage({ type: 'open', url });
      return client.focus();
    }
    return self.clients.openWindow(url);
  })());
});
