/* Cosmic Wimpout — offline shell.
   Cache-first: the game is entirely static and must run with no network once
   installed to the home screen. Bump CACHE to ship an update. */
const CACHE = 'wimpout-v31';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/art.js?v=31',
  './src/audio.js?v=31',
  './src/engine.js?v=31',
  './src/ai.js?v=31',
  './src/ui.js?v=31',
  './src/scenes.js?v=31',
  './src/hints.js?v=31',
  './src/save.js?v=31',
  './src/stats.js?v=31',
  './src/fanfare.js?v=31',
  './src/render.js?v=31',
  './src/scene-play.js?v=31',
  './src/scene-setup.js?v=31',
  './src/scene-menu.js?v=31',
  './src/scene-rules.js?v=31',
  './src/scene-stats.js?v=31',
  './src/game.js?v=31',
  // 2.0, the 3D table: 1.0's rules, art and scenes above, plus these
  './v2/',
  './v2/index.html',
  './v2/src/math.js?v=31',
  './v2/src/softbody.js?v=31',
  './v2/src/mesh.js?v=31',
  './v2/src/sprites.js?v=31',
  './v2/src/shaders.js?v=31',
  './v2/src/renderer.js?v=31',
  './v2/src/camera.js?v=31',
  './v2/src/table.js?v=31',
  './v2/src/scene-play.js?v=31',
  './v2/src/scene-nogpu.js?v=31',
  './v2/src/game.js?v=31',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // don't let one missing asset abort the whole install
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      // keep the cache warm for anything we missed in the shell list
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
