// Bloom service worker — makes the app installable and fast to open.
//
// Deliberately conservative. The one way a service worker can really hurt is by
// serving stale code forever, so:
//   * only same-origin GETs for our own static files are cached;
//   * Supabase (auth, data) and the CDN are NEVER cached — always network;
//   * HTML uses network-first, so a deploy is picked up on the next load;
//   * bumping CACHE_VERSION wipes every old cache.
//
// Push notification handlers live at the bottom of this file.

const CACHE_VERSION = "bloom-v2";

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

// ── PUSH NOTIFICATIONS ────────────────────────────────────────
// The Edge Function sends {title, body, url}. Everything here is defensive:
// a push that throws in this handler shows the browser's generic "This site
// has been updated in the background" notification, which looks broken.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Not JSON — fall back to the raw text rather than dropping the message.
    try { data = { body: event.data.text() }; } catch { data = {}; }
  }

  const title = data.title || "Bloom";
  const options = {
    body: data.body || "New activity in one of your wallets.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    // Collapses repeat notifications from the same wallet into one line rather
    // than stacking five of them on the lock screen.
    tag: data.url || "bloom",
    renotify: true,
    data: { url: data.url || "/finance/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification should land you on the wallet it's about — reusing an
// open Bloom window if there is one, rather than piling up new tabs.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/finance/";

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (client.url.includes("/finance/") && "focus" in client) {
        // Ask the page to route itself; a full navigation would throw away
        // the app's state and reload everything.
        client.postMessage({ type: "notification-click", url: target });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
