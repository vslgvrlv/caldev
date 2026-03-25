export function getFinanceTransactionModalLayout() {
  return {
    lockBodyScroll: true,
    viewportClassName: "fixed inset-0 z-[110] overflow-y-auto p-4",
    viewportInnerClassName: "flex min-h-full items-start justify-center py-6 sm:items-center",
    panelClassName:
      "relative my-auto w-full max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto overscroll-contain rounded-3xl border border-white/10 bg-pb-surface p-6 shadow-2xl",
  };
}
