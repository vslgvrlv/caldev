import React, { useEffect, useState } from "react";
import { listIdentities, unlinkProvider, startYandexLink, type Identity } from "../lib/yandex-auth";

export const ProfileIdentities: React.FC = () => {
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    try {
      const list = await listIdentities();
      setIdentities(list);
      setError("");
    } catch {
      setError("Не удалось загрузить список входов.");
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  if (identities === null) return null; // initial loading

  const linked = new Set(identities.map((i) => i.provider));
  const yandexLinked = linked.has("yandex");

  const onUnlink = async (provider: "yandex" | "telegram") => {
    setBusy(provider);
    setError("");
    try {
      await unlinkProvider(provider);
      await reload();
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      if (code.includes("OAUTH_LAST_IDENTITY")) {
        setError("Нельзя отвязать последний способ входа.");
      } else if (code.includes("FORBIDDEN")) {
        setError("Telegram нельзя отвязать с правами админа.");
      } else {
        setError("Не удалось отвязать. Попробуйте ещё раз.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-pb-surface rounded-2xl p-4 mt-4">
      <div className="text-white font-bold mb-3">Способы входа</div>
      {error && (
        <div className="mb-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}
      <div className="space-y-2">
        {identities.map((id) => (
          <div
            key={id.provider}
            className="flex items-center justify-between bg-white/5 rounded-xl px-3 py-2"
          >
            <div>
              <div className="text-white text-sm font-semibold capitalize">{id.provider}</div>
              {id.emailMasked && <div className="text-pb-subtext text-xs">{id.emailMasked}</div>}
            </div>
            <button
              onClick={() => onUnlink(id.provider as "yandex" | "telegram")}
              disabled={busy === id.provider}
              className="text-xs text-red-300 hover:text-red-200 disabled:opacity-50"
            >
              {busy === id.provider ? "…" : "Отвязать"}
            </button>
          </div>
        ))}
        {!yandexLinked && (
          <button
            onClick={() => startYandexLink()}
            className="w-full bg-[#FFCC00] hover:bg-[#FFB800] text-black font-bold py-3 rounded-xl mt-2"
          >
            Привязать Яндекс
          </button>
        )}
      </div>
    </div>
  );
};
