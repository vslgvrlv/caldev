import React, { useState } from 'react';
import { Team, TeamMember, Role, PlayerStatus } from '../types';
import { confirmAction, errorText, notify } from '../lib/notify';
import { TeamJoinLinkSheet } from '../components/track1/TeamJoinLinkSheet';
import { PersonAvatar } from '../components/people/PersonAvatar';
import { teamLinkAccess } from '../lib/team-link-access';
import { attendanceLabel, filterMembers, isLeader, memberSub, rosterHeadline, sortRoster } from '../lib/team-roster';
import { usePendingRequests } from '../lib/use-pending-requests';
import { Button, Glass, Icon, Row, Screen, Seg, Sheet, TeamMark, teamPaint } from '../ui';
import './team/team.css';

interface TeamViewProps {
  team: Team;
  members: TeamMember[];
  currentUserRole: Role;
  onMemberClick: (member: TeamMember) => void;
  onUpdateMemberStatus: (member: TeamMember, status: PlayerStatus) => Promise<void> | void;
  onRemoveMember: (member: TeamMember) => Promise<void> | void;
  /** Кто смотрит: у него в списке стоит «· ты». */
  currentUserId?: string;
  /** Переход на экран заявок (строка «Заявки»). */
  onOpenRequests?: () => void;
}

type View = 'ROSTER' | 'STATS';

const STATUS_CHOICES: Array<{ status: PlayerStatus; label: string }> = [
  { status: PlayerStatus.ACTIVE, label: 'В строю' },
  { status: PlayerStatus.RESERVE, label: 'В резерв' },
  { status: PlayerStatus.INJURED, label: 'Травма' },
  { status: PlayerStatus.VACATION, label: 'Отпуск' },
];

const VIEW_ITEMS = [
  { value: 'ROSTER', label: 'Состав' },
  { value: 'STATS', label: 'Посещаемость' },
];

/** Поиск нужен, когда игроков больше, чем помещается на экран. */
const SEARCH_FROM = 11;

