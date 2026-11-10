// Push-уведомления (#36). Импортируется в сгенерированный Workbox service
// worker (см. vite.config.ts importScripts) — отдельного SW-файла не заводим,
// иначе у приложения появилось бы два конкурирующих service worker'а.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "PaintBall Team Hub",
      body: event.data.text(),
    };
  }

  const title = payload.title || "PaintBall Team Hub";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.tag || "pbth-reminder",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/app");
      return undefined;
    })
  );
});
