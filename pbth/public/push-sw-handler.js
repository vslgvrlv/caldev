// Push-уведомления (#36). Импортируется в сгенерированный Workbox service
// worker (см. vite.config.ts importScripts) — отдельного SW-файла не заводим,
// иначе у приложения появилось бы два конкурирующих service worker'а.
//
// Трек 2 ревизии («Явка»):
//   - в данных любого пуша есть `url` — по тапу открывается он (договорённость
//     всех треков); нет `url` — открывается приложение;
//   - пуш о событии несёт кнопки «Иду / Не иду» и ключ ответа: там, где
//     браузер умеет кнопки (Android, Chrome на компьютере), ответ пишется
//     прямо отсюда, без открытия приложения; где не умеет — тап открывает событие.

var PBTH_DEFAULT_URL = "/app";
var PBTH_RSVP_ACTIONS = { "rsvp-yes": "CONFIRMED", "rsvp-no": "DECLINED" };

function pbthSafeUrl(raw) {
  try {
    var url = new URL(raw || PBTH_DEFAULT_URL, self.location.origin);
    // Только свой адрес: пуш не должен уводить на чужой сайт.
    if (url.origin !== self.location.origin) return PBTH_DEFAULT_URL;
    return url.pathname + url.search + url.hash;
  } catch (e) {
    return PBTH_DEFAULT_URL;
  }
}

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
  const hasRsvp = Boolean(payload.rsvp && payload.rsvp.token);
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Свой тег у каждого события: пуш о другом событии не затирает этот.
    tag: payload.tag || "pbth-reminder",
    renotify: Boolean(payload.tag),
    // Ночное сообщение о событии, которое нельзя отложить до утра, — без звука.
    silent: Boolean(payload.silent),
    data: {
      url: pbthSafeUrl(payload.url),
      rsvpToken: hasRsvp ? payload.rsvp.token : null,
    },
  };
  if (hasRsvp && Array.isArray(payload.actions)) {
    options.actions = payload.actions
      .filter((a) => a && PBTH_RSVP_ACTIONS[a.action])
      .map((a) => ({ action: a.action, title: String(a.title || "") }));
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

function pbthOpen(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (!("focus" in client)) continue;
      // Открытое приложение переводим на нужный экран, а не просто показываем.
      if ("navigate" in client && client.url && new URL(client.url).origin === self.location.origin) {
        return client.focus().then((focused) => (focused || client).navigate(url)).catch(() => client.focus());
      }
      return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
    return undefined;
  });
}

function pbthAnswer(notification, status) {
  const data = notification.data || {};
  const url = data.url || PBTH_DEFAULT_URL;
  return fetch("/api/v1/rsvp/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token: data.rsvpToken, status: status }),
  })
    .then((res) => res.json().catch(() => ({})).then((body) => ({ ok: res.ok, body: body })))
    .then((result) => {
      if (!result.ok) return pbthOpen(url);
      // Подтверждение тем же тегом: заменяет пуш, по тапу — событие.
      return self.registration.showNotification(notification.title || "PaintBall Team Hub", {
        body: (result.body && result.body.message) || "Ответ записан.",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: notification.tag || "pbth-reminder",
        renotify: false,
        data: { url: url, rsvpToken: null },
      });
    })
    .catch(() => pbthOpen(url));
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  notification.close();
  const data = notification.data || {};
  const status = PBTH_RSVP_ACTIONS[event.action];
  if (status && data.rsvpToken) {
    event.waitUntil(pbthAnswer(notification, status));
    return;
  }
  event.waitUntil(pbthOpen(data.url || PBTH_DEFAULT_URL));
});
