// Service worker: network-first pro app shell (sempre busca a versão mais nova quando
// há conexão, e só cai pro cache quando está offline). Isso evita o problema clássico de
// PWA cache-first: instalar uma vez e nunca mais receber atualizações de index.html/app.js.
var CACHE_NAME = 'treino-shell-v2';
var SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_FILES);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = event.request.url;
  // nunca cachear chamadas à API do Supabase — precisam sempre ir pra rede
  if (url.indexOf('supabase.co') !== -1) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response && response.ok && response.type === 'basic') {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
