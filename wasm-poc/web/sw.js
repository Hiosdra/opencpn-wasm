/**
 * Service Worker for OpenCPN WASM — Chart Viewer
 *
 * Cache-first strategy for app shell assets.
 * Chart files are cached on first load via IndexedDB (handled by app code).
 */

const CACHE_NAME = 'opencpn-wasm-v5';

const APP_SHELL = [
    './',
    './index.html',
    './app.js',
    './renderer.js',
    './kap-parser.js',
    './s52-styles.js',
    './text-renderer.js',
    './navigation.js',
    './nmea-parser.js',
    './ais-decoder.js',
    './instruments.js',
    './symbol-renderer.js',
    './ais-display.js',
    './active-nav.js',
    './safety.js',
    './connections.js',
    './settings-ui.js',
    './tides.js',
    './grib.js',
    './feature-info.js',
    './logbook.js',
    './earcut.min.js',
    './opencpn_chart.js',
    './opencpn_chart.wasm',
    './manifest.json',
    './icon.svg',
    './s57objectclasses.csv',
    './s57attributes.csv',
    './s57expectedinput.csv',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching app shell');
            return cache.addAll(APP_SHELL);
        })
    );
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch: cache-first for app shell, network-first for everything else
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only handle same-origin requests
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request).then((response) => {
                // Cache successful GET responses
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});
