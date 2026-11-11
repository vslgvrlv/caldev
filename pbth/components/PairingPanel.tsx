// Экран входа по коду сопряжения (#109) — вид для входа владельца.
//
// Ни одна кнопка здесь не обязательна для входа. «Открыть Telegram» — только
// удобство; механизм держится на коде, который можно отправить боту руками.
// Схема, которая ломается вместе с диплинком, — это то, что мы убрали.
// Логика — в usePairing, её же использует новый экран входа.

import React from 'react';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import { formatPairingCountdown, pairingStatusMessage } from '../lib/pairing';
import { usePairing } from '../lib/use-pairing';

interface PairingPanelProps {
  scope: 'USER' | 'ADMIN';
  redirectTo: string;
  onAuthenticated: (redirectTo: string) => void;
}

export const PairingPanel: React.FC<PairingPanelProps> = ({ scope, redirectTo, onAuthenticated }) => {
  const { state, code, botUrl, botUsername, secondsLeft, copied, handleCopy, requestCode } = usePairing({
    scope,
    redirectTo,
    onAuthenticated,
  });

  if (state === 'starting' || state === 'idle') {
    return (
      <div className="flex justify-center py-10">
        <Loader2 size={22} className="animate-spin text-pb-subtext" />
      </div>
    );
  }

  const isDead = state === 'expired' || state === 'denied' || state === 'error';

  return (
    <div className="space-y-4">
      {!isDead && (
        <>
          <div className="rounded-2xl border border-white/10 bg-pb-surface p-5 text-center">
            <div className="text-xs uppercase tracking-wider text-pb-subtext">Код для входа</div>
            <button
              onClick={handleCopy}
              className="mt-2 flex w-full items-center justify-center gap-3 text-white transition-colors active:scale-[0.99]"
            >
              {/* Код целиком в одну строку: на телефоне шириной 390 при
                  text-4xl с разрядкой он рвался по дефису на две строки. */}
              <span className="whitespace-nowrap text-3xl font-black tracking-[0.12em] tabular-nums sm:text-4xl sm:tracking-[0.2em]">
                {code}
              </span>
              {copied ? (
                <Check size={18} className="text-pb-primary" />
              ) : (
                <Copy size={18} className="text-pb-subtext" />
              )}
            </button>
            <div className="mt-3 text-xs text-pb-subtext">
              Действует {formatPairingCountdown(secondsLeft)}
            </div>
          </div>

          <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-pb-surface px-4 py-3.5 font-semibold text-white transition-colors hover:bg-white/5 active:scale-[0.99]"
          >
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-[#24A1DE] text-[10px] font-black tracking-tight text-white">
              tg
            </span>
            <span>Открыть Telegram</span>
          </a>

          {/* Инструкция на случай, когда кнопка выше не сработала. Именно этот
              случай — тупик «START BOT» — и был инцидентом. */}
          <p className="text-xs leading-relaxed text-pb-subtext/80">
            Кнопка не сработала? Откройте Telegram сами, найдите{' '}
            <span className="text-pb-subtext">@{botUsername}</span> и отправьте ему код{' '}
            <span className="text-pb-subtext">{code}</span>. Затем нажмите «Это я, войти» — прямо в чате,
            никуда переходить не нужно.
          </p>

          <div className="flex items-center justify-center gap-2 text-sm text-pb-subtext">
            <Loader2 size={14} className="animate-spin" />
            {pairingStatusMessage(state)}
          </div>
        </>
      )}

      {isDead && (
        <div className="rounded-xl border border-white/10 bg-pb-surface px-4 py-4 text-center text-sm text-pb-subtext">
          {pairingStatusMessage(state)}
        </div>
      )}

      <button
        onClick={() => void requestCode()}
        className="flex w-full items-center justify-center gap-2 py-2 text-sm text-pb-subtext transition-colors hover:text-white"
      >
        <RefreshCw size={14} />
        Получить новый код
      </button>
    </div>
  );
};
