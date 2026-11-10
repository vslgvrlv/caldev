import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Loader2, LogIn } from 'lucide-react';
import { useShell } from '../../shell/context';
import { track1Api, type JoinRequest, type TeamBrief } from '../../api/track1';
import { JoinRequestStatusCard } from '../../components/track1/JoinRequestStatusCard';
import { teamCodeOf, teamPath } from '../../lib/team-url';
import { errorText } from '../../lib/notify';

// Вступление по ссылке команды `/join/<код>` (трек 1, боль Б1).
//
// Не вошёл — название команды и одна кнопка входа (через Telegram, адрес
// ссылки едет в `?next=`). Вошёл — заявка создаётся сама, человек видит
// «Заявка у капитана» с ближайшим событием; экран сам узнаёт решение.
// Уже в команде — просто открывается команда.

const POLL_MS = 4000;

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; text: string }
  | { kind: 'anonymous'; team: TeamBrief }
  | { kind: 'member'; team: TeamBrief }
  | { kind: 'request'; request: JoinRequest };

const frameStyle = {
  paddingTop: 'calc(var(--pb-safe-top) + 1.5rem)',
  paddingRight: 'calc(var(--pb-safe-right) + 1.5rem)',
  paddingBottom: 'calc(var(--pb-safe-bottom) + 1.5rem)',
  paddingLeft: 'calc(var(--pb-safe-left) + 1.5rem)',
} as const;

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-pb-background flex items-center justify-center text-white" style={frameStyle}>
    <div className="w-full max-w-sm">{children}</div>
  </div>
);

export const JoinByCodeView: React.FC = () => {
  const { code: rawCode } = useParams();
  const code = String(rawCode || '').toUpperCase();
  const shell = useShell();
  const navigate = useNavigate();
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [entering, setEntering] = React.useState(false);
  const enteredRef = React.useRef(false);

  // Ждём, пока приложение восстановит сессию: иначе вошедший на миг увидит
  // кнопку входа.
  const ready = shell.authBootstrapDone || shell.authStep === 'APP';

  React.useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const preview = await track1Api.previewJoinLink(code);
        if (cancelled) return;
        if (!preview.authenticated) return setState({ kind: 'anonymous', team: preview.team });
        if (preview.member) return setState({ kind: 'member', team: preview.team });
        if (preview.request && preview.request.status !== 'CANCELLED') {
          return setState({ kind: 'request', request: preview.request });
        }
        // Вошёл и ещё не просился — открыл ссылку, значит хочет в команду.
        const submitted = await track1Api.submitJoinRequest(code);
        if (cancelled) return;
        if (submitted.member || !submitted.request) return setState({ kind: 'member', team: submitted.team });
        setState({ kind: 'request', request: submitted.request });
      } catch (error) {
        if (cancelled) return;
        const status = (error as { status?: number } | null)?.status;
        if (status === 404) setState({ kind: 'invalid' });
        else setState({ kind: 'error', text: errorText(error, 'Не получилось открыть ссылку. Проверь связь и обнови страницу.') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, ready]);

  const enterTeam = React.useCallback(
    async (team: TeamBrief) => {
      if (enteredRef.current) return;
      enteredRef.current = true;
      setEntering(true);
      // Человек без команды: приложение ещё не загружено — грузим его, и
      // оно само откроет единственную команду. Есть другие команды — сразу
      // по адресу новой.
      if (shell.appGate === 'NO_TEAM' || shell.authStep !== 'APP') {
        await shell.actions.joinedTeam();
        return;
      }
      navigate(teamPath(teamCodeOf({ teamId: team.id, shortCode: team.shortCode })), { replace: true });
    },
    [navigate, shell.actions, shell.appGate, shell.authStep],
  );

  // Опрос решения, пока заявка ждёт. Вкладка в фоне — не дёргаем сервер,
  // вернулся — проверяем сразу.
  const pendingId = state.kind === 'request' && state.request.status === 'PENDING' ? state.request.id : null;
  React.useEffect(() => {
    if (!pendingId) return;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const fresh = await track1Api.getJoinRequest(pendingId);
        if (!cancelled && fresh.status !== 'PENDING') setState({ kind: 'request', request: fresh });
      } catch {
        // Связь пропала — следующая попытка через несколько секунд.
      }
    };
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [pendingId]);

  React.useEffect(() => {
    if (state.kind === 'request' && state.request.status === 'APPROVED') void enterTeam(state.request.team);
    if (state.kind === 'member' && shell.appGate === 'NO_TEAM') void enterTeam(state.team);
  }, [enterTeam, shell.appGate, state]);

  if (state.kind === 'member' && shell.appGate !== 'NO_TEAM') {
    return <Navigate to={teamPath(teamCodeOf({ teamId: state.team.id, shortCode: state.team.shortCode }))} replace />;
  }

  if (state.kind === 'loading' || state.kind === 'member' || entering) {
    return (
      <Frame>
        <div className="flex justify-center">
          <Loader2 className="animate-spin text-pb-primary" size={40} />
        </div>
      </Frame>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <Frame>
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Ссылка не работает</h1>
          <p className="text-pb-subtext text-sm">
            Капитан мог выпустить новую ссылку. Попроси у него свежую или код команды.
          </p>
        </div>
      </Frame>
    );
  }

  if (state.kind === 'error') {
    return (
      <Frame>
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Не открылось</h1>
          <p className="text-pb-subtext text-sm mb-5">{state.text}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-pb-primary text-pb-background font-bold py-3 rounded-xl"
          >
            Обновить
          </button>
        </div>
      </Frame>
    );
  }

  if (state.kind === 'anonymous') {
    const next = encodeURIComponent(`/join/${code}`);
    return (
      <Frame>
        <div className="bg-pb-surface border border-white/10 rounded-2xl p-5">
          <div className="text-pb-subtext text-sm mb-1">Тебя зовут в команду</div>
          <h1 className="text-2xl font-bold mb-3">{state.team.name}</h1>
          <p className="text-pb-subtext text-sm mb-5">
            Войди через Telegram — капитан получит заявку и примет тебя в состав.
          </p>
          <button
            onClick={() => navigate(`/login?next=${next}`)}
            className="w-full bg-pb-primary text-pb-background font-bold py-3.5 rounded-xl flex items-center justify-center gap-2"
          >
            <LogIn size={18} />
            Войти и подать заявку
          </button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <JoinRequestStatusCard request={state.request} />
    </Frame>
  );
};
