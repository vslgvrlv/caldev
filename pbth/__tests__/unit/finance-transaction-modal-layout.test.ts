import { describe, expect, it } from "vitest";
import { getFinanceTransactionModalLayout } from "../../lib/finance-transaction-modal-layout";

describe("getFinanceTransactionModalLayout", () => {
  it("returns mobile-safe scroll containment classes for the expense modal", () => {
    const layout = getFinanceTransactionModalLayout();

    expect(layout.lockBodyScroll).toBe(true);
    expect(layout.viewportClassName).toContain("overflow-y-auto");
    expect(layout.panelClassName).toContain("overflow-y-auto");
    expect(layout.panelClassName).toContain("overscroll-contain");
    expect(layout.panelClassName).toContain("max-h-[calc(100vh-2rem)]");
  });
});
