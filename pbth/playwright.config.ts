import { defineConfig } from "@playwright/test";

const runtimeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: runtimeProcess?.env?.E2E_BASE_URL || "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  reporter: [["list"]],
});
