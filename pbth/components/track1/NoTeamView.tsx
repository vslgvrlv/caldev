import React from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, LogOut, Plus } from 'lucide-react';
import { useShell } from '../../shell/context';
import {
  parseJoinCodeInput,
  track1Api,
  type JoinRequest,
  type TeamCreationRequest,
} from '../../api/track1';
import { errorText, notify } from '../../lib/notify';
import { JoinRequestStatusCard } from './JoinRequestStatusCard';

// Экран «нет команды» (трек 1). Раньше здесь был тупик с одной кнопкой
// «Выйти». Теперь: ввести код команды, попросить новую команду и видеть,
// что с поданными заявками. Экран сам узнаёт, что заявку приняли.
//
// Подпись та же, что у прежнего экрана оболочки, — место вызова меняется
// одной строкой импорта.

const POLL_MS = 6000;

const frameStyle = {
  paddingTop: 'calc(var(--pb-safe-top) + 1.5rem)',
  paddingRight: 'calc(var(--pb-safe-right) + 1.25rem)',
  paddingBottom: 'calc(var(--pb-safe-bottom) + 1.5rem)',
  paddingLeft: 'calc(var(--pb-safe-left) + 1.25rem)',
} as const;

const TeamRequestLine: React.FC<{ request: TeamCreationRequest }> = ({ request }) => {
  const text =
    request.status === 'PENDING'
      ? 'Заявка на команду ждёт одобрения. Как только её одобрят, ты станешь капитаном.'
      : request.status === 'DECLINED'
        ? 'Заявку на команду отклонили. Напиши в поддержку, если это ошибка.'
        : request.status === 'APPROVED'
          ? 'Команда создана, ты капитан.'
          : 'Заявка отменена.';
  return (
    <div className="rounded-2xl border border-white/10 bg-pb-surface p-4 text-left">
      <div className="text-white font-semibold">«{request.name}»</div>
      <p className="mt-1 text-sm text-pb-subtext">{text}</p>
    </div>
  );
};

