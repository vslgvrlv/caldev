import React, { useEffect, useState } from "react";
import {
  isPushSupported,
  getPushPermission,
  requestPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  getCurrentSubscription,
} from "../lib/push/push-manager";
import { SwitchRow } from "./profile/SwitchRow";

// Переключатель push-уведомлений в профиле (#36): заменяет Telegram bot как
// основной транспорт напоминаний. На устройствах без поддержки Push API
// (большинство iOS-Safari вне PWA-режима) компонент не рендерится вовсе —
// показывать выключатель, который ничего не может включить, только сбивает.
export const PushOptIn: React.FC = () => {
  const [isSupported] = useState(isPushSupported());
  const [permission, setPermission] = useState(getPushPermission());
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupported) return;
    getCurrentSubscription().then((sub) => setIsSubscribed(Boolean(sub)));
  }, [isSupported]);

  if (!isSupported) return null;

  const handleToggle = async () => {
    setError(null);
    setIsLoading(true);
    try {
      if (isSubscribed) {
        await unsubscribeFromPush();
        setIsSubscribed(false);
      } else {
        let perm = permission;
        if (perm !== "granted") {
          perm = await requestPushPermission();
          setPermission(perm);
        }
        if (perm !== "granted") {
          setError(perm === "denied" ? "Уведомления заблокированы в настройках браузера" : "Разрешение не выдано");
          return;
        }
        const subscription = await subscribeToPush();
        setIsSubscribed(Boolean(subscription));
        if (!subscription) {
          setError("Push пока недоступен на сервере");
        }
      }
    } catch {
      setError("Не получилось переключить push-уведомления");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <SwitchRow
        icon={isSubscribed ? "bell" : "bell-off"}
        title="Push-уведомления"
        sub={isSubscribed ? "Включены на этом устройстве" : "Напоминания о событиях и оплате"}
        checked={isSubscribed}
        disabled={isLoading}
        onChange={() => void handleToggle()}
      />
      {error && <p className="pbth-warn">{error}</p>}
    </>
  );
};
