/* Breeze service worker — handles web push for offline/backgrounded users.
 *
 * Backend (NotificationsService.notifyNewMessage) sends payloads shaped like:
 *   {
 *     type: "new_message",
 *     room: "<conversationId>",
 *     message: { id, senderId, message, sentAt }
 *   }
 */

/* eslint-disable no-restricted-globals */

self.addEventListener("install", () => {
  // Activate immediately on first install / update
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch (_) {
    try {
      return { type: "unknown", text: event.data.text() };
    } catch (_err) {
      return null;
    }
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePayload(event) ?? {};

  let title = "Breeze";
  let body = "";
  let tag = "breeze-generic";
  const data = { url: "/app" };

  if (payload.type === "new_message" && payload.message) {
    title = "New message";
    body =
      typeof payload.message.message === "string"
        ? payload.message.message
        : "You have a new message";
    tag = `breeze-room-${payload.room}`;
    if (payload.room) {
      data.url = `/app/${payload.room}`;
      data.room = payload.room;
    }
  } else if (typeof payload.title === "string") {
    title = payload.title;
    body = typeof payload.body === "string" ? payload.body : "";
    if (typeof payload.url === "string") data.url = payload.url;
  } else if (typeof payload.text === "string") {
    body = payload.text;
  }

  const options = {
    body,
    tag,
    renotify: true,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/app";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Prefer an already-open Breeze window — focus it and navigate.
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          const here = new URL(targetUrl, url.origin);
          if (url.origin === here.origin) {
            await client.focus();
            if ("navigate" in client && client.url !== here.href) {
              try {
                await client.navigate(here.href);
              } catch (_) {
                client.postMessage({ type: "breeze:navigate", url: targetUrl });
              }
            } else {
              client.postMessage({ type: "breeze:navigate", url: targetUrl });
            }
            return;
          }
        } catch (_) {
          // ignore malformed URLs
        }
      }

      // No window open — open a new one.
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

// Optional: surface subscription changes so the page can re-subscribe.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      clients.forEach((c) =>
        c.postMessage({ type: "breeze:pushsubscriptionchange" }),
      );
    })(),
  );
});
