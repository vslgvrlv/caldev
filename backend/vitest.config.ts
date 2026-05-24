import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    globals: true,
    // DB-backed tests share a single Postgres instance. Run test files
    // serially so one file's fixtures/cleanup can't race another's rows
    // (e.g. auth_oauth_state / user_identities seeded per file).
    fileParallelism: false,
  },
});
