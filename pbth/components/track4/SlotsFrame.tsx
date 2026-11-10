import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useShell } from '../../shell/context';
import { BottomNav } from '../BottomNav';

// Рамка экранов `/teams`: тот же фон и колонка, что у экранов команды, своя
// шапка с «назад» и нижняя навигация в последнюю открытую команду.

export const SlotsFrame: React.FC<{ title: string; onBack?: () => void; children: React.ReactNode }> = ({
  title,
  onBack,
  children,
}) => {
  const shell = useShell();
  const navigate = useNavigate();
  const { ensureTeam } = shell;

  // Открыли `/teams` по ссылке — подгружаем последнюю команду, чтобы нижняя
  // навигация вела в неё. Человеку без команды навигация покажет только профиль.
  React.useEffect(() => {
    if (shell.authStep === 'APP' && shell.appGate === 'READY' && !shell.team && shell.teamLoad === 'idle') {
      ensureTeam('');
    }
  }, [ensureTeam, shell.appGate, shell.authStep, shell.team, shell.teamLoad]);

  const back = () => {
    if (onBack) return onBack();
    if (window.history.length > 1) navigate(-1);
    else navigate(shell.teamCode ? `/t/${shell.teamCode}` : '/app');
  };

  return (
    <div className="min-h-screen bg-pb-background bg-splatter bg-fixed bg-no-repeat bg-center bg-cover text-white font-sans">
      <div className="fixed inset-0 bg-pb-background/72 -z-10 pointer-events-none"></div>
      <main className="max-w-md mx-auto min-h-screen relative shadow-2xl shadow-black overflow-hidden flex flex-col">
        <header
          className="sticky top-0 z-30 flex items-center gap-3 px-4 pb-3 bg-pb-background/90 backdrop-blur border-b border-white/5"
          style={{ paddingTop: 'calc(var(--pb-safe-top, 0px) + 1rem)' }}
        >
          <button
            type="button"
            onClick={back}
            aria-label="Назад"
            className="w-10 h-10 shrink-0 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-bold truncate">{title}</h1>
        </header>
        <div className="flex-1 px-4 py-4 space-y-4" style={{ paddingBottom: 'calc(85px + 1.5rem)' }}>
          {children}
        </div>
        <BottomNav teamCode={shell.teamCode} />
      </main>
    </div>
  );
};

export const sectionTitle = 'text-xs text-pb-subtext uppercase tracking-wide mb-2';
export const surface = 'bg-pb-surface rounded-2xl p-4 border border-white/5';
export const primaryBtn =
  'w-full py-3 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60';
export const secondaryBtn =
  'px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold text-white hover:bg-white/10 transition-colors disabled:opacity-60';
