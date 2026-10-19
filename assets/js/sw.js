/* =====================================================================
 * Frontdesk HMS · sw.js (served at /sw.js so it covers every page)
 * Makes Frontdesk installable as an app, and shows a friendly page when
 * there is no connection. Nothing else is cached: pages hold guest data
 * and front-desk computers are shared, so every page comes from the
 * server as before.
 * ===================================================================== */
'use strict';

const CACHE = 'frontdesk-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Opening a page: the network as always; only when it can't be reached, the offline page. Form posts,
// downloads, scripts and data calls are left alone.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
