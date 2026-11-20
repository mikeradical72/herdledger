// Network-first service worker: always tries the network so new releases show
// up on the next open; falls back to the last cached copy only when offline.
const CACHE = "herdledger-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: "no-store" });
      if (res.ok) (await caches.open(CACHE)).put(req.url.split("?")[0], res.clone());
      return res;
    } catch {
      const hit = await caches.match(req.url.split("?")[0]);
      return hit || new Response("Offline", { status: 503 });
    }
  })());
});
