const CACHE_NAME = "missile-calm-v4";
const APP_ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.webmanifest", "./icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isApiRequest = requestUrl.pathname.includes("/api/");
  const isCrossOrigin = requestUrl.origin !== self.location.origin;
  const acceptsEventStream = (event.request.headers.get("accept") || "").includes("text/event-stream");

  if (isApiRequest || isCrossOrigin || acceptsEventStream) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "SHOW_ALERT_NOTIFICATION") {
    return;
  }

  const payload = event.data.payload || {};
  const title = payload.title || "התרעה חדשה";
  const body = payload.message || "נכנסה התראה";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "./icons/icon.svg",
      badge: "./icons/icon.svg",
      tag: payload.id || "alert",
      data: payload
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((openClients) => {
      for (const client of openClients) {
        if ("focus" in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow("./");
      }
      return null;
    })
  );
});
