const V = 'irontimer-v10';
const CORE = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'img/helmet.png', 'img/helmet-white.png', 'img/logo.png', 'img/icon-192.png', 'img/icon-512.png', 'img/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // fonts: cache first
  if (u.hostname.includes('fonts.googleapis.com') || u.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(caches.open(V).then(c => c.match(r).then(m => m || fetch(r).then(res => { c.put(r, res.clone()); return res; }))));
    return;
  }
  if (u.origin !== location.origin) return;
  // app files: always ask the server for the latest version (skipping the 10-minute
  // GitHub cache), fall back to the saved copy when offline
  const fresh = new Request(r.url, { cache: 'no-cache', credentials: 'same-origin' });
  e.respondWith(fetch(fresh).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r.url.split('?')[0], cp)); }
    return res;
  }).catch(() => caches.match(r.url.split('?')[0]).then(m => m || caches.match(r, { ignoreSearch: true })).then(m => m || caches.match('index.html'))));
});
