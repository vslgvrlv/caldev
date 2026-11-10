import { timingSafeEqual } from "node:crypto";

// Защиты, которые включаются только в production.
//
// Секреты: значения по умолчанию из `config/env.ts` годятся только для
// разработки. В production с ними сервер не стартует. Заглушки из примеров
// окружения (`change-me-*`) — громкая ошибка в журнале, но не отказ старта:
// какое значение стоит на боевом сервере, из репозитория не видно, и уронить
// прод на выкате хуже, чем предупредить.

export const DEV_DEFAULT_SECRETS = {
  SESSION_SECRET: "dev-only-change-me",
  ICS_TOKEN_SECRET: "dev-ics-secret",
} as const;

type SecretName = keyof typeof DEV_DEFAULT_SECRETS;

export function checkProductionSecrets(input: {
  isProd: boolean;
  secrets: Record<SecretName, string>;
}): { fatal: string[]; warnings: string[] } {
  const fatal: string[] = [];
  const warnings: string[] = [];
  if (!input.isProd) return { fatal, warnings };
  for (const name of Object.keys(DEV_DEFAULT_SECRETS) as SecretName[]) {
    const value = input.secrets[name] ?? "";
    if (value === DEV_DEFAULT_SECRETS[name]) {
      fatal.push(`${name} uses the development default; set a real secret for production`);
    } else if (/change-me/i.test(value)) {
      warnings.push(`${name} looks like a placeholder from an env example; replace it with a real secret`);
    } else if (value.length < 16) {
      warnings.push(`${name} is shorter than 16 characters`);
    }
  }
  return { fatal, warnings };
}

/** Сравнение секрета без утечки по времени. */
export function safeEqualSecret(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Описание API в production без токена — заглушка с версией, без путей:
 * поверхность API наружу не раскрываем, а проверки выката, которые ищут
 * `"openapi":"3.0.3"`, продолжают работать.
 */
export function openApiForRequest<T extends { openapi: string; info: unknown }>(
  spec: T,
  input: { isProd: boolean; configuredToken: string; providedToken: string }
): T | { openapi: string; info: unknown; paths: Record<string, never> } {
  if (!input.isProd) return spec;
  if (input.configuredToken && safeEqualSecret(input.providedToken, input.configuredToken)) return spec;
  return { openapi: spec.openapi, info: spec.info, paths: {} };
}
