export interface Identity {
  provider: string;
  emailMasked: string | null;
  linkedAt: string;
}

export async function listIdentities(): Promise<Identity[]> {
  const res = await fetch("/api/v1/auth/identities", { credentials: "include" });
  if (!res.ok) throw new Error(`identities_failed:${res.status}`);
  const body = await res.json();
  return body.identities;
}

export async function unlinkProvider(provider: "yandex" | "telegram"): Promise<void> {
  const res = await fetch("/api/v1/auth/yandex/unlink", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.code || `unlink_failed:${res.status}`);
  }
}

export function startYandexLink(): void {
  // Server-side OAuth flow — just navigate.
  window.location.assign("/api/v1/auth/yandex/link/start");
}
