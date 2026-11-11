// Защита наполнителя сценариев от прода (backend/src/db/seeds/scenarios/guard.ts).
// Отказ без явной переменной, отказ на любом признаке прода — и никакого
// флага, который бы этот отказ снимал.

import { describe, expect, it } from "vitest";
import { checkSeedTarget, checkConnectedDatabase } from "../../db/seeds/scenarios/guard.js";

const STAGING_ENV = {
  SEED_SCENARIOS_ALLOW: "staging",
  NODE_ENV: "production",
  DB_HOST: "db",
  DB_PORT: "5432",
  DB_NAME: "pbth_staging",
  FRONTEND_URL: "https://staging.pbthub.ru",
  TELEGRAM_CALLBACK_URL: "https://staging.pbthub.ru/api/v1/auth/telegram/callback",
};

const LOCAL_ENV = {
  SEED_SCENARIOS_ALLOW: "local",
  DB_HOST: "127.0.0.1",
  DB_PORT: "54329",
  DB_NAME: "pbth",
  FRONTEND_URL: "http://127.0.0.1:3000",
};

describe("checkSeedTarget", () => {
  it("отказывает без SEED_SCENARIOS_ALLOW", () => {
    const { SEED_SCENARIOS_ALLOW: _drop, ...env } = LOCAL_ENV;
    const result = checkSeedTarget(env);
    expect(result.ok).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/SEED_SCENARIOS_ALLOW/);
  });

  it("отказывает на неизвестном значении SEED_SCENARIOS_ALLOW, в том числе prod", () => {
    for (const value of ["prod", "production", "yes", "1", "STAGING ", "all"]) {
      const result = checkSeedTarget({ ...STAGING_ENV, SEED_SCENARIOS_ALLOW: value });
      expect(result.ok, value).toBe(false);
    }
  });

  it("пускает staging по его признакам", () => {
    const result = checkSeedTarget(STAGING_ENV);
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.target).toMatchObject({ mode: "staging", database: "pbth_staging", host: "db" });
  });

  it("пускает локальный стенд", () => {
    const result = checkSeedTarget(LOCAL_ENV);
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("отказывает, если имя базы похоже на прод — даже с SEED_SCENARIOS_ALLOW=staging", () => {
    for (const name of ["pbth_prod", "pbth-production", "PROD", "pbth_prod_copy"]) {
      const result = checkSeedTarget({ ...STAGING_ENV, DB_NAME: name });
      expect(result.ok, name).toBe(false);
      expect(result.prodMarkers.length, name).toBeGreaterThan(0);
    }
  });

  it("отказывает на адресе боевого сайта во FRONTEND_URL или TELEGRAM_CALLBACK_URL", () => {
    for (const url of ["https://pbthub.ru", "https://www.pbthub.ru/app", "https://app.pbthub.ru"]) {
      expect(checkSeedTarget({ ...STAGING_ENV, FRONTEND_URL: url }).ok, url).toBe(false);
      expect(
        checkSeedTarget({ ...STAGING_ENV, TELEGRAM_CALLBACK_URL: `${url}/api/v1/auth/telegram/callback` }).ok,
        url
      ).toBe(false);
    }
  });

  it("отказывает, если окружение названо продом в APP_ENV / DEPLOY_ENV / ENV_NAME", () => {
    for (const key of ["APP_ENV", "DEPLOY_ENV", "ENV_NAME", "PBTH_ENV"]) {
      expect(checkSeedTarget({ ...STAGING_ENV, [key]: "prod" }).ok, key).toBe(false);
      expect(checkSeedTarget({ ...LOCAL_ENV, [key]: "production" }).ok, key).toBe(false);
    }
  });

  it("staging требует положительных признаков: база *staging* и адрес staging.*", () => {
    expect(checkSeedTarget({ ...STAGING_ENV, DB_NAME: "pbth" }).ok).toBe(false);
    expect(checkSeedTarget({ ...STAGING_ENV, FRONTEND_URL: "" }).ok).toBe(false);
    expect(checkSeedTarget({ ...STAGING_ENV, FRONTEND_URL: "http://127.0.0.1:3000" }).ok).toBe(false);
  });

  it("local требует локальную базу и не-боевой режим", () => {
    expect(checkSeedTarget({ ...LOCAL_ENV, DB_HOST: "db" }).ok).toBe(false);
    expect(checkSeedTarget({ ...LOCAL_ENV, DB_HOST: "10.0.0.5" }).ok).toBe(false);
    expect(checkSeedTarget({ ...LOCAL_ENV, NODE_ENV: "production" }).ok).toBe(false);
    expect(checkSeedTarget({ ...LOCAL_ENV, DB_NAME: "pbth_staging" }).ok).toBe(false);
    expect(checkSeedTarget({ ...LOCAL_ENV, FRONTEND_URL: "https://staging.pbthub.ru" }).ok).toBe(false);
  });

  it("никакой флаг командной строки не снимает отказ на проде", () => {
    const prodEnv = {
      ...STAGING_ENV,
      DB_NAME: "pbth_prod",
      FRONTEND_URL: "https://pbthub.ru",
      SEED_SCENARIOS_FORCE: "1",
      SEED_SCENARIOS_ALLOW_PROD: "1",
    };
    const result = checkSeedTarget(prodEnv, ["--force", "--allow-prod", "--yes", "--i-know"]);
    expect(result.ok).toBe(false);
  });
});

describe("checkConnectedDatabase", () => {
  it("перепроверяет имя базы, к которой реально подключились", () => {
    const target = checkSeedTarget(STAGING_ENV).target!;
    expect(checkConnectedDatabase(target, "pbth_staging")).toEqual([]);
    expect(checkConnectedDatabase(target, "pbth_prod").length).toBeGreaterThan(0);
    expect(checkConnectedDatabase(target, "pbth").length).toBeGreaterThan(0);
    const local = checkSeedTarget(LOCAL_ENV).target!;
    expect(checkConnectedDatabase(local, "pbth")).toEqual([]);
    expect(checkConnectedDatabase(local, "pbth_production").length).toBeGreaterThan(0);
  });
});
