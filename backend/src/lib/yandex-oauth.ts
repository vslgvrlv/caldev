import { env } from "../config/env.js";

export interface YandexUserInfo {
  id: string;
  login: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface YandexTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export function buildYandexAuthorizeUrl(params: { state: string; redirectUri: string }): string {
  const url = new URL(env.yandexOAuth.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.yandexOAuth.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  // force_confirm=yes makes Yandex always show its consent screen, so a
  // logged-in user can choose a different account if needed.
  url.searchParams.set("force_confirm", "yes");
  return url.toString();
}

export async function exchangeYandexCode(params: { code: string; redirectUri: string }): Promise<YandexTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectUri);
  body.set("client_id", env.yandexOAuth.clientId);
  body.set("client_secret", env.yandexOAuth.clientSecret);

  const res = await fetch(env.yandexOAuth.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YANDEX_TOKEN_FAILED:${res.status}:${text.slice(0, 200)}`);
  }
  return (await res.json()) as YandexTokenResponse;
}

export async function fetchYandexUserInfo(accessToken: string): Promise<YandexUserInfo> {
  const url = new URL(env.yandexOAuth.userInfoUrl);
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YANDEX_USERINFO_FAILED:${res.status}:${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, any>;
  const avatarId = data.default_avatar_id ? String(data.default_avatar_id) : null;
  return {
    id: String(data.id),
    login: data.login ? String(data.login) : null,
    email: data.default_email ? String(data.default_email) : null,
    firstName: data.first_name ? String(data.first_name) : null,
    lastName: data.last_name ? String(data.last_name) : null,
    displayName: data.real_name || data.display_name || null,
    avatarUrl: avatarId ? `https://avatars.yandex.net/get-yapic/${avatarId}/islands-200` : null,
  };
}
