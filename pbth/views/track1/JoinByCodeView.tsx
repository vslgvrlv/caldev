import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useShell } from '../../shell/context';
import { track1Api, type JoinRequest, type TeamBrief } from '../../api/track1';
import { InviteActions, InviteFacts, InviteFrame, InviteHero, InviteNotNow } from '../../components/track1/InviteFrame';
import { eventDetailsText, eventWhenText, requestSentText, requestWaitingParts, type InviteFactsInput } from '../../lib/invite-copy';
import { Button, Glass, Icon, Row } from '../../ui';
import { teamCodeOf, teamPath } from '../../lib/team-url';
import { errorText } from '../../lib/notify';

// Вступление по ссылке команды `/join/<код>` (трек 1, боль Б1).
//
// Не вошёл — название команды и одна кнопка входа (через Telegram, адрес
// ссылки едет в `?next=`). Вошёл — заявка создаётся сама, человек видит
// «Заявка у капитана» с ближайшим событием; экран сам узнаёт решение.
// Уже в команде — просто открывается команда.

// Опрос идёт через общий ограничитель записи (120 в минуту на адрес).
const POLL_MS = 5000;

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; text: string }
  | { kind: 'anonymous'; team: TeamBrief; facts: InviteFactsInput }
  | { kind: 'member'; team: TeamBrief }
  | { kind: 'request'; request: JoinRequest };

export const JoinByCodeView: React.FC = () => {
  const { code: rawCode } = useParams();
  const code = String(rawCode || '').toUpperCase();
  const shell = useShell();
  const navigate = useNavigate();
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  // Капитан, число людей и ближайшее событие — со страницы ссылки; нужны и
  // после подачи заявки, когда ответ сервера уже другой.
  const [facts, setFacts] = React.useState<InviteFactsInput | null>(null);
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
        const previewFacts: InviteFactsInput = {
          inviter: preview.inviter,
          membersCount: preview.membersCount,
          nextEvent: preview.nextEvent,
        };
        setFacts(previewFacts);
        if (!preview.authenticated) return setState({ kind: 'anonymous', team: preview.team, facts: previewFacts });
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
      <InviteFrame>
        <InviteHero title={entering ? 'Открываем команду' : 'Открываем ссылку'} />
      </InviteFrame>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <InviteFrame>
        <InviteHero title="Ссылка не работает">
          Капитан мог выпустить новую ссылку. Попроси у него свежую или код команды.
        </InviteHero>
        <InviteActions>
          <Button variant="glass2" block onClick={() => navigate('/')}>
            На главную
          </Button>
        </InviteActions>
      </InviteFrame>
    );
  }

  if (state.kind === 'error') {
    return (
      <InviteFrame>
        <InviteHero title="Не открылось">{state.text}</InviteHero>
        <InviteActions>
          <Button variant="glass2" block onClick={() => window.location.reload()}>
            Обновить
          </Button>
        </InviteActions>
      </InviteFrame>
    );
  }

  if (state.kind === 'anonymous') {
    const next = encodeURIComponent(`/join/${code}`);
    return (
      <InviteFrame teamId={state.team.id}>
        <InviteHero team={state.team} title={`Тебя зовут в ${state.team.name}`}>
          Команда принимает по заявке. Капитан ответит на неё.
        </InviteHero>
        <InviteFacts facts={state.facts} inviterRole="CAPTAIN" invitedRole="PLAYER" />
        <InviteActions>
          <Button variant="primary" block onClick={() => navigate(`/login?next=${next}`)}>
            Подать заявку
          </Button>
          <InviteNotNow onClick={() => navigate('/')} />
        </InviteActions>
      </InviteFrame>
    );
  }

  const { request } = state;
  const waiting = requestWaitingParts(facts?.inviter?.name);
  const openApp = (
    <InviteActions>
      <Button variant="primary" block onClick={() => navigate('/app')}>
        Открыть приложение
      </Button>
    </InviteActions>
  );

  if (request.status === 'DECLINED' || request.status === 'CANCELLED') {
    return (
      <InviteFrame teamId={request.team.id}>
        <InviteHero team={request.team} title={request.status === 'DECLINED' ? 'Заявку отклонили' : 'Заявка отменена'}>
          Если это ошибка — напиши капитану, пусть пришлёт ссылку ещё раз.
        </InviteHero>
        {openApp}
      </InviteFrame>
    );
  }

  if (request.status === 'APPROVED') {
    return (
      <InviteFrame teamId={request.team.id}>
        <InviteHero team={request.team} title="Тебя приняли">
          Открываем команду…
        </InviteHero>
      </InviteFrame>
    );
  }

  return (
    <InviteFrame teamId={request.team.id}>
      <InviteHero team={request.team} checked title="Заявка у капитана">
        {waiting.name ? <strong>{waiting.name}</strong> : null}
        {waiting.rest}
      </InviteHero>
      <Glass layer={2} className="pbth-invite__facts">
        <Row lead={<Icon name="clock" size={24} />} title={request.team.name} sub={requestSentText(request.createdAt)} />
        {request.nextEvent ? (
          <Row
            lead={<Icon name="calendar" size={24} />}
            title={eventWhenText(request.nextEvent.startAt, request.nextEvent.timezone)}
            sub={eventDetailsText(request.nextEvent.title, request.nextEvent.location)}
          />
        ) : null}
      </Glass>
      {openApp}
    </InviteFrame>
  );
};
