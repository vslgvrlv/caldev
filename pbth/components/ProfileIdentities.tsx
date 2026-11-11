import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { listIdentities, unlinkProvider, startYandexLink, type Identity } from "../lib/yandex-auth";
import { notify } from "../lib/notify";
import { Button, Glass, Icon, Row } from "../ui";
import "../views/team/team.css";

const PROVIDER_LABELS: Record<string, string> = { telegram: "Telegram", yandex: "Яндекс" };
const PROVIDER_ICONS: Record<string, string> = { telegram: "send", yandex: "link" };

/**
 * Способы входа: что привязано, «Отвязать», «Привязать Яндекс».
 * Пока список не пришёл (или не загрузился), показываем Telegram, как раньше.
 */
export const ProfileIdentities: React.FC<{ telegramNick?: string }> = ({ telegramNick }) => {
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

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

  // The /link/callback finishes server-side and redirects back here with a
  // ?linked / ?link_error flag. Surface it, then strip the params so a refresh
  // doesn't replay the banner.
  useEffect(() => {
    const linked = searchParams.get("linked");
    const linkError = searchParams.get("link_error");
    if (!linked && !linkError) return;
    if (linked === "yandex") {
      notify.success("Яндекс привязан.");
      setError("");
    } else if (linkError === "OAUTH_LINK_TAKEN") {
      setError("Этот Яндекс уже привязан к другому аккаунту PBTH.");
    } else if (linkError) {
      setError("Не удалось привязать Яндекс. Попробуйте ещё раз.");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("linked");
    next.delete("link_error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const yandexLinked = identities ? identities.some((i) => i.provider === "yandex") : false;

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
    <>
      <Glass className="pbth-team__panel">
        {identities === null ? (
          <Row
            lead={
              <span className="pbth-iconlead ui-glass2">
                <Icon name="send" />
              </span>
            }
            title="Telegram"
            sub={telegramNick ? `@${telegramNick}` : undefined}
            trailing={<span className="pbth-muted">привязан</span>}
          />
        ) : (
          identities.map((id) => (
            <Row
              key={id.provider}
              lead={
                <span className="pbth-iconlead ui-glass2">
                  <Icon name={PROVIDER_ICONS[id.provider] ?? "link"} />
                </span>
              }
              title={PROVIDER_LABELS[id.provider] ?? id.provider}
              sub={id.emailMasked || undefined}
              trailing={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === id.provider}
                  onClick={() => void onUnlink(id.provider as "yandex" | "telegram")}
                >
                  {busy === id.provider ? "…" : "Отвязать"}
                </Button>
              }
            />
          ))
        )}
        {identities !== null && !yandexLinked && (
          <div style={{ padding: "8px 0 12px" }}>
            <Button variant="glass2" block icon="link" onClick={() => startYandexLink()}>
              Привязать Яндекс
            </Button>
          </div>
        )}
      </Glass>
      {error && <p className="pbth-warn">{error}</p>}
    </>
  );
};
