import crypto from "node:crypto";
import { env } from "../config/env.js";

type JwtHeader = {
  alg: string;
  kid?: string;
  typ?: string;
};

type JwtClaims = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  preferred_username?: string;
  username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
};

type JwkKey = {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
};

let jwksCache: { expiresAt: number; keys: JwkKey[] } | null = null;

function toBase64Url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function randomToken(bytes = 32): string {
  return toBase64Url(crypto.randomBytes(bytes));
}

export function createOidcChallenge() {
  const codeVerifier = randomToken(64);
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeChallenge = toBase64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  return { state, nonce, codeVerifier, codeChallenge };
}

export function buildOidcAuthorizeUrl(params: {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}) {
  const url = new URL(env.telegramOidc.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.telegramOidc.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function loadJwks(): Promise<JwkKey[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) {
    return jwksCache.keys;
  }
  const res = await fetch(env.telegramOidc.jwksUrl, { method: "GET" });
  if (!res.ok) {
    throw new Error(`OIDC_JWKS_FETCH_FAILED:${res.status}`);
  }
  const body = (await res.json()) as { keys?: JwkKey[] };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new Error("OIDC_JWKS_EMPTY");
  }
  jwksCache = {
    keys: body.keys,
    expiresAt: now + 5 * 60 * 1000,
  };
  return body.keys;
}

export async function exchangeOidcCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectUri);
  body.set("client_id", env.telegramOidc.clientId);
  body.set("client_secret", env.telegramOidc.clientSecret);
  body.set("code_verifier", params.codeVerifier);

  const res = await fetch(env.telegramOidc.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OIDC_TOKEN_EXCHANGE_FAILED:${res.status}:${text.slice(0, 240)}`);
  }
  const payload = (await res.json()) as {
    id_token?: string;
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (!payload.id_token) {
    throw new Error("OIDC_ID_TOKEN_MISSING");
  }
  return payload;
}

function validateAud(claimAud: string | string[] | undefined, clientId: string) {
  if (!claimAud) return false;
  if (Array.isArray(claimAud)) return claimAud.includes(clientId);
  return claimAud === clientId;
}

export async function verifyOidcIdToken(params: {
  idToken: string;
  expectedNonce?: string;
}) {
  const parts = params.idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("OIDC_TOKEN_INVALID");
  }
  const [encodedHeader, encodedClaims, encodedSig] = parts;
  const header = parseJson<JwtHeader>(fromBase64Url(encodedHeader).toString("utf8"));
  const claims = parseJson<JwtClaims>(fromBase64Url(encodedClaims).toString("utf8"));

  if (header.alg !== "RS256") {
    throw new Error("OIDC_ALG_UNSUPPORTED");
  }

  const keys = await loadJwks();
  const key = keys.find((k) => k.kid && header.kid && k.kid === header.kid) || keys[0];
  if (!key) {
    throw new Error("OIDC_KEY_NOT_FOUND");
  }

  const publicKey = crypto.createPublicKey({
    key: key as crypto.JsonWebKey,
    format: "jwk",
  });
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedClaims}`);
  verifier.end();
  const signatureOk = verifier.verify(publicKey, fromBase64Url(encodedSig));
  if (!signatureOk) {
    throw new Error("OIDC_SIGNATURE_INVALID");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const skew = env.telegramOidc.clockSkewSeconds;
  if (!claims.exp || claims.exp + skew < nowSec) {
    throw new Error("OIDC_TOKEN_EXPIRED");
  }
  if (!claims.iat || claims.iat - skew > nowSec) {
    throw new Error("OIDC_TOKEN_IAT_INVALID");
  }
  if (claims.iss !== env.telegramOidc.issuer) {
    throw new Error("OIDC_ISSUER_INVALID");
  }
  if (!validateAud(claims.aud, env.telegramOidc.clientId)) {
    throw new Error("OIDC_AUDIENCE_INVALID");
  }
  if (params.expectedNonce && claims.nonce && claims.nonce !== params.expectedNonce) {
    throw new Error("OIDC_NONCE_INVALID");
  }
  if (!claims.sub) {
    throw new Error("OIDC_SUB_MISSING");
  }

  return {
    header,
    claims,
    profile: {
      id: String(claims.sub),
      first_name: claims.given_name || claims.name || undefined,
      last_name: claims.family_name || undefined,
      username: claims.preferred_username || claims.username || undefined,
      photo_url: claims.picture || undefined,
    },
  };
}

