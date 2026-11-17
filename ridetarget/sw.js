/* RideTarget shell cache. Network first, so a Pages update is picked up when online. */
var CACHE = 'ridetarget-shell-v3';
var SHELL = [
  './',
  './index.html',
  './home.html',
  './admin.html',
  './styles.css',
  './home.css',
  './config.js',
  './calc.js',
  './i18n.js',
  './app.js',
  './home.js',
  './admin.js',
  './manifest.json',
  './logo.svg',
  './og.png',
  './media/today.png',
  './media/history.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL);
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) {
      return key !== CACHE;
    }).map(function (key) {
      return caches.delete(key);
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetch(req).then(function (res) {
    if (res && res.status === 200 && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) {
        cache.put(req, copy);
      });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (cached) {
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    });
  }));
});
