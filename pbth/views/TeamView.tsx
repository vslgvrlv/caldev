import React, { useState } from 'react';
import { Team, TeamMember, Role, PlayerStatus } from '../types';
import { TeamMemberCard } from '../components/TeamMemberCard';
import { UserPlus, Search, Shield, Users, Check, BarChart2, Star, Trophy } from 'lucide-react';
import { api } from '../api';
import { buildInviteLink } from '../lib/team-invite-link';

interface TeamViewProps {
  team: Team;
  members: TeamMember[];
  currentUserRole: Role;
  onMemberClick: (member: TeamMember) => void;
  onUpdateMemberStatus: (member: TeamMember, status: PlayerStatus) => Promise<void> | void;
  onRemoveMember: (member: TeamMember) => Promise<void> | void;
}

export const TeamView: React.FC<TeamViewProps> = ({
  team,
  members,
  currentUserRole,
  onMemberClick,
  onUpdateMemberStatus,
  onRemoveMember,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showCopied, setShowCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'ROSTER' | 'STATS'>('ROSTER');
  const [quickMember, setQuickMember] = useState<TeamMember | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);

  const isAdminOrCaptain = currentUserRole === Role.ADMIN || currentUserRole === Role.CAPTAIN;

  // Filter members
  const filteredMembers = members.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.nickname.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const copyText = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below.
    }

    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.top = '-9999px';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textArea);
      return copied;
    } catch {
      return false;
    }
  };

  const handleCopyInvite = async () => {
    try {
      const created = await api.createTeamInvite(team.id, { teamRole: 'PLAYER', expiresInHours: 72 });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const inviteLink = buildInviteLink(origin, created.token);

      const copied = await copyText(inviteLink);
      if (copied) {
        setShowCopied(true);
        setTimeout(() => setShowCopied(false), 2000);
        return;
      }

      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Инвайт в команду',
            text: 'Ссылка для вступления в команду',
            url: inviteLink,
          });
          return;
        } catch {
          // Ignore and show manual fallback.
        }
      }

      window.prompt('Ссылка создана. Скопируйте вручную:', inviteLink);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      alert(`Не удалось создать инвайт-ссылку: ${detail}`);
    }
  };

  const runQuickAction = async (fn: () => Promise<void> | void) => {
    if (!quickMember || quickBusy) return;
    setQuickBusy(true);
    try {
      await fn();
      setQuickMember(null);
    } catch (err) {
      alert(`Не удалось применить действие: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setQuickBusy(false);
    }
  };

  const renderRoster = () => {
    // Grouping
    const leaders = filteredMembers.filter(m => m.role === Role.ADMIN || m.role === Role.CAPTAIN);
    const staff = filteredMembers.filter(m => m.role === Role.TRAINER);
    const activePlayers = filteredMembers.filter(m => m.role === Role.PLAYER && m.status === PlayerStatus.ACTIVE);
    const others = filteredMembers.filter(m => m.role === Role.PLAYER && m.status !== PlayerStatus.ACTIVE);

    return (
      <div className="space-y-6">
        {leaders.length > 0 && (
          <section>
            <div className="flex items-center text-pb-subtext text-xs font-bold uppercase tracking-wider mb-2">
              <Shield size={12} className="mr-1" /> Руководство
            </div>
            {leaders.map(member => (
              <TeamMemberCard
                key={member.id}
                member={member}
                isViewerAdmin={isAdminOrCaptain}
                onClick={() => onMemberClick(member)}
                onQuickActions={() => setQuickMember(member)}
              />
            ))}
          </section>
        )}
        {staff.length > 0 && (
          <section>
            <div className="flex items-center text-pb-subtext text-xs font-bold uppercase tracking-wider mb-2">
              <Star size={12} className="mr-1" /> Тренерский штаб
            </div>
            {staff.map(member => (
              <TeamMemberCard
                key={member.id}
                member={member}
                isViewerAdmin={isAdminOrCaptain}
                onClick={() => onMemberClick(member)}
                onQuickActions={() => setQuickMember(member)}
              />
            ))}
          </section>
        )}
        {activePlayers.length > 0 && (
          <section>
            <div className="flex items-center text-pb-subtext text-xs font-bold uppercase tracking-wider mb-2">
              <Users size={12} className="mr-1" /> Основной состав
            </div>
            {activePlayers.map(member => (
              <TeamMemberCard
                key={member.id}
                member={member}
                isViewerAdmin={isAdminOrCaptain}
                onClick={() => onMemberClick(member)}
                onQuickActions={() => setQuickMember(member)}
              />
            ))}
          </section>
        )}
        {others.length > 0 && (
          <section>
            <div className="flex items-center text-pb-subtext text-xs font-bold uppercase tracking-wider mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-pb-subtext mr-2"></span> Резерв / Другие
            </div>
            {others.map(member => (
              <TeamMemberCard
                key={member.id}
                member={member}
                isViewerAdmin={isAdminOrCaptain}
                onClick={() => onMemberClick(member)}
                onQuickActions={() => setQuickMember(member)}
              />
            ))}
          </section>
        )}
        {filteredMembers.length === 0 && (
          <div className="text-center text-pb-subtext py-8">Никого не найдено</div>
        )}
      </div>
    );
  };

  const renderStats = () => {
    // Sort by MVP or Attendance
    const sortedByMVP = [...filteredMembers].sort((a, b) => (b.stats?.mvpCount || 0) - (a.stats?.mvpCount || 0));

    return (
      <div className="space-y-4">
        {sortedByMVP.map(member => {
            const stats = member.stats || { attendanceRate: 0, eventsAttended: 0, totalEvents: 0, mvpCount: 0, matchesPlayed: 0 };
            return (
                <button
                    key={member.id}
                    onClick={() => onMemberClick(member)}
                    className="w-full text-left bg-pb-surface p-4 rounded-xl border border-white/5 hover:border-pb-primary/40 transition-colors"
                >
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center space-x-3">
                            <img src={member.avatar} className="w-10 h-10 rounded-full" alt={member.name} />
                            <div>
                                <div className="text-white font-bold text-sm">{member.name}</div>
                                <div className="text-pb-primary text-xs">@{member.nickname}</div>
                            </div>
                        </div>
                        {stats.mvpCount > 0 && (
                             <div className="flex items-center text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded-lg">
                                <Trophy size={14} className="mr-1" />
                                <span className="text-xs font-bold">{stats.mvpCount} MVP</span>
                             </div>
                        )}
                    </div>

                    <div className="space-y-3">
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-pb-subtext">Посещаемость</span>
                                <span className="text-white font-bold">{stats.attendanceRate}% ({stats.eventsAttended}/{stats.totalEvents})</span>
                            </div>
                            <div className="w-full bg-black/50 h-2 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-pb-primary rounded-full" 
                                    style={{ width: `${stats.attendanceRate}%` }}
                                ></div>
                            </div>
                        </div>
                        <div className="flex gap-4 pt-2 border-t border-white/5">
                             <div className="text-center flex-1">
                                 <div className="text-lg font-bold text-white">{stats.matchesPlayed}</div>
                                 <div className="text-[10px] text-pb-subtext uppercase">Игр</div>
                             </div>
                             {/* Placeholder for Win Rate if we tracked game results per player */}
                             <div className="text-center flex-1 border-l border-white/10">
                                 <div className="text-lg font-bold text-pb-secondary">1.4</div>
                                 <div className="text-[10px] text-pb-subtext uppercase">K/D Ratio</div>
                             </div>
                        </div>
                    </div>
                </button>
            );
        })}
      </div>
    );
  };

  return (
    <div
      className="pb-24 px-4 h-full flex flex-col animate-fade-in relative"
      style={{ paddingTop: 'calc(var(--pb-safe-top) + 1rem)' }}
    >
      {/* Toast Notification */}
      {showCopied && (
          <div
              className="absolute left-1/2 -translate-x-1/2 bg-pb-surface border border-pb-primary text-white px-4 py-2 rounded-full shadow-lg z-50 flex items-center animate-fade-in"
              style={{ top: 'calc(var(--pb-safe-top) + 1rem)' }}
          >
              <Check size={16} className="text-pb-primary mr-2" />
              <span className="text-xs font-bold">Ссылка скопирована!</span>
          </div>
      )}

      {/* Header */}
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-white mb-1">Команда</h1>
        <div className="flex justify-between items-end mb-4">
          <div>
            <h2 className="text-pb-primary font-bold text-lg leading-tight">{team.name}</h2>
            <p className="text-pb-subtext text-xs">{members.length} участников</p>
          </div>
          {isAdminOrCaptain && activeTab === 'ROSTER' && (
            <button 
              onClick={handleCopyInvite}
              className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-xl transition-colors active:scale-95"
            >
              <UserPlus size={20} />
            </button>
          )}
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-pb-surface rounded-xl p-1 border border-white/5 mb-2">
            <button 
                onClick={() => setActiveTab('ROSTER')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'ROSTER' ? 'bg-white/10 text-white' : 'text-pb-subtext hover:text-white'}`}
            >
                <Users size={14} /> Состав
            </button>
            <button 
                onClick={() => setActiveTab('STATS')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'STATS' ? 'bg-white/10 text-white' : 'text-pb-subtext hover:text-white'}`}
            >
                <BarChart2 size={14} /> Статистика
            </button>
        </div>
      </header>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-pb-subtext" size={18} />
        <input 
          type="text" 
          placeholder="Поиск игрока..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-pb-surface text-white pl-10 pr-4 py-3 rounded-xl border border-white/5 focus:outline-none focus:border-pb-primary transition-colors placeholder:text-pb-subtext/50"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
         {activeTab === 'ROSTER' ? renderRoster() : renderStats()}
      </div>

      {quickMember && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-end" onClick={() => setQuickMember(null)}>
          <div
            className="w-full bg-pb-surface border-t border-white/10 rounded-t-2xl p-4 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm text-pb-subtext">Быстрые действия</div>
            <div className="font-semibold text-white">{quickMember.name}</div>

            <button
              disabled={quickBusy}
              onClick={() => {
                void runQuickAction(async () => onUpdateMemberStatus(quickMember, PlayerStatus.ACTIVE));
              }}
              className="w-full text-left px-3 py-3 rounded-xl bg-white/5 hover:bg-white/10"
            >
              В строю
            </button>
            <button
              disabled={quickBusy}
              onClick={() => {
                void runQuickAction(async () => onUpdateMemberStatus(quickMember, PlayerStatus.RESERVE));
              }}
              className="w-full text-left px-3 py-3 rounded-xl bg-white/5 hover:bg-white/10"
            >
              В резерв
            </button>
            <button
              disabled={quickBusy}
              onClick={() => {
                void runQuickAction(async () => onUpdateMemberStatus(quickMember, PlayerStatus.INJURED));
              }}
              className="w-full text-left px-3 py-3 rounded-xl bg-white/5 hover:bg-white/10"
            >
              Травма
            </button>
            <button
              disabled={quickBusy}
              onClick={() => {
                void runQuickAction(async () => onUpdateMemberStatus(quickMember, PlayerStatus.VACATION));
              }}
              className="w-full text-left px-3 py-3 rounded-xl bg-white/5 hover:bg-white/10"
            >
              Отпуск
            </button>
            <button
              disabled={quickBusy}
              onClick={() => {
                const confirmed = window.confirm(`Исключить ${quickMember.name} из команды?`);
                if (!confirmed) return;
                void runQuickAction(async () => onRemoveMember(quickMember));
              }}
              className="w-full text-left px-3 py-3 rounded-xl bg-red-500/10 text-red-300 hover:bg-red-500/20"
            >
              Исключить из команды
            </button>
            <button
              disabled={quickBusy}
              onClick={() => {
                onMemberClick(quickMember);
                setQuickMember(null);
              }}
              className="w-full text-left px-3 py-3 rounded-xl bg-pb-primary/15 text-pb-primary hover:bg-pb-primary/25"
            >
              Открыть профиль игрока
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