export const NoTeamScreen: React.FC<{
  userName?: string;
  onboardingRequired: boolean;
  onLogout: () => void;
}> = ({ userName, onLogout }) => {
  const shell = useShell();
  const navigate = useNavigate();
  const [joinRequests, setJoinRequests] = React.useState<JoinRequest[]>([]);
  const [teamRequests, setTeamRequests] = React.useState<TeamCreationRequest[]>([]);
  const [mode, setMode] = React.useState<'none' | 'code' | 'create'>('none');
  const [codeInput, setCodeInput] = React.useState('');
  const [teamName, setTeamName] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [entering, setEntering] = React.useState(false);
  const enteredRef = React.useRef(false);
  const pendingRef = React.useRef<Set<string>>(new Set());

  const load = React.useCallback(async () => {
    const [joins, teams] = await Promise.allSettled([track1Api.myJoinRequests(), track1Api.myTeamRequests()]);
    if (joins.status === 'fulfilled') setJoinRequests(joins.value);
    if (teams.status === 'fulfilled') setTeamRequests(teams.value);
    return {
      joins: joins.status === 'fulfilled' ? joins.value : [],
      teams: teams.status === 'fulfilled' ? teams.value : [],
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState === 'hidden' || enteredRef.current) return;
      const { joins, teams } = await load();
      if (cancelled) return;
      // Заявку приняли или команду создали, пока экран открыт, — приложение
      // открывает команду. Только переход «ждёт → одобрена»: давнее одобрение
      // при пустом составе не должно гонять загрузку по кругу.
      const decided = [...joins, ...teams].some((r) => r.status === 'APPROVED' && pendingRef.current.has(r.id));
      pendingRef.current = new Set([...joins, ...teams].filter((r) => r.status === 'PENDING').map((r) => r.id));
      if (decided && !enteredRef.current) {
        enteredRef.current = true;
        setEntering(true);
        await shell.actions.joinedTeam();
      }
    };
    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, shell.actions]);

  const pendingTeamRequest = teamRequests.find((r) => r.status === 'PENDING');
  const visibleJoins = joinRequests.filter((r) => r.status === 'PENDING' || r.status === 'DECLINED').slice(0, 3);
  const visibleTeams = teamRequests.filter((r) => r.status !== 'APPROVED').slice(0, 2);

  const submitCode = (event: React.FormEvent) => {
    event.preventDefault();
    const code = parseJoinCodeInput(codeInput);
    if (!code) {
      notify.error('Код — это шесть букв и цифр из ссылки команды. Проверь и введи ещё раз.');
      return;
    }
    navigate(`/join/${code}`);
  };

  const submitTeam = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = teamName.replace(/\s+/g, ' ').trim();
    if (name.length < 2) {
      notify.error('Название — хотя бы две буквы.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await track1Api.submitTeamRequest(name);
      pendingRef.current.add(res.request.id);
      setMode('none');
      setTeamName('');
      notify.success('Заявка отправлена. Как только её одобрят, здесь откроется твоя команда.');
      await load();
    } catch (error) {
      notify.error(errorText(error, 'Заявка не отправилась. Попробуй ещё раз.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (entering) {
    return (
      <div className="min-h-screen bg-pb-background flex items-center justify-center">
        <Loader2 className="animate-spin text-pb-primary" size={40} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pb-background flex items-center justify-center text-white" style={frameStyle}>
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="text-2xl font-bold mb-2">{userName ? `${userName}, ты вошёл` : 'Ты вошёл'}</div>
          <p className="text-pb-subtext text-sm">Пока ты не в команде. Вступи по коду или ссылке капитана — или создай свою.</p>
        </div>

        {visibleJoins.map((request) => (
          <JoinRequestStatusCard key={request.id} request={request} />
        ))}
        {visibleTeams.map((request) => (
          <TeamRequestLine key={request.id} request={request} />
        ))}

        {mode === 'code' ? (
          <form onSubmit={submitCode} className="rounded-2xl border border-white/10 bg-pb-surface p-4 space-y-3">
            <label className="block text-sm font-semibold" htmlFor="team-code">
              Код команды
            </label>
            <input
              id="team-code"
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              placeholder="Например, K7Q3MP или ссылка"
              className="w-full bg-black/30 text-white px-3 py-3 rounded-xl border border-white/10 focus:outline-none focus:border-pb-primary uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal placeholder:text-pb-subtext/60"
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode('none')} className="py-3 rounded-xl bg-white/10 font-semibold">
                Отмена
              </button>
              <button type="submit" className="py-3 rounded-xl bg-pb-primary text-pb-background font-bold">
                Дальше
              </button>
            </div>
          </form>
        ) : mode === 'create' ? (
          <form onSubmit={submitTeam} className="rounded-2xl border border-white/10 bg-pb-surface p-4 space-y-3">
            <label className="block text-sm font-semibold" htmlFor="team-name">
              Название команды
            </label>
            <input
              id="team-name"
              autoFocus
              maxLength={60}
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Например, Дневной Дозор"
              className="w-full bg-black/30 text-white px-3 py-3 rounded-xl border border-white/10 focus:outline-none focus:border-pb-primary placeholder:text-pb-subtext/60"
            />
            <p className="text-xs text-pb-subtext">Команду одобрит владелец PBTH, обычно в тот же день. Ты станешь её капитаном.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode('none')} className="py-3 rounded-xl bg-white/10 font-semibold">
                Отмена
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="py-3 rounded-xl bg-pb-primary text-pb-background font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                Отправить
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => setMode('code')}
              className="w-full bg-pb-primary text-pb-background font-bold py-3.5 rounded-xl flex items-center justify-center gap-2"
            >
              <KeyRound size={18} />
              Ввести код команды
            </button>
            {!pendingTeamRequest && (
              <button
                onClick={() => setMode('create')}
                className="w-full bg-white/10 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2"
              >
                <Plus size={18} />
                Создать команду
              </button>
            )}
          </div>
        )}

        <button
          onClick={onLogout}
          className="w-full text-pb-subtext text-sm py-2 flex items-center justify-center gap-2"
        >
          <LogOut size={14} />
          Выйти
        </button>
      </div>
    </div>
  );
};
