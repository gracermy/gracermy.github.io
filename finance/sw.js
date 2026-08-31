// Bloom service worker — makes the app installable and fast to open.
//
// Deliberately conservative. The one way a service worker can really hurt is by
// serving stale code forever, so:
//   * only same-origin GETs for our own static files are cached;
//   * Supabase (auth, data) and the CDN are NEVER cached — always network;
//   * HTML uses network-first, so a deploy is picked up on the next load;
//   * bumping CACHE_VERSION wipes every old cache.
//
// Phase 2 will add push handlers here. Nothing about caching needs to change
// for that.

const CACHE_VERSION = "bloom-v1";

// The app shell: enough to open Bloom offline and show the UI. Data still
// needs the network — this is about the app opening instantly, not working
// fully offline.
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./supabase.js",
  "./snapshot.js",
  "./charts.js",
  "./statements.js",
  "./split.js",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "/theme.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll fails the whole install if ANY file 404s, which would leave the
    // app with no worker at all. Cache what we can and carry on.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: "reload" })).catch(() => {})
    ));
    // Take over as soon as the new worker is ready, rather than waiting for
    // every tab to close.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Only our own static assets are eligible for caching. Anything else —
// Supabase REST/auth/realtime, the Supabase CDN bundle, Google Fonts — goes
// straight to the network every time. Caching an auth response would be a real
// bug: it could serve one person's session data to another.
function isCacheable(url) {
  return url.origin === self.location.origin
    && !url.pathname.includes("/auth/")
    && !url.search.includes("apikey");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (!isCacheable(url)) return; // let the network handle it untouched

  // Navigations and HTML: network-first, so a new deploy is picked up
  // immediately and you never get yesterday's app from cache.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        // Offline: fall back to the cached page, then the shell.
        return (await caches.match(req)) || (await caches.match("./index.html")) ||
          new Response("Bloom is offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // Static assets: serve from cache for instant loads, but refresh in the
  // background so the next open has the latest.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) caches.open(CACHE_VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await network) ||
      new Response("", { status: 504 });
  })());
});
