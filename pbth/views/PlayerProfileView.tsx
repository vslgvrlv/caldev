import React from 'react';
import { TeamMember, PlayerStatus } from '../types';
import { roleLabel, playerStatusLabel } from '../lib/labels';
import { confirmAction, errorText, notify } from '../lib/notify';
import { formatBalance } from '../lib/team-roster';
import { MemberRoleControl } from '../components/track1/MemberRoleControl';
import { pluralRu } from '../lib/plural';
import { Avatar, Button, Glass, Icon, Row, Screen, ScreenBar, Sheet, TeamMark, teamPaint } from '../ui';
import './team/team.css';

interface PlayerProfileViewProps {
  member: TeamMember;
  teamName: string;
  /** Нужен для краски экрана; без него экран остаётся в нейтральных тонах. */
  teamId?: string;
  onBack: () => void;
  canManage?: boolean;
  onUpdateMemberStatus?: (member: TeamMember, status: PlayerStatus) => Promise<void> | void;
  onRemoveMember?: (member: TeamMember) => Promise<void> | void;
}

const STATUS_CHOICES: Array<{ status: PlayerStatus; label: string }> = [
  { status: PlayerStatus.ACTIVE, label: 'В строю' },
  { status: PlayerStatus.RESERVE, label: 'Резерв' },
  { status: PlayerStatus.INJURED, label: 'Травма' },
  { status: PlayerStatus.VACATION, label: 'Отпуск' },
];

export const PlayerProfileView: React.FC<PlayerProfileViewProps> = ({
  member,
  teamName,
  teamId,
  onBack,
  canManage = false,
  onUpdateMemberStatus,
  onRemoveMember,
}) => {
  const stats = member.stats || {
    attendanceRate: 0,
    eventsAttended: 0,
    totalEvents: 0,
    mvpCount: 0,
    matchesPlayed: 0,
  };
  const balance = Number(member.balance || 0);

  const setStatus = async (status: PlayerStatus) => {
    try {
      await onUpdateMemberStatus?.(member, status);
    } catch (err) {
      notify.error(errorText(err, 'Не получилось. Попробуй ещё раз.'));
    }
  };

  const [statusOpen, setStatusOpen] = React.useState(false);
  const attendance = Math.round(Number(stats.attendanceRate) || 0);
  const pickStatus = (status: PlayerStatus) => {
    setStatusOpen(false);
    if (status !== member.status) void setStatus(status);
  };

  return (
    <Screen paints={teamId ? [teamPaint(teamId)] : undefined}>
      <ScreenBar
        onBack={onBack}
        mark={teamId ? <TeamMark teamId={teamId} name={teamName} size={32} /> : undefined}
        title={teamName}
        subtitle="Карточка игрока"
      />

      <div className="pbth-phero">
        <Avatar name={member.name} src={member.avatar} size={96} />
        <h2 className="pbth-phero__name">{member.name}</h2>
        <div className="pbth-small">
          {roleLabel(member.role)} · {playerStatusLabel(member.status)}
        </div>
      </div>

      <div className="pbth-stack">
        <div className="pbth-statgrid">
          <Glass className="pbth-stat">
            <div className="pbth-stat__label">Посещаемость</div>
            <div className="pbth-stat__big">{attendance}%</div>
            <div className="pbth-stat__sub">
              {stats.eventsAttended} из {stats.totalEvents} {pluralRu(stats.totalEvents, 'событие', 'события', 'событий')}
            </div>
          </Glass>
          <Glass className="pbth-stat">
            <div className="pbth-stat__label">Деньги</div>
            <div className={`pbth-stat__big${balance < 0 ? ' pbth-stat__value--neg' : ''}`}>{formatBalance(balance)}</div>
            <div className="pbth-stat__sub">{balance < 0 ? 'долг по казне' : 'баланс по казне'}</div>
          </Glass>
        </div>

        <Glass className="pbth-team__panel">
          <div className="pbth-team__group">В команде</div>
          <Row title="Роль" trailing={<span>{roleLabel(member.role)}</span>} />
          <Row title="Статус" trailing={<span>{playerStatusLabel(member.status)}</span>} />
        </Glass>

        {(member.nickname || member.phone) && (
          <Glass className="pbth-team__panel">
            {member.nickname && (
              <Row
                lead={<span className="pbth-iconlead ui-glass2"><Icon name="send" /></span>}
                title={`@${member.nickname}`}
                sub="Ник в Telegram"
              />
            )}
            {member.phone && (
              <Row
                as="a"
                href={`tel:${member.phone}`}
                lead={<span className="pbth-iconlead ui-glass2"><Icon name="phone" /></span>}
                title={member.phone}
                sub="Позвонить"
                chevron
              />
            )}
          </Glass>
        )}

        {canManage && (
          <Glass className="pbth-team__panel">
            <div className="pbth-team__group">Управление игроком</div>
            <MemberRoleControl member={member} bare />
            <Row
              lead={<span className="pbth-iconlead ui-glass2"><Icon name="sliders-horizontal" /></span>}
              title="Статус игрока"
              sub={playerStatusLabel(member.status)}
              chevron
              onClick={() => setStatusOpen(true)}
            />
            <div className="pbth-pad">
              <Button
                variant="danger"
                block
                onClick={() => {
                  void confirmAction(`Исключить ${member.name} из команды?`, { confirmLabel: 'Исключить', danger: true }).then(
                    (confirmed) => {
                      if (confirmed) void onRemoveMember?.(member);
                    },
                  );
                }}
              >
                Исключить из команды
              </Button>
            </div>
          </Glass>
        )}
      </div>

      <Sheet open={statusOpen} onClose={() => setStatusOpen(false)} title="Статус игрока" subtitle={member.name}>
        <div className="pbth-btnlist">
          {STATUS_CHOICES.map(({ status, label }) => (
            <Button
              key={status}
              variant={member.status === status ? 'light' : 'glass2'}
              block
              icon={member.status === status ? 'check' : undefined}
              aria-current={member.status === status ? 'true' : undefined}
              onClick={() => pickStatus(status)}
            >
              {label}
            </Button>
          ))}
        </div>
      </Sheet>
    </Screen>
  );
};
