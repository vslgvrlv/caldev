import React from 'react';
import { useShell } from '../../shell/context';
import { useNavigate } from 'react-router-dom';
import { joinUrl, notifyJoinRequestsChanged, track1Api, type PendingJoinRequest } from '../../api/track1';
import { notify, errorText } from '../../lib/notify';
import { sinceLabel } from '../../lib/team-roster';
import { teamCodeOf, teamPath } from '../../lib/team-url';
import { copyText } from '../../lib/copy-text';
import { countLabel } from '../../lib/plural';
import { roleLabel } from '../../lib/labels';
import { Avatar, Button, Glass, Icon, Screen, ScreenBar, TeamMark, teamPaint } from '../../ui';
import '../team/team.css';

// Заявки на вступление, `/t/:team/requests` (трек 1). Видят капитан и
// тренер; решение здесь и кнопкой в боте — одно и то же: кто успел первым.

export const JoinRequestsView: React.FC = () => {
  const shell = useShell();
  const navigate = useNavigate();
  const team = shell.team;
  const canDecide = team?.role === 'CAPTAIN' || team?.role === 'TRAINER' || team?.role === 'ADMIN';
  const [items, setItems] = React.useState<PendingJoinRequest[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<{ id: string; decision: 'approve' | 'decline' } | null>(null);

  const load = React.useCallback(async () => {
    if (!canDecide) return;
    try {
      const res = await track1Api.teamJoinRequests();
      setItems(res.requests);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [canDecide]);

  React.useEffect(() => {
    setItems(null);
    void load();
  }, [load, team?.id]);

  const decide = async (item: PendingJoinRequest, decision: 'approve' | 'decline') => {
    if (busy) return;
    setBusy({ id: item.id, decision });
    try {
      await track1Api.decideJoinRequest(item.id, decision);
      notify.success(decision === 'approve' ? `${item.user.name} теперь в составе` : 'Заявка отклонена');
      setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
      notifyJoinRequestsChanged();
      if (decision === 'approve') void shell.reload();
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === 'JOIN_REQUEST_ALREADY_DECIDED') {
        notify.info('Эту заявку уже решили');
        setItems((prev) => (prev ? prev.filter((x) => x.id !== item.id) : prev));
        notifyJoinRequestsChanged();
      } else {
        notify.error(errorText(error, 'Не получилось. Попробуй ещё раз.'));
      }
    } finally {
      setBusy(null);
    }
  };

  const goBack = React.useCallback(() => {
    if (team) navigate(teamPath(shell.teamCode || teamCodeOf({ teamId: team.id, shortCode: team.shortCode }), 'roster'));
  }, [navigate, shell.teamCode, team]);

  const copyLink = async () => {
    if (!team) return;
    try {
      const link = await track1Api.getTeamJoinLink(team.id);
      const url = joinUrl(window.location.origin, link.code);
      if (await copyText(url)) notify.success('Ссылка скопирована');
      else notify.error('Не получилось скопировать. Открой «Ссылку команды» в составе.');
    } catch (error) {
      notify.error(errorText(error, 'Ссылка не загрузилась.'));
    }
  };

  const subtitle =
    items && items.length > 0
      ? `${countLabel(items.length, 'игрок просится', 'игрока просятся', 'игроков просятся')} в команду`
      : 'Новые игроки появятся здесь';

  return (
    <Screen paints={team ? [teamPaint(team.id)] : undefined}>
      <ScreenBar
        onBack={goBack}
        mark={team ? <TeamMark teamId={team.id} name={team.name} code={team.shortCode} size={32} /> : undefined}
        title={team?.name ?? 'Заявки'}
        subtitle={team ? `Ты ${team.via === 'owner' ? 'владелец платформы' : roleLabel(team.role).toLowerCase()}` : undefined}
      />
      <div className="pbth-pagehead">
        <h2 className="pbth-pagehead__title">Заявки</h2>
        {canDecide && !failed && items !== null && <div className="pbth-pagehead__sub">{subtitle}</div>}
      </div>

      {!canDecide ? (
        <Glass className="pbth-rempty">
          <span className="pbth-iconlead ui-glass2" style={{ width: 72, height: 72 }}>
            <Icon name="lock" size={32} />
          </span>
          <h3 className="pbth-rempty__title">Заявки решают капитан и тренер</h3>
          <p className="pbth-rempty__text">Новых игроков принимают они. Тебе от заявок ничего делать не нужно.</p>
          <Button variant="glass2" block onClick={goBack}>
            К составу
          </Button>
        </Glass>
      ) : failed ? (
        <Glass className="pbth-rempty">
          <div className="pbth-muted">Заявки не загрузились.</div>
          <Button variant="glass2" onClick={() => void load()}>
            Обновить
          </Button>
        </Glass>
      ) : items === null ? (
        <Glass className="pbth-pad">
          <div className="ui-skeleton" style={{ height: 140 }} aria-label="Загружаю заявки" />
        </Glass>
      ) : items.length === 0 ? (
        <Glass className="pbth-rempty">
          <span className="pbth-iconlead ui-glass2" style={{ width: 72, height: 72 }}>
            <Icon name="inbox" size={32} />
          </span>
          <h3 className="pbth-rempty__title">Заявок нет</h3>
          <p className="pbth-rempty__text">Позови игроков ссылкой команды</p>
          <Button variant="light" block icon="copy" onClick={() => void copyLink()}>
            Скопировать ссылку
          </Button>
        </Glass>
      ) : (
        <Glass className="pbth-team__panel">
          {items.map((item) => (
            <div key={item.id} className="pbth-req">
              <div className="pbth-req__who">
                <Avatar name={item.user.name || item.user.nickname} src={item.user.avatar} size={48} />
                <div className="pbth-req__text">
                  <div className="pbth-req__name">{item.user.name || item.user.nickname}</div>
                  <div className="pbth-small">
                    {item.user.username ? `@${item.user.username} · ` : ''}
                    {sinceLabel(item.createdAt)}
                  </div>
                </div>
              </div>
              <div className="pbth-req__btns">
                <Button
                  variant="light"
                  icon={busy?.id === item.id && busy.decision === 'approve' ? 'loader-circle' : 'check'}
                  className={busy?.id === item.id && busy.decision === 'approve' ? 'pbth-spinbtn' : undefined}
                  aria-busy={busy?.id === item.id && busy.decision === 'approve'}
                  disabled={busy !== null}
                  onClick={() => void decide(item, 'approve')}
                >
                  Принять
                </Button>
                <Button
                  variant="glass2"
                  icon={busy?.id === item.id && busy.decision === 'decline' ? 'loader-circle' : undefined}
                  className={busy?.id === item.id && busy.decision === 'decline' ? 'pbth-spinbtn' : undefined}
                  aria-busy={busy?.id === item.id && busy.decision === 'decline'}
                  disabled={busy !== null}
                  onClick={() => void decide(item, 'decline')}
                >
                  Отклонить
                </Button>
              </div>
            </div>
          ))}
        </Glass>
      )}
    </Screen>
  );
};
