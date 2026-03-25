import React from 'react';
import { TeamMember, PlayerStatus } from '../types';
import { ROLE_LABELS, STATUS_LABELS } from '../constants';
import { ChevronLeft, Phone, Shield, Activity, CalendarDays, Trophy, Coins } from 'lucide-react';

interface PlayerProfileViewProps {
  member: TeamMember;
  teamName: string;
  onBack: () => void;
  canManage?: boolean;
  onUpdateMemberStatus?: (member: TeamMember, status: PlayerStatus) => Promise<void> | void;
  onRemoveMember?: (member: TeamMember) => Promise<void> | void;
}

export const PlayerProfileView: React.FC<PlayerProfileViewProps> = ({
  member,
  teamName,
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
  const balanceLabel = balance > 0 ? `+${balance.toFixed(0)} ₽` : `${balance.toFixed(0)} ₽`;
  const balanceColor = balance > 0 ? 'text-pb-primary' : balance < 0 ? 'text-pb-danger' : 'text-white';

  return (
    <div className="min-h-screen bg-pb-background flex flex-col pb-safe animate-fade-in">
      <div
        className="sticky top-0 z-10 flex items-center border-b border-white/5 bg-pb-background/80 px-4 pb-3 backdrop-blur-md"
        style={{ paddingTop: 'calc(var(--pb-safe-top) + 0.75rem)' }}
      >
        <button onClick={onBack} className="p-2 -ml-2 text-white hover:bg-white/10 rounded-full">
          <ChevronLeft size={24} />
        </button>
        <span className="ml-2 font-bold text-lg text-white">Профиль игрока</span>
      </div>

      <div className="p-4 space-y-4">
        <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
          <div className="flex items-center gap-3">
            <img
              src={member.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=1E1E2E&color=fff`}
              alt={member.name}
              className="w-16 h-16 rounded-full object-cover border-2 border-pb-primary/50"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xl font-bold text-white truncate">{member.name}</div>
              <div className="text-pb-primary text-sm truncate">@{member.nickname}</div>
              <div className="text-pb-subtext text-xs mt-1">{teamName}</div>
            </div>
          </div>

          <div className="mt-4 flex gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 text-white">
              {ROLE_LABELS[member.role]}
            </span>
            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 text-pb-subtext">
              {STATUS_LABELS[member.status]}
            </span>
          </div>

          {member.phone && (
            <a
              href={`tel:${member.phone}`}
              className="mt-4 inline-flex items-center gap-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-white"
            >
              <Phone size={14} /> {member.phone}
            </a>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
            <div className="flex items-center text-pb-subtext text-xs mb-1">
              <Activity size={14} className="mr-1.5" /> Посещаемость
            </div>
            <div className="text-xl font-bold text-white">{stats.attendanceRate}%</div>
            <div className="text-xs text-pb-subtext">{stats.eventsAttended}/{stats.totalEvents} событий</div>
          </div>
          <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
            <div className="flex items-center text-pb-subtext text-xs mb-1">
              <CalendarDays size={14} className="mr-1.5" /> Игр
            </div>
            <div className="text-xl font-bold text-white">{stats.matchesPlayed}</div>
            <div className="text-xs text-pb-subtext">сыграно матчей</div>
          </div>
          <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
            <div className="flex items-center text-pb-subtext text-xs mb-1">
              <Trophy size={14} className="mr-1.5" /> MVP
            </div>
            <div className="text-xl font-bold text-white">{stats.mvpCount}</div>
            <div className="text-xs text-pb-subtext">лучший игрок</div>
          </div>
          <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
            <div className="flex items-center text-pb-subtext text-xs mb-1">
              <Coins size={14} className="mr-1.5" /> Баланс
            </div>
            <div className={`text-xl font-bold ${balanceColor}`}>{balanceLabel}</div>
            <div className="text-xs text-pb-subtext">по казне команды</div>
          </div>
        </div>

        <div className="bg-pb-surface rounded-2xl p-4 border border-white/5 text-sm text-pb-subtext">
          <div className="flex items-center text-white font-semibold mb-2">
            <Shield size={14} className="mr-2 text-pb-primary" />
            Карточка игрока
          </div>
          Источник данных: состав команды и подтвержденные RSVP.
        </div>

        {canManage && (
          <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
            <div className="text-white font-semibold mb-3">Управление игроком</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  void onUpdateMemberStatus?.(member, PlayerStatus.ACTIVE);
                }}
                className="py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm"
              >
                В строю
              </button>
              <button
                onClick={() => {
                  void onUpdateMemberStatus?.(member, PlayerStatus.RESERVE);
                }}
                className="py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm"
              >
                Резерв
              </button>
              <button
                onClick={() => {
                  void onUpdateMemberStatus?.(member, PlayerStatus.INJURED);
                }}
                className="py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm"
              >
                Травма
              </button>
              <button
                onClick={() => {
                  void onUpdateMemberStatus?.(member, PlayerStatus.VACATION);
                }}
                className="py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm"
              >
                Отпуск
              </button>
            </div>
            <button
              onClick={() => {
                const confirmed = window.confirm(`Исключить ${member.name} из команды?`);
                if (!confirmed) return;
                void onRemoveMember?.(member);
              }}
              className="mt-3 w-full py-2 rounded-xl bg-red-500/10 text-red-300 hover:bg-red-500/20 text-sm"
            >
              Исключить из команды
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
