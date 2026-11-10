import React, { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import {
  isPushSupported,
  getPushPermission,
  requestPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  getCurrentSubscription,
} from "../lib/push/push-manager";

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
    <div className="bg-pb-surface rounded-2xl p-4 border border-white/5 space-y-3">
      <button
        onClick={handleToggle}
        disabled={isLoading}
        className="w-full flex items-center justify-between gap-3 text-left disabled:opacity-60"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-pb-primary/15 flex items-center justify-center flex-shrink-0">
            {isSubscribed ? (
              <Bell size={20} className="text-pb-primary" strokeWidth={2.5} />
            ) : (
              <BellOff size={20} className="text-pb-subtext" strokeWidth={2.5} />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-white font-bold text-sm">Push-уведомления</div>
            <div className="text-pb-subtext text-xs">
              {isSubscribed ? "Включены на этом устройстве" : "Напоминания о событиях и оплате"}
            </div>
          </div>
        </div>
        <div
          className={`w-11 h-6 rounded-full flex-shrink-0 relative transition-colors ${
            isSubscribed ? "bg-pb-primary" : "bg-white/10"
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${
              isSubscribed ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </div>
      </button>
      {error && <p className="text-xs text-pb-danger">{error}</p>}
    </div>
  );
};
