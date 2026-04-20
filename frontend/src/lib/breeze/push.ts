// Web Push helpers for Breeze.
//
// Flow:
//   1. Register service worker at /sw.js (root scope)
//   2. Request Notification permission
//   3. Subscribe via PushManager using the VAPID public key
//   4. POST the subscription to the backend so it can send pushes via web-push
//
// The VAPID public key is exposed to the client via `VITE_VAPID_PUBLIC_KEY`.

import { Notifications, type PushSubscriptionPayload } from "./api";

const VAPID_PUBLIC_KEY: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_VAPID_PUBLIC_KEY as string) ?? "";

export type PushStatus =
  | "unsupported"
  | "permission-default"
  | "permission-denied"
  | "permission-granted"
  | "subscribed";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Base64 URL-safe → ArrayBuffer, as required by PushManager.subscribe. */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

function toPayload(sub: PushSubscription): PushSubscriptionPayload {
  const json = sub.toJSON() as {
    endpoint?: string;
    expirationTime?: number | null;
    keys?: { p256dh?: string; auth?: string };
  };
  return {
    endpoint: json.endpoint ?? sub.endpoint,
    expirationTime: json.expirationTime ?? sub.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
  };
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null =
  null;

/** Register (or return cached) service worker at /sw.js. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return Promise.resolve(null);
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .catch((err) => {
      console.error("[push] service worker registration failed", err);
      return null;
    });

  return registrationPromise;
}

export function currentPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Enable push notifications. Registers the SW, asks for permission if needed,
 * subscribes via PushManager, and posts the subscription to the backend.
 * Returns the resulting status.
 */
export async function enablePushNotifications(): Promise<PushStatus> {
  if (!isPushSupported()) return "unsupported";
  if (!VAPID_PUBLIC_KEY) {
    console.warn(
      "[push] VITE_VAPID_PUBLIC_KEY is not set — cannot subscribe to push",
    );
    return "unsupported";
  }

  const reg = await registerServiceWorker();
  if (!reg) return "unsupported";

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission === "denied") return "permission-denied";
  if (permission !== "granted") return "permission-default";

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY),
    }));

  try {
    await Notifications.subscribe(toPayload(sub));
  } catch (err) {
    console.error("[push] failed to POST subscription to backend", err);
    throw err;
  }

  return "subscribed";
}

/**
 * Silent helper: if the user already granted permission in a previous session,
 * make sure the backend has our current subscription. Safe to call on every
 * authenticated mount — it never prompts.
 */
export async function syncPushSubscription(): Promise<PushStatus> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return "unsupported";
  if (Notification.permission !== "granted") {
    return Notification.permission === "denied"
      ? "permission-denied"
      : "permission-default";
  }
  return enablePushNotifications();
}

/** Unsubscribe locally and tell the backend to drop the subscription. */
export async function disablePushNotifications(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch (err) {
    console.warn("[push] pushManager.unsubscribe failed", err);
  }
  try {
    await Notifications.unsubscribe(endpoint);
  } catch (err) {
    console.warn("[push] backend unsubscribe failed", err);
  }
}
