/* FORGE service worker — makes the app work offline once it has been opened.
 *
 *  • Install: precache the whole app shell (every local file index.html loads).
 *  • Same-origin files: cache-first — answered from the cache instantly, then refreshed in the
 *    background so a new deploy shows up on the next launch without a version bump.
 *  • Page navigations: network-first (with a short timeout) so the newest index.html wins,
 *    falling back to the cached shell when offline.
 *  • Google Fonts: stale-while-revalidate. Any other cross-origin request is left alone.
 *  • Activate: delete caches from older versions, take control of open pages.
 * Bump VERSION when files are added/removed or to force every client onto a fresh cache.
 */
'use strict';

const VERSION = 'forge-v1';
const FONT_CACHE = 'forge-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NAV_TIMEOUT_MS = 4000;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/icon.svg',
  'assets/icon-maskable.svg',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/shell.css',
  'css/picker.css',
  'css/views/today.css',
  'css/views/plan.css',
  'css/views/workout.css',
  'css/views/library.css',
  'css/views/progress.css',
  'css/views/water.css',
  'css/views/journal.css',
  'css/views/settings.css',
  'js/core/util.js',
  'js/core/icons.js',
  'js/data/exercises.js',
  'js/data/program.js',
  'js/core/store.js',
  'js/core/queries.js',
  'js/core/persist.js',
  'js/core/ui.js',
  'js/core/charts.js',
  'js/core/picker.js',
  'js/core/router.js',
  'js/views/today.js',
  'js/views/plan.js',
  'js/views/workout.js',
  'js/views/library.js',
  'js/views/progress.js',
  'js/views/water.js',
  'js/views/journal.js',
  'js/views/settings.js',
  'js/app.js'
];

const cacheable = (res) => !!res && (res.ok || res.type === 'opaque');

/** cache.put that never turns a good response into a failure (e.g. storage quota). */
async function store(cache, req, res) {
  try { await cache.put(req, res.clone()); } catch (_) { /* serve it anyway */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // one missing file must not fail the whole install, so add them one by one
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('forge-') && key !== VERSION && key !== FONT_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  if (url.origin === self.location.origin) {
    event.respondWith(req.mode === 'navigate' ? networkFirst(event) : cacheFirst(event, VERSION));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(event, FONT_CACHE));
  }
});

/** Serve from cache and refresh it in the background; go to the network on a miss. */
async function cacheFirst(event, cacheName) {
  const req = event.request;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req).then(async (res) => {
    if (cacheable(res)) await store(cache, req, res);
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

/** Newest page from the network; cached shell when offline or the network is too slow. */
async function networkFirst(event) {
  const req = event.request;
  const cache = await caches.open(VERSION);
  const network = fetch(req).then(async (res) => {
    if (res && res.ok) await store(cache, req, res);
    return res;
  });
  event.waitUntil(network.catch(() => undefined));

  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, NAV_TIMEOUT_MS, null); });
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch (_) {
    /* offline — fall through to the cache */
  } finally {
    clearTimeout(timer);
  }

  const cached = (await cache.match(req, { ignoreSearch: true })) ||
    (await cache.match('index.html')) ||
    (await cache.match('./'));
  if (cached) return cached;
  // nothing cached yet (first visit while the network is slow): keep waiting for the network
  try {
    return await network;
  } catch (_) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
      '<title>FORGE — offline</title><body style="font-family:system-ui;padding:2rem;text-align:center">' +
      '<h1>You are offline</h1><p>Open FORGE once while online and it will work offline after that.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
