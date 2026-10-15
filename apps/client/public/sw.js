// Service worker de Pokémon Tactical Arena: red primero con reserva en caché.
// Los assets de Vite llevan hash, así que cachearlos es seguro; al estar la red
// por delante, los despliegues nuevos se ven al momento. El WebSocket no pasa
// por aquí (los service workers no interceptan ws://).
const CACHE = 'pta-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname === '/salud') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m ?? Response.error())),
  );
});
