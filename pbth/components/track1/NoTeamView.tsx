import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useShell } from '../../shell/context';
import {
  parseJoinCodeInput,
  track1Api,
  type JoinRequest,
  type TeamCreationRequest,
} from '../../api/track1';
import { errorText, notify } from '../../lib/notify';
import { Button, Glass, Icon, Row } from '../../ui';
import { JoinRequestStatusCard } from './JoinRequestStatusCard';
import { InviteActions, InviteFrame, InviteHero } from './InviteFrame';
import './invite-frame.css';

// Экран «нет команды» (трек 1). Раньше здесь был тупик с одной кнопкой
// «Выйти». Теперь: ввести код команды, попросить новую команду и видеть,
// что с поданными заявками. Экран сам узнаёт, что заявку приняли.
//
// Подпись та же, что у прежнего экрана оболочки, — место вызова меняется
// одной строкой импорта.

// Опрос идёт через общий ограничитель записи (120 в минуту на адрес), поэтому редкий.
const POLL_MS = 10000;

const TeamRequestRow: React.FC<{ request: TeamCreationRequest }> = ({ request }) => {
  const text =
    request.status === 'PENDING'
      ? 'Ждёт одобрения. Как только её одобрят, ты станешь капитаном.'
      : request.status === 'DECLINED'
        ? 'Заявку отклонили. Напиши в поддержку, если это ошибка.'
        : request.status === 'APPROVED'
          ? 'Команда создана, ты капитан.'
          : 'Заявка отменена.';
  return (
    <Row
      lead={<Icon name={request.status === 'DECLINED' ? 'circle-x' : 'clock'} size={24} />}
      title={`Команда «${request.name}»`}
      sub={text}
    />
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
      <InviteFrame>
        <InviteHero title="Открываем команду" />
      </InviteFrame>
    );
  }

  const mainJoin = visibleJoins[0];
  const moreJoins = visibleJoins.slice(1);
  const waiting = mainJoin?.status === 'PENDING';
  const codeVariant = waiting ? 'glass2' : 'primary';

  return (
    <InviteFrame teamId={mainJoin?.team.id}>
      {mainJoin ? (
        <JoinRequestStatusCard request={mainJoin} />
      ) : (
        <InviteHero title="У тебя пока нет команды">
          Вступи по коду или ссылке капитана — или создай свою.
        </InviteHero>
      )}

      {moreJoins.length > 0 || visibleTeams.length > 0 ? (
        <Glass layer={2} className="pbth-invite__facts">
          {moreJoins.map((request) => (
            <Row
              key={request.id}
              lead={<Icon name={request.status === 'DECLINED' ? 'circle-x' : 'clock'} size={24} />}
              title={request.team.name}
              sub={request.status === 'DECLINED' ? 'Заявку отклонили' : 'Заявка у капитана'}
            />
          ))}
          {visibleTeams.map((request) => (
            <TeamRequestRow key={request.id} request={request} />
          ))}
        </Glass>
      ) : null}

      {mode === 'code' ? (
        <form onSubmit={submitCode} className="pbth-noteam__form">
          <label className="pbth-noteam__label" htmlFor="team-code">
            Код команды
          </label>
          <input
            id="team-code"
            className="ui-input"
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="Например, K7Q3MP или ссылка"
          />
          <Button type="submit" variant="primary" block>
            Дальше
          </Button>
          <Button variant="ghost" block onClick={() => setMode('none')}>
            Отмена
          </Button>
        </form>
      ) : mode === 'create' ? (
        <form onSubmit={submitTeam} className="pbth-noteam__form">
          <label className="pbth-noteam__label" htmlFor="team-name">
            Название команды
          </label>
          <input
            id="team-name"
            className="ui-input"
            autoFocus
            maxLength={60}
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Например, Дневной Дозор"
          />
          <p className="pbth-noteam__hint">Команду одобрит владелец PBTH, обычно в тот же день. Ты станешь её капитаном.</p>
          <Button
            type="submit"
            variant="primary"
            block
            disabled={submitting}
            icon={submitting ? 'loader-circle' : undefined}
            className={submitting ? 'pbth-spinbtn' : undefined}
          >
            Отправить
          </Button>
          <Button variant="ghost" block onClick={() => setMode('none')}>
            Отмена
          </Button>
        </form>
      ) : (
        <InviteActions>
          <Button variant={codeVariant} block onClick={() => setMode('code')}>
            {waiting ? 'Ввести другой код' : 'Ввести код команды'}
          </Button>
          {!pendingTeamRequest && (
            <Button variant="ghost" block onClick={() => setMode('create')}>
              Создать команду
            </Button>
          )}
        </InviteActions>
      )}

      <div className="pbth-noteam__out">
        {userName ? <div className="pbth-small">Ты вошёл как {userName}</div> : null}
        <Button variant="ghost" size="sm" icon="log-out" onClick={onLogout}>
          Выйти
        </Button>
      </div>
    </InviteFrame>
  );
};
