import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listIdentities, completeYandexLink, unlinkProvider } from "../../lib/yandex-auth";

describe("yandex-auth client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("listIdentities returns array", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        identities: [{ provider: "telegram", emailMasked: null, linkedAt: "2026-05-10" }],
      }),
    });
    const r = await listIdentities();
    expect(r).toHaveLength(1);
    expect(r[0].provider).toBe("telegram");
  });

  it("listIdentities throws on !ok", async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(listIdentities()).rejects.toThrow(/identities_failed:401/);
  });

  it("completeYandexLink throws server code on 409", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ code: "OAUTH_LINK_TAKEN" }),
    });
    await expect(completeYandexLink("tok")).rejects.toThrow(/OAUTH_LINK_TAKEN/);
  });

  it("completeYandexLink throws server code on 410 expired", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ code: "OAUTH_PENDING_LINK_EXPIRED" }),
    });
    await expect(completeYandexLink("tok")).rejects.toThrow(/OAUTH_PENDING_LINK_EXPIRED/);
  });

  it("unlinkProvider throws server code on 409 LAST_IDENTITY", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ code: "OAUTH_LAST_IDENTITY" }),
    });
    await expect(unlinkProvider("yandex")).rejects.toThrow(/OAUTH_LAST_IDENTITY/);
  });
});
