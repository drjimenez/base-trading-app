// Service worker: guarda la "cáscara" de la app para que abra rápido.
// Los datos de Supabase SIEMPRE se piden en vivo (nunca se cachean).
const VERSION = "trading-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname.endsWith("supabase.co")) return; // datos: siempre red
  if (url.origin === location.origin) {
    // app propia: red primero, caché si no hay conexión
    e.respondWith(
      fetch(e.request).then((r) => {
        const copia = r.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copia));
        return r;
      }).catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
    );
  } else {
    // librerías del CDN: caché primero
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      const copia = resp.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copia));
      return resp;
    })));
  }
});
