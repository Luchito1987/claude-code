// Service worker de "Pescadores de orilla".
// - La app (HTML, íconos) se guarda para abrir aunque no haya señal; siempre se
//   intenta primero la versión nueva de la red.
// - El último pronóstico de Open-Meteo queda guardado para ver el semáforo sin señal.
// - La API de la comunidad nunca se guarda: son datos privados y con sesión.
var VERSION = 'pesca-v1';
var APP = ['./', 'index.html', 'privacidad.html', 'manifest.webmanifest',
  'iconos/icono-192.png', 'iconos/icono-512.png', 'iconos/icono-maskable-512.png',
  'iconos/apple-touch-icon.png', 'iconos/favicon-32.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(APP); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION && k !== 'pronostico'; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function redPrimero(req, cache) {
  return fetch(req).then(function (r) {
    if (r && r.ok) { var copia = r.clone(); caches.open(cache).then(function (c) { c.put(req, copia); }); }
    return r;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (r) { return r || caches.match('index.html'); });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(redPrimero(req, VERSION));
  } else if (/open-meteo\.com$/.test(url.hostname)) {
    e.respondWith(fetch(req).then(function (r) {
      if (r && r.ok) { var copia = r.clone(); caches.open('pronostico').then(function (c) { c.put(req, copia); }); }
      return r;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || Response.error(); });
    }));
  }
  // Todo lo demás (API de la comunidad, mapa, Google, iNaturalist) va directo a la red.
});
