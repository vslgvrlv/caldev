// Web Push (#36): транспорт напоминаний вместо Telegram bot. Хостинг режет
// исходящий трафик на Telegram, а Web Push идёт прямым TLS к сервису push
// браузера и не нуждается в relay.
import { api } from '../../api';

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function getPushPermission(): PushPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as PushPermissionState;
}

export function isPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

export async function requestPushPermission(): Promise<PushPermissionState> {
  if (!isPushSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  return result as PushPermissionState;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Подписывает браузер на push и сразу отправляет подписку на сервер — иначе
 * сервер не будет знать, куда слать, даже если браузер сам подписался.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const vapidPublicKey = await api.getVapidPublicKey();
  if (!vapidPublicKey) return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));

  await api.subscribePush(subscription.toJSON() as PushSubscriptionJSON);
  return subscription;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const subscription = await getCurrentSubscription();
  if (!subscription) return false;
  const endpoint = subscription.endpoint;
  const unsubscribed = await subscription.unsubscribe();
  if (unsubscribed) {
    await api.unsubscribePush(endpoint).catch(() => {
      // Браузер уже отписан — даже если сервер недоступен прямо сейчас,
      // следующая попытка подписки перезапишет устаревшую строку по endpoint.
    });
  }
  return unsubscribed;
}