export const TeamView: React.FC<TeamViewProps> = ({
  team,
  members,
  currentUserRole,
  onMemberClick,
  onUpdateMemberStatus,
  onRemoveMember,
  currentUserId,
  onOpenRequests,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  // Ссылка команды (трек 1): постоянная, с кодом и QR.
  const [linkOpen, setLinkOpen] = useState(false);
  const [view, setView] = useState<View>('ROSTER');
  const [quickMember, setQuickMember] = useState<TeamMember | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);

  const isAdminOrCaptain = currentUserRole === Role.ADMIN || currentUserRole === Role.CAPTAIN;
  // Ссылку команды показывают капитан и тренер (заявки одобряют оба), отзывает — капитан.
  const linkAccess = teamLinkAccess(currentUserRole);
  const pending = usePendingRequests(linkAccess.canShare && !!onOpenRequests, team.id);

  const visible = sortRoster(filterMembers(members, searchTerm), view === 'STATS' ? 'attendance' : 'roster');

  const runQuickAction = async (fn: () => Promise<void> | void) => {
    if (!quickMember || quickBusy) return;
    setQuickBusy(true);
    try {
      await fn();
      setQuickMember(null);
    } catch (err) {
      notify.error(errorText(err, 'Не получилось. Попробуй ещё раз.'));
    } finally {
      setQuickBusy(false);
    }
  };

  const paint = teamPaint(team.id);
  const onViewChange = React.useCallback((v: string) => setView(v as View), []);

  return (
    <Screen paints={[paint]}>
      <div className="pbth-team__hero">
        <TeamMark teamId={team.id} name={team.name} code={team.shortCode} size={72} />
        <div className="pbth-team__heroText">
          <h1 className="pbth-team__name">{team.name}</h1>
          <div className="pbth-team__meta">{rosterHeadline(members.length, currentUserRole, team.via)}</div>
        </div>
      </div>

      <div className="pbth-team__tools">
        <Seg items={VIEW_ITEMS} value={view} onChange={onViewChange} label="Что показать" fill />
        {members.length >= SEARCH_FROM && (
          <input
            type="search"
            className="ui-input"
            placeholder="Поиск игрока"
            aria-label="Поиск игрока"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        )}
      </div>

      <Glass className="pbth-team__panel">
        {view === 'ROSTER' && linkAccess.canShare && onOpenRequests && (
          <Row
            lead={<span className="pbth-iconlead ui-glass2"><Icon name="users" /></span>}
            title={pending > 0 ? `Заявки · ${pending}` : 'Заявки'}
            chevron
            onClick={onOpenRequests}
          />
        )}
        {view === 'ROSTER' && linkAccess.canShare && (
          <Row
            lead={<span className="pbth-iconlead ui-glass2"><Icon name="link" /></span>}
            title="Ссылка команды"
            chevron
            onClick={() => setLinkOpen(true)}
          />
        )}
        {visible.map((member) => {
          const att = attendanceLabel(member);
          const isMe = member.id === currentUserId;
          return (
            <Row
              key={member.id}
              lead={<PersonAvatar name={member.name} photo={member.avatar} size={40} />}
              title={
                <span className="pbth-team__name-line">
                  {member.name}
                  {isLeader(member) && <Icon name="shield-check" size={16} label="Капитан" className="pbth-team__leader" />}
                  {isMe && <span className="pbth-team__you">· ты</span>}
                </span>
              }
              sub={view === 'STATS' ? `${att.detail} событий` : memberSub(member)}
              trailing={
                view === 'STATS' ? (
                  <span className="pbth-team__pct">{att.percent}</span>
                ) : member.phone || isAdminOrCaptain ? (
                  <span className="pbth-team__acts">
                    {member.phone && (
                      <Button
                        as="a"
                        variant="ghost"
                        icon="phone"
                        href={`tel:${member.phone}`}
                        aria-label={`Позвонить: ${member.name}`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      />
                    )}
                    {isAdminOrCaptain && (
                      <Button
                        variant="ghost"
                        icon="ellipsis"
                        aria-label={`Управление участником ${member.name}`}
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          setQuickMember(member);
                        }}
                      />
                    )}
                  </span>
                ) : undefined
              }
              role="button"
              tabIndex={0}
              as="div"
              onClick={() => onMemberClick(member)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onMemberClick(member);
                }
              }}
            />
          );
        })}
        {visible.length === 0 && <div className="pbth-team__empty">Никого не найдено</div>}
      </Glass>

      {linkOpen && (
        <TeamJoinLinkSheet
          teamId={team.id}
          teamName={team.name}
          canRotate={linkAccess.canRotate}
          onClose={() => setLinkOpen(false)}
        />
      )}

      <Sheet open={quickMember !== null} onClose={() => setQuickMember(null)} title={quickMember?.name} subtitle="Быстрые действия">
        {quickMember && (
          <div className="pbth-btnlist">
            {STATUS_CHOICES.map(({ status, label }) => (
              <Button
                key={status}
                variant="glass2"
                block
                disabled={quickBusy}
                onClick={() => void runQuickAction(async () => onUpdateMemberStatus(quickMember, status))}
              >
                {label}
              </Button>
            ))}
            <Button
              variant="glass2"
              block
              icon="user"
              disabled={quickBusy}
              onClick={() => {
                const target = quickMember;
                setQuickMember(null);
                onMemberClick(target);
              }}
            >
              Открыть профиль игрока
            </Button>
            <Button
              variant="danger"
              block
              disabled={quickBusy}
              onClick={() => {
                const target = quickMember;
                void confirmAction(`Исключить ${target.name} из команды?`, { confirmLabel: 'Исключить', danger: true }).then(
                  (confirmed) => {
                    if (confirmed) void runQuickAction(async () => onRemoveMember(target));
                  },
                );
              }}
            >
              Исключить из команды
            </Button>
          </div>
        )}
      </Sheet>
    </Screen>
  );
};
