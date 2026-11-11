// Логика входа по коду сопряжения (#109): запрос кода, опрос, отсчёт, возврат
// из фона. Общая для старого экрана входа владельца и нового экрана входа.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  nextPollDelayMs,
  pairingSecondsLeft,
  restorePairingAttempt,
  shouldKeepPolling,
  type StoredPairingAttempt,
  type PairingScreenState,
} from './pairing';

export interface PairingOptions {
  scope: 'USER' | 'ADMIN';
  redirectTo: string;
  onAuthenticated: (redirectTo: string) => void;
}

const PAIRING_STORAGE_KEY = 'pbth:pairing-attempt:v1';

export function usePairing({ scope, redirectTo, onAuthenticated }: PairingOptions) {
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

  return { state, code, botUrl, botUsername, secondsLeft, copied, handleCopy, requestCode };
}
