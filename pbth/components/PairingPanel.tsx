// Экран входа по коду сопряжения (#109).
//
// Ни одна кнопка здесь не обязательна для входа. «Открыть Telegram» — только
// удобство; механизм держится на коде, который можно отправить боту руками.
// Схема, которая ломается вместе с диплинком, — это то, что мы убрали.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../api';
import {
  formatPairingCountdown,
  nextPollDelayMs,
  pairingSecondsLeft,
  pairingStatusMessage,
  shouldKeepPolling,
  type PairingScreenState,
} from '../lib/pairing';

interface PairingPanelProps {
  scope: 'USER' | 'ADMIN';
  redirectTo: string;
  onAuthenticated: (redirectTo: string) => void;
}

export const PairingPanel: React.FC<PairingPanelProps> = ({ scope, redirectTo, onAuthenticated }) => {
  const [state, setState] = useState<PairingScreenState>('idle');
  const [code, setCode] = useState('');
  const [botUrl, setBotUrl] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [copied, setCopied] = useState(false);

  // Опрос живёт в ref, а не в стейте: перерисовка не должна ни останавливать
  // его, ни заводить второй параллельный.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const activeCode = useRef('');

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    const current = activeCode.current;
    if (!current) return;
    try {
      const result = await api.getPairingStatus(current);
      if (activeCode.current !== current) return;

      if (result.status === 'approved') {
        // Сессионная кука пришла на ЭТОТ ответ — в банку этого браузера.
        // Дальше приложение просто перерисовывается залогиненным.
        setState('approved');
        stopPolling();
        onAuthenticated(result.redirectTo || redirectTo);
        return;
      }
      if (result.status === 'denied' || result.status === 'expired') {
        setState(result.status);
        stopPolling();
        return;
      }
      setState(result.status === 'claimed' ? 'claimed' : 'waiting');
    } catch {
      // Сеть моргнула или ушли в офлайн — это не повод хоронить попытку:
      // код на экране всё ещё жив, следующий тик попробует снова.
    }
    if (activeCode.current !== current) return;
    pollTimer.current = setTimeout(poll, nextPollDelayMs(Date.now() - startedAt.current));
  }, [onAuthenticated, redirectTo, stopPolling]);

  const requestCode = useCallback(async () => {
    stopPolling();
    setState('starting');
    setCopied(false);
    try {
      const started = await api.startPairing(scope, redirectTo);
      setCode(started.code);
      setBotUrl(started.botUrl);
      setBotUsername(started.botUsername);
      setExpiresAt(started.expiresAt);
      activeCode.current = started.code;
      startedAt.current = Date.now();
      setState('waiting');
      pollTimer.current = setTimeout(poll, nextPollDelayMs(0));
    } catch {
      setState('error');
    }
  }, [poll, redirectTo, scope, stopPolling]);

  useEffect(() => {
    void requestCode();
    return stopPolling;
    // Код запрашивается один раз на монтирование: перезапрос — только по
    // явной кнопке, иначе перерисовка плодила бы попытки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Обратный отсчёт и смерть попытки по часам на клиенте: сервер тоже её
  // похоронит, но экран не должен ждать ответа, чтобы это показать.
  useEffect(() => {
    if (!expiresAt || !shouldKeepPolling(state)) return;
    const tick = () => {
      const left = pairingSecondsLeft(expiresAt, Date.now());
      setSecondsLeft(left);
      if (left === 0) {
        setState('expired');
        stopPolling();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, state, stopPolling]);

  // Вкладка в фоне — опрос не нужен: приложение всё равно не перерисуется на
  // глазах. Возврат к экрану сразу дёргает статус, чтобы человек, вернувшийся
  // из Telegram, увидел результат мгновенно, а не через такт опроса (#105).
  useEffect(() => {
    const onVisibility = () => {
      if (!shouldKeepPolling(state)) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else if (!pollTimer.current) {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [poll, state, stopPolling]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер недоступен — код и так крупно на экране, переписать можно руками.
    }
  };

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
              className="mt-2 flex w-full items-center justify-center gap-3 text-4xl font-black tracking-[0.2em] text-white transition-colors active:scale-[0.99]"
            >
              {code}
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
