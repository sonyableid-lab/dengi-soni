// sw.js — офлайн-режим: все файлы приложения кэшируются при первом открытии,
// дальше приложение запускается без интернета. При наличии сети тихо
// подтягивает обновления (новая версия применится при следующем запуске).
const VERSION = "v9";
const CACHE = "dengi-soni-" + VERSION;
const FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./engine.js", "./store.js", "./analysis.js",
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

// Сначала сеть (чтобы обновления применялись сразу), а без сети или при
// медленном ответе (дольше 3 секунд) — сохранённая копия из кэша.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNet = fetch(e.request, { cache: "no-cache" }).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    const timeout = new Promise((r) => setTimeout(r, 3000, null));
    try {
      const res = await Promise.race([fromNet, timeout]);
      if (res) return res;
    } catch {}
    const cached = await cache.match(e.request, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fromNet; } catch { return new Response("Нет сети", { status: 503 }); }
  })());
});
