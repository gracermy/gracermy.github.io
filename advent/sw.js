// Our Advent Calendar service worker: makes it installable, opens it fast,
// and shows the notifications. Modelled on Bloom's (finance/sw.js).
//
// Kept conservative so it can never serve stale code for long:
//   * only our own files are cached; Supabase is never cached;
//   * the page itself is network-first, so a new deploy shows up on next open;
//   * bumping CACHE_VERSION wipes the old cache.

const CACHE_VERSION = "advent-v6";

const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./schedule.js",
  "./store.js",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "../finance/config.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("advent-") && k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, fonts: straight to the network

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        (await caches.open(CACHE_VERSION)).put("./index.html", fresh.clone());
        return fresh;
      } catch {
        return (await caches.match("./index.html")) ||
          new Response("The calendar is offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // Files: answer from cache instantly, refresh in the background.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) caches.open(CACHE_VERSION).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response("", { status: 504 });
  })());
});

// ── Notifications ──
// The advent-push function sends { title, body, url, tag }.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { try { data = { body: event.data.text() }; } catch {} }
  event.waitUntil(self.registration.showNotification(data.title || "Our Advent Calendar 🎄", {
    body: data.body || "Something new is waiting for you.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: data.tag || "advent",
    renotify: true,
    data: { url: data.url || "/advent/" },
  }));
});

// Tapping a notification opens the calendar on the right door, reusing an
// open window if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/advent/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.includes("/advent/") && "focus" in w) {
        w.postMessage({ type: "open", url: target });
        return w.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
