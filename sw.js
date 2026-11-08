/* Word Atlas offline cache: app shell network-first, everything else cache-first. */
const VERSION = "atlas-v3";
const SHELL = `${VERSION}-shell`;
const MEDIA = `${VERSION}-media`;
/* Files pulled by the in-app offline pack live under this prefix and are never trimmed. */
const PACK_PREFIX = "atlas-pack-";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("atlas-") && !k.startsWith(VERSION) && !k.startsWith(PACK_PREFIX)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

const shellUrl = () => new URL("index.html", self.registration.scope).href;

async function shellFallback() {
  try {
    return (await caches.match(shellUrl())) || (await caches.match(new URL("./", self.registration.scope).href)) || Response.error();
  } catch {
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  /* The in-app offline pack caches through the Cache API itself; letting the SW
     also copy every file doubles the writes and slows the download down. */
  if (req.headers.get("x-atlas-pack")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res && res.ok) caches.open(SHELL).then((c) => c.put(url.href, res.clone())).catch(() => {});
          return res;
        } catch {
          return shellFallback();
        }
      })(),
    );
    return;
  }

  /* Media elements ask with a Range header; the cached copy is the complete file,
     so answering with it is valid even though the status is 200 rather than 206. */
  event.respondWith(
    (async () => {
      const cached = await caches.match(url.href);
      if (cached) return cached;
      const res = await fetch(req);
      if (res && res.ok && res.status === 200 && res.type === "basic") {
        const name = /\/atlas\/(img|thumb|audio)\//.test(url.pathname) ? MEDIA : SHELL;
        caches
          .open(name)
          .then((c) => c.put(url.href, res.clone()))
          .then(() => name === MEDIA && trim(MEDIA, 6000))
          .catch(() => {});
      }
      return res;
    })(),
  );
});
