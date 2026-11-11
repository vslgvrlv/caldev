import React from 'react';
import { TeamMember, PlayerStatus } from '../types';
import { roleLabel, playerStatusLabel } from '../lib/labels';
import { confirmAction, errorText, notify } from '../lib/notify';
import { formatBalance } from '../lib/team-roster';
import { MemberRoleControl } from '../components/track1/MemberRoleControl';
import { Avatar, Button, Glass, Icon, Row, Screen, ScreenBar, teamPaint } from '../ui';
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

  return (
    <Screen paints={teamId ? [teamPaint(teamId)] : undefined}>
      <ScreenBar onBack={onBack} title="Профиль игрока" subtitle={teamName} />

      <div className="pbth-phero">
        <Avatar name={member.name} src={member.avatar} size={96} />
        <h2 className="pbth-phero__name">{member.name}</h2>
        <div className="pbth-phero__nick">@{member.nickname}</div>
        <div className="pbth-small">
          {roleLabel(member.role)} · {playerStatusLabel(member.status)}
        </div>
      </div>

      <div className="pbth-stack">
        <Glass className="pbth-team__panel">
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
          <Row
            title="Посещаемость"
            sub={`${stats.eventsAttended} из ${stats.totalEvents} событий`}
            trailing={<span>{Math.round(stats.attendanceRate)}%</span>}
          />
          {/* «Игр» и MVP убраны: «Игр» равнялось числу событий команды и было
              одинаковым у всех, MVP приложение не считает (всегда 0). */}
          <Row
            title="Баланс"
            sub="по казне команды"
            trailing={<span className={balance < 0 ? 'pbth-stat__value--neg' : undefined}>{formatBalance(balance)}</span>}
          />
        </Glass>

        {canManage && <MemberRoleControl member={member} />}

        {canManage && (
          <Glass className="pbth-pad pbth-stack">
            <div style={{ fontSize: 16, fontWeight: 700 }}>Управление игроком</div>
            <div className="pbth-grid2">
              {STATUS_CHOICES.map(({ status, label }) => (
                <Button
                  key={status}
                  variant="glass2"
                  icon={member.status === status ? 'check' : undefined}
                  aria-current={member.status === status ? 'true' : undefined}
                  onClick={() => void setStatus(status)}
                >
                  {label}
                </Button>
              ))}
            </div>
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
          </Glass>
        )}
      </div>
    </Screen>
  );
};
