import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readRelative(relativePath: string) {
  return fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("release env contract", () => {
  it("passes Telegram relay transport env vars into the backend container", () => {
    const compose = readRelative("../../../../docker-compose.release.yml");

    expect(compose).toContain("TELEGRAM_BOT_API_BASE_URL:");
    expect(compose).toContain("TELEGRAM_BOT_API_RELAY_TOKEN:");
  });

  it("documents Telegram relay transport env vars in release env examples", () => {
    const prodExample = readRelative("../../../../scripts/release/env.prod.example");
    const stagingExample = readRelative("../../../../scripts/release/env.staging.example");

    expect(prodExample).toContain("TELEGRAM_BOT_API_BASE_URL=");
    expect(prodExample).toContain("TELEGRAM_BOT_API_RELAY_TOKEN=");
    expect(stagingExample).toContain("TELEGRAM_BOT_API_BASE_URL=");
    expect(stagingExample).toContain("TELEGRAM_BOT_API_RELAY_TOKEN=");
  });
});
