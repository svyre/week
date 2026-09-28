const CACHE = "week-v232-security";
const ASSETS = [
  "./", "./index.html", "./style.css", "./bootstrap.js", "./app.js", "./config.js",
  "./manifest.webmanifest", "./week.png", "./weekdark.png", "./favicon.ico",
  "./week-32.png", "./week-180.png", "./week-192.png", "./week-512.png"
];
const STATIC_PATHS = new Set(ASSETS.map(path => new URL(path, self.location.href).pathname));

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackPath) {
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok && response.status === 200 && response.type === "basic") {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
    }
    return response;
  } catch (_) {
    return (await caches.match(request)) || (fallbackPath ? await caches.match(fallbackPath) : null) || Response.error();
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Навигация может откатиться только к нашему index.html.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  // Не кэшируем произвольные same-origin URL, API-ответы и пользовательские данные.
  if (!STATIC_PATHS.has(url.pathname)) return;
  event.respondWith(networkFirst(request));
});

self.addEventListener("push", event => {
  let data = { title: "week.", body: "Новое напоминание", tag: "week-reminder", url: "./" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    try { if (event.data) data.body = event.data.text(); } catch (_) {}
  }
  event.waitUntil(self.registration.showNotification(String(data.title || "week.").slice(0, 120), {
    body: String(data.body || "Новое напоминание").slice(0, 500),
    tag: String(data.tag || "week-reminder").slice(0, 160),
    data: { url: data.url },
    icon: "./week.png",
    badge: "./week.png"
  }));
});

function safeNotificationUrl(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "./", self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL("./", self.location.origin).href;
  } catch (_) {
    return new URL("./", self.location.origin).href;
  }
}

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = safeNotificationUrl(event.notification.data?.url);
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(url) : null;
    })
  );
});
