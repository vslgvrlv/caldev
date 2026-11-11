// Защита наполнителя сценариев от боевой базы.
//
// Три слоя:
//   1. Явное разрешение: без `SEED_SCENARIOS_ALLOW=local|staging` скрипт не
//      работает вообще. Значения `prod` нет и не будет.
//   2. Признаки прода — отказ при любом из них, и никакой флаг или переменная
//      этот отказ не снимает: имя базы с `prod`, адрес боевого сайта
//      (`pbthub.ru`, `www.pbthub.ru`, любой `*.pbthub.ru`, кроме `staging.`) во
//      `FRONTEND_URL` или `TELEGRAM_CALLBACK_URL`, окружение, названное продом
//      в `APP_ENV` / `DEPLOY_ENV` / `ENV_NAME` / `PBTH_ENV`.
//   3. Положительные признаки выбранного режима: для staging — база
//      `*staging*` и адрес `staging.*`; для local — база на этом компьютере,
//      не боевой `NODE_ENV`, локальный адрес приложения. После подключения имя
//      базы перепроверяется по `current_database()`.
//
// Чем различаются окружения, видно из `scripts/release/env.*.example` и
// `docker-compose.release.yml`: `NODE_ENV=production` и `DB_HOST=db` у обоих,
// различаются `DB_NAME` (`pbth_prod` / `pbth_staging`) и `FRONTEND_URL`
// (`https://pbthub.ru` / `https://staging.pbthub.ru`).

export type SeedMode = "local" | "staging";

export type SeedTarget = {
  mode: SeedMode;
  host: string;
  port: number;
  database: string;
  user: string;
  frontendUrl: string;
};

export type SeedTargetCheck = {
  ok: boolean;
  reasons: string[];
  prodMarkers: string[];
  target: SeedTarget | null;
};

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const PROD_DOMAIN = "pbthub.ru";

function hostOf(url: string | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Боевой сайт: сам домен и любой его поддомен, кроме staging. */
function isProdHost(host: string | null): boolean {
  if (!host) return false;
  if (host === PROD_DOMAIN) return true;
  if (!host.endsWith(`.${PROD_DOMAIN}`)) return false;
  return !host.startsWith("staging.");
}

function isStagingHost(host: string | null): boolean {
  return Boolean(host && host.startsWith("staging.") && host.endsWith(`.${PROD_DOMAIN}`));
}

function isLocalHost(host: string | null): boolean {
  return Boolean(host && LOCAL_HOSTS.has(host));
}

function looksLikeProdName(name: string): boolean {
  return /prod/i.test(name);
}

/** Признаки прода в окружении. Любой из них — отказ без исключений. */
export function prodMarkersOf(env: Env): string[] {
  const markers: string[] = [];
  const dbName = String(env.DB_NAME ?? "pbth");
  if (looksLikeProdName(dbName)) markers.push(`DB_NAME=${dbName} похоже на боевую базу`);
  for (const key of ["FRONTEND_URL", "TELEGRAM_CALLBACK_URL", "TELEGRAM_WEBHOOK_URL", "PUBLIC_URL"]) {
    const host = hostOf(env[key]);
    if (isProdHost(host)) markers.push(`${key} указывает на боевой сайт (${host})`);
  }
  for (const key of ["APP_ENV", "DEPLOY_ENV", "ENV_NAME", "PBTH_ENV"]) {
    const value = String(env[key] ?? "").trim().toLowerCase();
    if (value === "prod" || value === "production") markers.push(`${key}=${env[key]} — окружение названо продом`);
  }
  return markers;
}

/**
 * Можно ли писать в базу из этого окружения. `argv` принимается только чтобы
 * показать в тестах: никакой флаг на решение не влияет.
 */
export function checkSeedTarget(env: Env, _argv: readonly string[] = []): SeedTargetCheck {
  const reasons: string[] = [];
  const prodMarkers = prodMarkersOf(env);
  reasons.push(...prodMarkers);

  const allow = env.SEED_SCENARIOS_ALLOW;
  let mode: SeedMode | null = null;
  if (allow === "local" || allow === "staging") {
    mode = allow;
  } else if (allow === undefined || allow === "") {
    reasons.push("Нужна явная переменная SEED_SCENARIOS_ALLOW=local или SEED_SCENARIOS_ALLOW=staging");
  } else {
    reasons.push(`SEED_SCENARIOS_ALLOW=${allow}: допустимы только local и staging`);
  }

  const host = String(env.DB_HOST ?? "127.0.0.1").trim();
  const database = String(env.DB_NAME ?? "pbth").trim();
  const frontendUrl = String(env.FRONTEND_URL ?? "").trim();
  const frontendHost = hostOf(frontendUrl);

  if (mode === "staging") {
    if (!/staging/i.test(database)) reasons.push(`staging: имя базы должно содержать «staging», сейчас DB_NAME=${database}`);
    if (!isStagingHost(frontendHost)) {
      reasons.push(`staging: FRONTEND_URL должен быть staging.${PROD_DOMAIN}, сейчас «${frontendUrl || "пусто"}»`);
    }
  }

  if (mode === "local") {
    if (!LOCAL_HOSTS.has(host.toLowerCase())) reasons.push(`local: база должна быть на этом компьютере, сейчас DB_HOST=${host}`);
    if (String(env.NODE_ENV ?? "").toLowerCase() === "production") reasons.push("local: NODE_ENV=production — это не локальный стенд");
    if (/staging/i.test(database)) reasons.push(`local: DB_NAME=${database} похоже на staging`);
    if (frontendUrl && !isLocalHost(frontendHost)) reasons.push(`local: FRONTEND_URL=${frontendUrl} — не локальный адрес`);
  }

  const ok = reasons.length === 0 && mode !== null;
  return {
    ok,
    reasons,
    prodMarkers,
    target: mode
      ? {
          mode,
          host,
          port: Number(env.DB_PORT ?? 5432),
          database,
          user: String(env.DB_USER ?? "pbth"),
          frontendUrl,
        }
      : null,
  };
}

/** Перепроверка после подключения: та ли это база, что в окружении. */
export function checkConnectedDatabase(target: SeedTarget, currentDatabase: string): string[] {
  const reasons: string[] = [];
  if (currentDatabase !== target.database) {
    reasons.push(`Подключились к базе «${currentDatabase}», а ждали «${target.database}»`);
  }
  if (looksLikeProdName(currentDatabase)) reasons.push(`База «${currentDatabase}» похожа на боевую`);
  if (target.mode === "staging" && !/staging/i.test(currentDatabase)) {
    reasons.push(`staging: база «${currentDatabase}» не похожа на staging`);
  }
  if (target.mode === "local" && /staging/i.test(currentDatabase)) {
    reasons.push(`local: база «${currentDatabase}» похожа на staging`);
  }
  return reasons;
}
