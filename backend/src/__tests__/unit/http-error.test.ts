import { describe, expect, it } from "vitest";
import { httpStatusToCode } from "../../lib/http-error.js";

describe("httpStatusToCode", () => {
  it("maps common HTTP statuses", () => {
    expect(httpStatusToCode(400)).toBe("BAD_REQUEST");
    expect(httpStatusToCode(401)).toBe("AUTH_REQUIRED");
    expect(httpStatusToCode(403)).toBe("FORBIDDEN");
    expect(httpStatusToCode(404)).toBe("NOT_FOUND");
    expect(httpStatusToCode(500)).toBe("INTERNAL_SERVER_ERROR");
  });
});
