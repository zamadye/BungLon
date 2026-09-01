/* =============================================================================
 * sw.js — service worker BUNGLON! (PWA: bisa offline + Add to Home Screen)
 * -----------------------------------------------------------------------------
 * Strategi:
 *   • app shell  : cache-first (install => precache daftar SHELL di bawah)
 *   • assets/*   : stale-while-revalidate (sprite/tiles, jarang berubah)
 *   • navigasi   : network-first, fallback ke index.html ter-cache (?solo=1 aman)
 *   • /room/*    : TIDAK pernah di-cache (relay multiplayer = harus realtime)
 * Versi di CACHE_NAME menjadi satu-satunya cara "paksa refresh": naikkan angkanya.
 * ========================================================================== */
'use strict';

const VERSION = 'v2.2-freeze-1';
const CACHE_SHELL = 'hideseek-shell-' + VERSION;
const CACHE_ASSETS = 'hideseek-assets-' + VERSION;
const CACHE_PAGES = 'hideseek-pages-' + VERSION;

/** Harus benar-benar ada di folder web/ (diperiksa tools/web_ui_test.js). */
const SHELL = [
  './', './index.html', './ui.css', './manifest.webmanifest',
  './game.js', './uiKit.js', './audioKit.js', './particles.js', './adsManager.js', './referralSystem.js',
  './config.example.js',
  './assets/Chameleon_Hider.png', './assets/Chameleon_Seeker.png',
  './assets/Tile_Grass.png', './assets/Tile_Sand.png', './assets/Tile_Stone.png', './assets/Tile_Wood.png',
  './assets/Hedge_Wall.png', './assets/Bg_Lobby.png', './assets/AppIcon.png', './assets/Logo_HideSeek.png',
  './assets/Bg_Splash.jpg', './assets/Icon_Coin.png', './assets/Icon_Life.png', './assets/Icon_Freeze.png',
  './assets/UI_HealthFrame.png', './assets/UI_MinimapFrame.png',
];

/* --------------------------------- install -------------------------------- */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_SHELL);
    // Satu file hilang (mis. config.js belum di-generate) tidak boleh membatalkan install.
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

/* -------------------------------- activate -------------------------------- */
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [CACHE_SHELL, CACHE_ASSETS, CACHE_PAGES];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => keep.indexOf(k) < 0).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------------------------------- fetch --------------------------------- */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              // SDK iklan pihak ketiga: biarkan lewat
  if (url.pathname.indexOf('/room/') >= 0) return;              // relay multiplayer: jangan pernah di-cache

  // navigasi: network-first, fallback index.html (PWA tetap bisa dibuka offline)
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE_PAGES);
        c.put(req, net.clone());
        return net;
      } catch (err) {
        const hit = (await caches.match(req)) || (await caches.match('./index.html')) || (await caches.match('./'));
        return hit || new Response('offline', { status: 503, headers: { 'content-type': 'text/plain' } });
      }
    })());
    return;
  }

  // assets (png/js/css): stale-while-revalidate
  const isAsset = url.pathname.indexOf('/assets/') >= 0 || /\.(png|jpg|jpeg|svg|css|js|webmanifest)$/.test(url.pathname);
  if (!isAsset) return;
  e.respondWith((async () => {
    const cache = await caches.open(url.pathname.indexOf('/assets/') >= 0 ? CACHE_ASSETS : CACHE_SHELL);
    const hit = await cache.match(req);
    const refresh = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || refresh || new Response('', { status: 504 });
  })());
});

/* ------------------------- perintah dari halaman --------------------------- */
self.addEventListener('message', (e) => {
  const d = (e.data || {});
  if (d.type === 'skipWaiting') self.skipWaiting();
  if (d.type === 'clearCaches') {
    e.waitUntil((async () => { for (const k of await caches.keys()) await caches.delete(k); })());
  }
});
