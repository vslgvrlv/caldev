import { beforeEach, describe, expect, it } from "vitest";
import { getAuthSloSummary, recordAuthMetric, resetAuthMetricsForTests } from "../../lib/auth-slo.js";

describe("auth slo summary", () => {
  beforeEach(() => {
    resetAuthMetricsForTests();
  });

  it("returns insufficient_data below min attempts", () => {
    recordAuthMetric({ method: "OIDC", platform: "android", outcome: "ATTEMPT" });
    recordAuthMetric({ method: "OIDC", platform: "android", outcome: "SUCCESS" });

    const summary = getAuthSloSummary({
      windowMinutes: 60,
      minAttempts: 5,
      maxErrorRate: 0.1,
    });

    expect(summary.status).toBe("insufficient_data");
  });

  it("returns breached when error budget exceeded", () => {
    for (let i = 0; i < 10; i++) {
      recordAuthMetric({ method: "OIDC", platform: "ios", outcome: "ATTEMPT" });
    }
    for (let i = 0; i < 7; i++) {
      recordAuthMetric({ method: "OIDC", platform: "ios", outcome: "SUCCESS" });
    }
    for (let i = 0; i < 3; i++) {
      recordAuthMetric({ method: "OIDC", platform: "ios", outcome: "ERROR", code: "OIDC_STATE_EXPIRED" });
    }

    const summary = getAuthSloSummary({
      windowMinutes: 60,
      minAttempts: 5,
      maxErrorRate: 0.2,
    });

    expect(summary.status).toBe("breached");
    expect(summary.errorRate).toBe(0.3);
  });

  it("returns ok when error rate within budget", () => {
    for (let i = 0; i < 20; i++) {
      recordAuthMetric({ method: "WEBAPP", platform: "android", outcome: "ATTEMPT" });
    }
    for (let i = 0; i < 19; i++) {
      recordAuthMetric({ method: "WEBAPP", platform: "android", outcome: "SUCCESS" });
    }
    recordAuthMetric({ method: "WEBAPP", platform: "android", outcome: "ERROR", code: "AUTH_REPLAY_DETECTED" });

    const summary = getAuthSloSummary({
      windowMinutes: 60,
      minAttempts: 10,
      maxErrorRate: 0.1,
    });

    expect(summary.status).toBe("ok");
    expect(summary.successRate).toBe(0.95);
  });
});
