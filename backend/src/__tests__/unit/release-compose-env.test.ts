import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Настройки сервера попадают в контейнер бэкенда только через раздел
// `environment` в docker-compose.release.yml. Переменная из файла окружения,
// которой там нет, до процесса не доходит и молча остаётся значением по
// умолчанию: так 11.11.2026 авто-напоминания нельзя было включить на сервере.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const compose = readFileSync(resolve(repoRoot, "docker-compose.release.yml"), "utf8");
const backendBlock = compose.slice(compose.indexOf("\n  backend:"), compose.indexOf("\n  frontend:"));

function passedThrough(name: string): string | null {
  const match = backendBlock.match(new RegExp(`^\\s+${name}: (\\$\\{${name}(?::-[^}]*)?\\})\\s*$`, "m"));
  return match ? match[1] : null;
}

describe("release compose: настройки доходят до бэкенда", () => {
  it("нашёл раздел бэкенда", () => {
    expect(backendBlock).toContain("environment:");
  });

  it.each([
    "AUTO_REMINDERS_ENABLED",
    "AUTO_REMINDERS_INTERVAL_SECONDS",
    "NOTIFICATIONS_QUEUE_ENABLED",
    "PUSH_NOTIFICATIONS_ENABLED",
    "ADMIN_ROLE_ALLOWLIST_IDS",
    "AUTH_SLO_TOKEN",
    "OPENAPI_TOKEN",
  ])("%s передаётся из файла окружения", (name) => {
    expect(passedThrough(name)).not.toBeNull();
  });

  it("авто-напоминания выключены, пока их не включили в файле окружения", () => {
    expect(passedThrough("AUTO_REMINDERS_ENABLED")).toBe("${AUTO_REMINDERS_ENABLED:-0}");
  });

  it("у интервала проверки числовое значение по умолчанию, а не пустая строка", () => {
    // Пустая строка даёт Number("") = 0, и проверка шла бы каждые 10 секунд.
    expect(passedThrough("AUTO_REMINDERS_INTERVAL_SECONDS")).toMatch(/:-\d+\}$/);
  });
});
