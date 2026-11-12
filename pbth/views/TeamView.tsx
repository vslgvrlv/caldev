import React, { useState } from 'react';
import { Team, TeamMember, Role, PlayerStatus } from '../types';
import { confirmAction, errorText, notify } from '../lib/notify';
import { TeamJoinLinkSheet } from '../components/track1/TeamJoinLinkSheet';
import { TeamLookSheet } from '../components/team/TeamLookSheet';
import { teamLinkAccess } from '../lib/team-link-access';
import { attendanceLabel, filterMembers, groupRoster, isLeader, memberSub, sortRoster } from '../lib/team-roster';
import { usePendingRequests } from '../lib/use-pending-requests';
import { Avatar, Button, Glass, Icon, Row, Screen, Seg, Sheet, teamPaint } from '../ui';
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
  /** Строка «Казна» над составом: подпись (остаток или свой долг) и переход. */
  treasury?: { sub?: string; onOpen: () => void };
  /** Пункты меню команды строками (журнал, открытое расписание): значок ui-kit, подпись, переход. */
  menuRows?: Array<{ id: string; label: string; icon: string; onOpen: () => void }>;
  /** Капитан сохранил оформление команды: перечитать данные. */
  onLookSaved?: () => void;
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

export const TeamView: React.FC<TeamViewProps> = ({
  team,
  members,
  currentUserRole,
  onMemberClick,
  onUpdateMemberStatus,
  onRemoveMember,
  currentUserId,
  onOpenRequests,
  treasury,
  menuRows = [],
  onLookSaved,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  // Ссылка команды (трек 1): постоянная, с кодом и QR.
  const [linkOpen, setLinkOpen] = useState(false);
  // Оформление команды (краска, фигура, буквы знака) меняет капитан.
  const [lookOpen, setLookOpen] = useState(false);
  const [view, setView] = useState<View>('ROSTER');
  const [quickMember, setQuickMember] = useState<TeamMember | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);

  const isAdminOrCaptain = currentUserRole === Role.ADMIN || currentUserRole === Role.CAPTAIN;
  // Ссылку команды показывают капитан и тренер (заявки одобряют оба), отзывает — капитан.
  const linkAccess = teamLinkAccess(currentUserRole);
  const pending = usePendingRequests(linkAccess.canShare && !!onOpenRequests, team.id);

  const found = filterMembers(members, searchTerm);
  const visible = sortRoster(found, view === 'STATS' ? 'attendance' : 'roster');
  const groups = view === 'STATS' ? [{ key: 'all', title: '', members: visible }] : groupRoster(found);

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
      {/* Название команды, число участников и роль — в шапке раздела (оболочка); знак команды отмечен в её ряду. */}
      <div className="pbth-team__tools">
        <Seg items={VIEW_ITEMS} value={view} onChange={onViewChange} label="Что показать" fill />
        <input
          type="search"
          className="ui-input"
          placeholder="Поиск игрока"
          aria-label="Поиск игрока"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <Glass className="pbth-team__panel">
        {view === 'ROSTER' && treasury && (
          <Row
            lead={<span className="pbth-iconlead ui-glass2"><Icon name="wallet" /></span>}
            title="Казна"
            sub={treasury.sub}
            chevron
            onClick={treasury.onOpen}
          />
        )}
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
            title="Пригласить"
            sub="ссылка команды"
            chevron
            onClick={() => setLinkOpen(true)}
          />
        )}
        {view === 'ROSTER' && isAdminOrCaptain && (
          <Row
            lead={<span className="pbth-iconlead ui-glass2"><Icon name="palette" /></span>}
            title="Оформление"
            sub="краска, фигура и буквы знака"
            chevron
            onClick={() => setLookOpen(true)}
          />
        )}
        {view === 'ROSTER' &&
          menuRows.map((row) => (
            <Row
              key={row.id}
              lead={<span className="pbth-iconlead ui-glass2"><Icon name={row.icon} /></span>}
              title={row.label}
              chevron
              onClick={row.onOpen}
            />
          ))}
        {groups.map((group) => (
          <React.Fragment key={group.key}>
            {group.title && <div className="pbth-team__group">{group.title}</div>}
            {group.members.map((member) => {
          const att = attendanceLabel(member);
          const isMe = member.id === currentUserId;
          return (
            <Row
              key={member.id}
              lead={<Avatar name={member.name} src={member.avatar} size={40} />}
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
          </React.Fragment>
        ))}
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

      {lookOpen && (
        <TeamLookSheet
          teamId={team.id}
          teamName={team.name}
          shortCode={team.shortCode}
          onClose={() => setLookOpen(false)}
          onSaved={onLookSaved}
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
