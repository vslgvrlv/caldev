import { beforeAll, describe, expect, it } from "vitest";

let getRequestPublicOrigin: typeof import("../../lib/public-origin.js").getRequestPublicOrigin;

beforeAll(async () => {
  process.env.FRONTEND_URL = "https://pbthub.ru";
  process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123456:dummy-token";
  process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";
  ({ getRequestPublicOrigin } = await import("../../lib/public-origin.js"));
});

describe("auth public origin canonicalization", () => {
  it("uses the configured canonical frontend origin instead of a www host alias", () => {
    const origin = getRequestPublicOrigin({
      host: "www.pbthub.ru",
      forwardedProto: "https",
    });

    expect(origin).toBe("https://pbthub.ru");
  });

  it("keeps localhost hosts for local development", () => {
    const origin = getRequestPublicOrigin({
      host: "127.0.0.1:3000",
      forwardedProto: "http",
    });

    expect(origin).toBe("http://127.0.0.1:3000");
  });
});
