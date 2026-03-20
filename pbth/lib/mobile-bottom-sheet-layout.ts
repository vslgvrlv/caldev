export function getMobileBottomSheetLayout(zIndex: number) {
  return {
    lockBodyScroll: true,
    viewportClassName: `fixed inset-0 z-[${zIndex}] flex items-end justify-center`,
    panelClassName:
      "relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[32px] border border-white/10 bg-pb-background shadow-2xl",
    bodyClassName: "min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pb-8 pt-5",
  };
}
