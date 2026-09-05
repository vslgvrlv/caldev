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
  restorePairingAttempt,
  shouldKeepPolling,
  type StoredPairingAttempt,
  type PairingScreenState,
} from '../lib/pairing';

interface PairingPanelProps {
  scope: 'USER' | 'ADMIN';
  redirectTo: string;
  onAuthenticated: (redirectTo: string) => void;
}

const PAIRING_STORAGE_KEY = 'pbth:pairing-attempt:v1';

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
  const pollInFlight = useRef(false);
  const startedAt = useRef(0);
  const activeCode = useRef('');

  const clearStoredAttempt = useCallback(() => {
    try {
      window.localStorage.removeItem(PAIRING_STORAGE_KEY);
    } catch {
      // Private mode/storage policy: lifecycle polling still completes login.
    }
  }, []);

  const storeAttempt = useCallback((attempt: StoredPairingAttempt) => {
    try {
      window.localStorage.setItem(PAIRING_STORAGE_KEY, JSON.stringify(attempt));
    } catch {
      // Persistence is a recovery aid, not a requirement for pairing.
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    const current = activeCode.current;
    if (!current || pollInFlight.current) return;
    pollInFlight.current = true;
    // A fired timeout keeps its numeric handle. Clear it before lifecycle
    // events decide whether another request is already scheduled.
    stopPolling();
    let terminal = false;
    try {
      const result = await api.getPairingStatus(current);
      if (activeCode.current !== current) return;

      if (result.status === 'approved') {
        // Сессионная кука пришла на ЭТОТ ответ — в банку этого браузера.
        // Дальше приложение просто перерисовывается залогиненным.
        setState('approved');
        terminal = true;
        activeCode.current = '';
        clearStoredAttempt();
        stopPolling();
        onAuthenticated(result.redirectTo || redirectTo);
        return;
      }
      if (result.status === 'denied' || result.status === 'expired') {
        setState(result.status);
        terminal = true;
        activeCode.current = '';
        clearStoredAttempt();
        stopPolling();
        return;
      }
      setState(result.status === 'claimed' ? 'claimed' : 'waiting');
    } catch {
      // Сеть моргнула или ушли в офлайн — это не повод хоронить попытку:
      // код на экране всё ещё жив, следующий тик попробует снова.
    } finally {
      pollInFlight.current = false;
      if (!terminal && activeCode.current === current && !pollTimer.current) {
        pollTimer.current = setTimeout(poll, nextPollDelayMs(Date.now() - startedAt.current));
      }
    }
  }, [clearStoredAttempt, onAuthenticated, redirectTo, stopPolling]);

  const requestCode = useCallback(async () => {
    stopPolling();
    activeCode.current = '';
    clearStoredAttempt();
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
      storeAttempt({
        scope,
        redirectTo,
        code: started.code,
        botUrl: started.botUrl,
        botUsername: started.botUsername,
        expiresAt: started.expiresAt,
        startedAt: startedAt.current,
      });
      setState('waiting');
      pollTimer.current = setTimeout(poll, nextPollDelayMs(0));
    } catch {
      setState('error');
    }
  }, [clearStoredAttempt, poll, redirectTo, scope, stopPolling, storeAttempt]);

  useEffect(() => {
    let restored: StoredPairingAttempt | null = null;
    try {
      restored = restorePairingAttempt(window.localStorage.getItem(PAIRING_STORAGE_KEY), scope, redirectTo, Date.now());
    } catch {
      // Storage unavailable — start a fresh attempt below.
    }
    if (restored) {
      setCode(restored.code);
      setBotUrl(restored.botUrl);
      setBotUsername(restored.botUsername);
      setExpiresAt(restored.expiresAt);
      activeCode.current = restored.code;
      startedAt.current = restored.startedAt;
      setState('waiting');
      void poll();
    } else {
      clearStoredAttempt();
      void requestCode();
    }
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

  // Мобильные webview расходятся в lifecycle-событиях: iOS чаще даёт
  // visibilitychange/pageshow, Android Telegram — focus. Любой возврат должен
  // немедленно забрать APPROVED вместе с сессионной cookie (#665).
  useEffect(() => {
    const resumePolling = () => {
      if (!activeCode.current) return;
      stopPolling();
      void poll();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopPolling();
      else resumePolling();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', resumePolling);
    window.addEventListener('pageshow', resumePolling);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', resumePolling);
      window.removeEventListener('pageshow', resumePolling);
    };
  }, [poll, stopPolling]);

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
