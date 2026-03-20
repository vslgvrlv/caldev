import { describe, expect, it } from "vitest";
import { getMobileBottomSheetLayout } from "../../lib/mobile-bottom-sheet-layout";

describe("getMobileBottomSheetLayout", () => {
  it("returns a flex-column panel with a dedicated scroll body for mobile sheets", () => {
    const layout = getMobileBottomSheetLayout(107);

    expect(layout.lockBodyScroll).toBe(true);
    expect(layout.viewportClassName).toContain("fixed inset-0");
    expect(layout.viewportClassName).toContain("items-end");
    expect(layout.panelClassName).toContain("flex");
    expect(layout.panelClassName).toContain("flex-col");
    expect(layout.panelClassName).toContain("max-h-[88vh]");
    expect(layout.bodyClassName).toContain("min-h-0");
    expect(layout.bodyClassName).toContain("flex-1");
    expect(layout.bodyClassName).toContain("overflow-y-auto");
    expect(layout.bodyClassName).toContain("overscroll-contain");
  });
});
