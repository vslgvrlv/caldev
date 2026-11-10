import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * «Назад» внутри приложения. Если человек пришёл на экран из приложения —
 * шаг назад по истории (так же работает кнопка браузера). Если открыл
 * ссылкой или после перезагрузки — истории внутри приложения нет, и шаг
 * назад выкинул бы его с сайта; тогда уходим на `fallback`.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = typeof window !== 'undefined' ? (window.history.state as { idx?: number } | null)?.idx : 0;
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
      return;
    }
    navigate(fallback, { replace: true });
  }, [fallback, navigate]);
}
