import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { completeYandexLink } from "../lib/yandex-auth";

export const YandexLinkConfirmView: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"idle" | "linking" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const token = params.get("token");
  const errorParam = params.get("error");

  useEffect(() => {
    if (errorParam === "OAUTH_LINK_TAKEN") {
      setPhase("error");
      setMessage("Этот Яндекс уже привязан к другому аккаунту PBTH.");
    } else if (!token) {
      setPhase("error");
      setMessage("Ссылка некорректная — токен отсутствует.");
    }
  }, [token, errorParam]);

  const onConfirm = async () => {
    if (!token) return;
    setPhase("linking");
    try {
      await completeYandexLink(token);
      navigate("/app/profile", { replace: true });
    } catch (err) {
      setPhase("error");
      const code = err instanceof Error ? err.message : String(err);
      if (code.includes("OAUTH_LINK_TAKEN")) {
        setMessage("Этот Яндекс уже привязан к другому аккаунту PBTH.");
      } else if (code.includes("OAUTH_PENDING_LINK_EXPIRED")) {
        setMessage("Подтверждение истекло. Запустите привязку Яндекса заново.");
      } else {
        setMessage("Не удалось привязать Яндекс. Попробуйте ещё раз.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-pb-background flex items-center justify-center text-white px-6">
      <div className="max-w-sm w-full">
        <div className="text-2xl font-bold mb-4">Привязать Яндекс?</div>
        {phase === "error" ? (
          <>
            <p className="text-pb-subtext text-sm mb-6">{message}</p>
            <button
              onClick={() => navigate("/app/profile", { replace: true })}
              className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl"
            >
              Назад в профиль
            </button>
          </>
        ) : (
          <>
            <p className="text-pb-subtext text-sm mb-6">
              Вы привязываете Яндекс к вашему аккаунту PBTH. После подтверждения вы сможете входить через Яндекс.
            </p>
            <button
              onClick={onConfirm}
              disabled={phase === "linking" || !token}
              className="w-full bg-pb-primary hover:opacity-90 text-pb-background font-bold py-3 rounded-xl mb-3"
            >
              {phase === "linking" ? "Привязываем…" : "Подтвердить"}
            </button>
            <button
              onClick={() => navigate("/app/profile", { replace: true })}
              disabled={phase === "linking"}
              className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-xl"
            >
              Отмена
            </button>
          </>
        )}
      </div>
    </div>
  );
};
