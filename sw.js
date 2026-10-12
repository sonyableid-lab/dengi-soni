// sw.js — офлайн-режим: все файлы приложения кэшируются при первом открытии,
// дальше приложение запускается без интернета. При наличии сети тихо
// подтягивает обновления (новая версия применится при следующем запуске).
const VERSION = "v3";
const CACHE = "dengi-soni-" + VERSION;
const FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./engine.js", "./store.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
  "./vendor/chart.umd.min.js", "./vendor/pdf.min.mjs", "./vendor/pdf.worker.min.mjs",
  "./fonts/cormorant-cyrillic-500-italic.woff2", "./fonts/cormorant-cyrillic-500-normal.woff2", "./fonts/cormorant-cyrillic-600-italic.woff2", "./fonts/cormorant-cyrillic-600-normal.woff2", "./fonts/cormorant-latin-500-italic.woff2", "./fonts/cormorant-latin-500-normal.woff2", "./fonts/cormorant-latin-600-italic.woff2", "./fonts/cormorant-latin-600-normal.woff2", "./fonts/onest-cyrillic-wght-normal.woff2", "./fonts/onest-latin-wght-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала кэш (мгновенно и офлайн), параллельно — обновление из сети
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      return cached || (await fresh) || new Response("Нет сети", { status: 503 });
    })
  );
});
