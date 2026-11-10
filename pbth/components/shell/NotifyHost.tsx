// ui-kit-allow-file: решение Василия 10.11.2026 — в ревизии PBTH ui-kit не подключаем, вид меняет отдельная сессия; тост и окно в нынешнем виде приложения
import React from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import { dismissToast, subscribeNotify, type NotifyState } from '../../lib/notify';

// Показывает сообщения из pbth/lib/notify.ts: короткие плашки сверху и окно
// подтверждения. Монтируется один раз в корне приложения.
export const NotifyHost: React.FC = () => {
  const [state, setState] = React.useState<NotifyState>({ toasts: [], confirm: null });

  React.useEffect(() => subscribeNotify(setState), []);

  const { toasts, confirm } = state;

  React.useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') confirm.resolve(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  return (
    <>
      {toasts.length > 0 && (
        <div
          className="fixed inset-x-0 top-0 z-[200] pointer-events-none px-4"
          style={{ paddingTop: 'calc(var(--pb-safe-top) + 0.75rem)' }}
          role="status"
          aria-live="polite"
        >
          <div className="max-w-md mx-auto space-y-2">
            {toasts.map((toast) => {
              const Icon = toast.kind === 'error' ? AlertTriangle : toast.kind === 'success' ? CheckCircle : Info;
              const tone =
                toast.kind === 'error'
                  ? 'border-pb-danger/40 text-white'
                  : toast.kind === 'success'
                    ? 'border-pb-primary/40 text-white'
                    : 'border-white/10 text-white';
              const iconTone =
                toast.kind === 'error' ? 'text-pb-danger' : toast.kind === 'success' ? 'text-pb-primary' : 'text-pb-subtext';
              return (
                <div
                  key={toast.id}
                  className={`pointer-events-auto flex items-start gap-3 rounded-2xl border bg-pb-surface px-4 py-3 shadow-xl animate-fade-in ${tone}`}
                >
                  <Icon size={18} className={`mt-0.5 shrink-0 ${iconTone}`} />
                  <div className="flex-1 text-sm whitespace-pre-line">{toast.text}</div>
                  <button
                    type="button"
                    aria-label="Закрыть"
                    onClick={() => dismissToast(toast.id)}
                    className="shrink-0 text-pb-subtext hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center bg-black/60 p-4"
          onClick={() => confirm.resolve(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-pb-surface p-5 shadow-2xl"
            style={{ marginBottom: 'var(--pb-safe-bottom)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white text-base whitespace-pre-line mb-5">{confirm.text}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => confirm.resolve(false)}
                className="flex-1 bg-white/10 text-white px-4 py-3 rounded-xl font-bold"
              >
                {confirm.cancelLabel}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => confirm.resolve(true)}
                className={`flex-1 px-4 py-3 rounded-xl font-bold ${
                  confirm.danger ? 'bg-pb-danger text-white' : 'bg-pb-primary text-pb-background'
                }`}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
