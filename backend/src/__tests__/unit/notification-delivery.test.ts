import { describe, it, expect } from "vitest";
import { classifyDelivery } from "../../lib/notification-delivery.js";

describe("classifyDelivery", () => {
  it("maps SYNC dispatch to SENT", () => {
    expect(classifyDelivery({ mode: "SYNC" })).toEqual({ status: "SENT" });
  });

  it("maps QUEUE dispatch to QUEUED", () => {
    expect(classifyDelivery({ mode: "QUEUE" })).toEqual({ status: "QUEUED" });
  });

  it("maps an error to FAILED with detail from the error message", () => {
    const result = classifyDelivery({ error: new Error("chat not found") });
    expect(result.status).toBe("FAILED");
    expect(result.errorDetail).toBe("chat not found");
  });

  it("treats error as FAILED even when a mode is also present", () => {
    expect(classifyDelivery({ mode: "SYNC", error: "boom" }).status).toBe("FAILED");
  });
});
