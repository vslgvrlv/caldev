import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  type AdminAuditResponse,
  type AdminEventItem,
  type AdminOverviewResponse,
  type AdminTeamMembersResponse,
  type AuthMeResponse,
} from '../../api';
import { Loader2, RefreshCw, Save, ShieldAlert } from 'lucide-react';

type AuthenticatedMe = Extract<AuthMeResponse, { authenticated: true }>;

type MemberDraft = {
  teamRole?: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
  status?: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
};

const EVENT_TYPE_OPTIONS = [
  'TRAINING',
  'TOURNAMENT',
  'CHAMPIONSHIP',
  'FRIENDLY_MATCH',
  'MEETING',
  'MAINTENANCE',
  'OTHER',
] as const;

export const AdminConsoleView: React.FC = () => {
  const navigate = useNavigate();
  const [me, setMe] = useState<AuthenticatedMe | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [events, setEvents] = useState<AdminEventItem[]>([]);
  const [members, setMembers] = useState<AdminTeamMembersResponse['items']>([]);
  const [audit, setAudit] = useState<AdminAuditResponse['items']>([]);
  const [memberDrafts, setMemberDrafts] = useState<Record<string, MemberDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [createTitle, setCreateTitle] = useState('');
  const [createType, setCreateType] = useState<(typeof EVENT_TYPE_OPTIONS)[number]>('TRAINING');
  const [createStartAt, setCreateStartAt] = useState('');
  const [createLocation, setCreateLocation] = useState('');

  const managedTeams = useMemo(() => {
    if (Array.isArray(me?.managedTeamIds) && me.managedTeamIds.length > 0) {
      return me.managedTeamIds;
    }
    const fromCaptainRoles = (me?.availableRoles || [])
      .filter((role) => role.role === 'CAPTAIN')
      .map((role) => role.teamId);
    return Array.from(new Set(fromCaptainRoles));
  }, [me]);
  const adminScopeLabel = me?.adminScope || 'NONE';

  const loadAuth = async () => {
    const auth = await api.getAuthMe();
    if (!auth.authenticated) {
      navigate('/admin/login', { replace: true });
      return null;
    }
    if (auth.adminScope === 'NONE') {
      setError('Недостаточно прав для admin console.');
      return null;
    }
    setMe(auth);
    return auth;
  };

  const loadData = async (teamIdOverride?: string) => {
    setLoading(true);
    setError('');
    try {
      const auth = (await loadAuth()) || me;
      if (!auth || auth.adminScope === 'NONE') return;

      const safeManagedTeamIds =
        Array.isArray((auth as any).managedTeamIds) && (auth as any).managedTeamIds.length > 0
          ? ((auth as any).managedTeamIds as string[])
          : Array.from(
              new Set(
                ((auth as any).availableRoles || [])
                  .filter((role: any) => role.role === 'CAPTAIN')
                  .map((role: any) => role.teamId)
              )
            );
      const currentTeam = teamIdOverride || selectedTeamId || safeManagedTeamIds[0] || '';
      if (currentTeam && currentTeam !== selectedTeamId) {
        setSelectedTeamId(currentTeam);
      }

      const [overviewRes, eventsRes, membersRes, auditRes] = await Promise.all([
        api.getAdminOverview(currentTeam || undefined),
        api.getAdminEvents({
          teamId: currentTeam || undefined,
          limit: 50,
          offset: 0,
        }),
        currentTeam ? api.getAdminTeamMembers(currentTeam) : Promise.resolve({ teamId: '', items: [] }),
        api.getAdminAudit({
          teamId: currentTeam || undefined,
          limit: 60,
        }),
      ]);

      setOverview(overviewRes);
      setEvents(eventsRes.items);
      setMembers(membersRes.items);
      setAudit(auditRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overviewMetrics = useMemo(() => {
    if (!overview) return null;
    return [
      ['Команд в scope', String(overview.summary.teamsCount)],
      ['Участников', String(overview.summary.membersCount)],
      ['Событий 30д', String(overview.summary.upcomingEventsCount)],
      ['RSVP completion', `${Math.round(overview.summary.rsvpCompletionRate * 100)}%`],
      ['Reminder success', `${Math.round(overview.summary.reminderDelivery.successRate * 100)}%`],
    ];
  }, [overview]);

  const handleLogout = async () => {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
    navigate('/admin/login', { replace: true });
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeamId) {
      setError('Выбери команду для создания события.');
      return;
    }
    if (!createTitle.trim() || !createStartAt) {
      setError('Нужны название и дата/время события.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.createAdminEvent({
        teamId: selectedTeamId,
        title: createTitle.trim(),
        type: createType,
        startAt: new Date(createStartAt).toISOString(),
        location: createLocation.trim() || undefined,
      });
      setCreateTitle('');
      setCreateLocation('');
      await loadData(selectedTeamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to create event');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCancel = async (event: AdminEventItem) => {
    setSaving(true);
    setError('');
    try {
      await api.patchAdminEvent(event.id, { isCancelled: !event.isCancelled });
      await loadData(selectedTeamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to update event');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMember = async (membershipId: string) => {
    if (!selectedTeamId) return;
    const draft = memberDrafts[membershipId];
    if (!draft || (!draft.teamRole && !draft.status)) return;

    setSaving(true);
    setError('');
    try {
      await api.patchAdminTeamMember(selectedTeamId, membershipId, draft);
      setMemberDrafts((prev) => {
        const next = { ...prev };
        delete next[membershipId];
        return next;
      });
      await loadData(selectedTeamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to update member');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-pb-background flex items-center justify-center text-white">
        <Loader2 className="animate-spin text-pb-primary" size={42} />
      </div>
    );
  }

  if (!me || me.adminScope === 'NONE') {
    return (
      <div className="min-h-screen bg-pb-background flex items-center justify-center text-white p-6">
        <div className="w-full max-w-md bg-pb-surface border border-red-500/30 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-2 text-red-300">
            <ShieldAlert size={22} />
            <h1 className="text-lg font-bold">Нет доступа к админке</h1>
          </div>
          <p className="text-sm text-pb-subtext mb-4">
            Текущая сессия не имеет `adminScope`.
          </p>
          <button
            onClick={() => navigate('/admin/login', { replace: true })}
            className="bg-pb-primary text-pb-background px-4 py-2 rounded-xl font-semibold"
          >
            Перейти ко входу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-pb-background text-white px-4 py-5">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-pb-surface border border-white/10 rounded-2xl p-4 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="text-xl font-bold">Admin Console v1</h1>
            <p className="text-sm text-pb-subtext">
              scope: {adminScopeLabel} · auth: {me.authMethod || 'unknown'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => loadData(selectedTeamId)}
              className="px-3 py-2 rounded-xl border border-white/20 hover:bg-white/10 inline-flex items-center gap-2"
              disabled={saving}
            >
              <RefreshCw size={16} />
              Обновить
            </button>
            <button
              onClick={() => {
                void handleLogout();
              }}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20"
            >
              Выйти
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="bg-pb-surface border border-white/10 rounded-2xl p-4">
          <label className="text-sm text-pb-subtext block mb-2">Рабочая команда</label>
          {managedTeams.length === 0 && (
            <div className="mb-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
              Для текущей сессии не получен список управляемых команд. Проверь роль (ADMIN/CAPTAIN) и перезайди в админку.
            </div>
          )}
          <select
            value={selectedTeamId}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedTeamId(next);
              loadData(next);
            }}
            className="bg-black/40 border border-white/20 rounded-lg px-3 py-2 text-white min-w-[280px]"
            disabled={managedTeams.length === 0}
          >
            {managedTeams.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-pb-surface border border-white/10 rounded-2xl p-4">
          <h2 className="font-semibold mb-3">Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            {(overviewMetrics || []).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-black/30 border border-white/10 p-3">
                <div className="text-xs text-pb-subtext">{label}</div>
                <div className="text-lg font-bold">{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-pb-surface border border-white/10 rounded-2xl p-4">
          <h2 className="font-semibold mb-3">Event Ops</h2>
          <form onSubmit={handleCreateEvent} className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
            <input
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="Название события"
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2"
            />
            <select
              value={createType}
              onChange={(e) => setCreateType(e.target.value as (typeof EVENT_TYPE_OPTIONS)[number])}
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2"
            >
              {EVENT_TYPE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={createStartAt}
              onChange={(e) => setCreateStartAt(e.target.value)}
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2"
            />
            <input
              value={createLocation}
              onChange={(e) => setCreateLocation(e.target.value)}
              placeholder="Локация"
              className="bg-black/40 border border-white/20 rounded-lg px-3 py-2"
            />
            <button
              type="submit"
              disabled={saving}
              className="bg-pb-primary text-pb-background rounded-lg px-3 py-2 font-semibold disabled:opacity-60"
            >
              Создать
            </button>
          </form>

          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl border border-white/10 bg-black/30 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {event.title} {event.isCancelled ? '(cancelled)' : ''}
                  </div>
                  <div className="text-xs text-pb-subtext">
                    {new Date(event.startAt).toLocaleString('ru-RU')} · {event.type}
                  </div>
                </div>
                <button
                  onClick={() => handleToggleCancel(event)}
                  disabled={saving}
                  className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-sm disabled:opacity-60"
                >
                  {event.isCancelled ? 'Восстановить' : 'Отменить'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-pb-surface border border-white/10 rounded-2xl p-4">
          <h2 className="font-semibold mb-3">Team Members</h2>
          <div className="space-y-2">
            {members.map((member) => {
              const draft = memberDrafts[member.membershipId] || {};
              return (
                <div key={member.membershipId} className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">{member.user.name}</div>
                      <div className="text-xs text-pb-subtext">@{member.user.username || 'no_username'}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={draft.teamRole || member.role}
                        onChange={(e) =>
                          setMemberDrafts((prev) => ({
                            ...prev,
                            [member.membershipId]: {
                              ...(prev[member.membershipId] || {}),
                              teamRole: e.target.value as MemberDraft['teamRole'],
                            },
                          }))
                        }
                        className="bg-black/40 border border-white/20 rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="CAPTAIN">CAPTAIN</option>
                        <option value="TRAINER">TRAINER</option>
                        <option value="PLAYER">PLAYER</option>
                      </select>
                      <select
                        value={draft.status || member.status}
                        onChange={(e) =>
                          setMemberDrafts((prev) => ({
                            ...prev,
                            [member.membershipId]: {
                              ...(prev[member.membershipId] || {}),
                              status: e.target.value as MemberDraft['status'],
                            },
                          }))
                        }
                        className="bg-black/40 border border-white/20 rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INJURED">INJURED</option>
                        <option value="RESERVE">RESERVE</option>
                        <option value="VACATION">VACATION</option>
                      </select>
                      <button
                        onClick={() => handleSaveMember(member.membershipId)}
                        disabled={saving}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-pb-primary text-pb-background text-sm font-semibold disabled:opacity-60"
                      >
                        <Save size={14} />
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-pb-surface border border-white/10 rounded-2xl p-4">
          <h2 className="font-semibold mb-3">Audit</h2>
          <div className="space-y-2 max-h-[360px] overflow-auto">
            {audit.map((row) => (
              <div key={row.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                <div className="text-sm font-semibold">{row.action}</div>
                <div className="text-xs text-pb-subtext mb-1">
                  {new Date(row.createdAt).toLocaleString('ru-RU')}
                  {row.actor?.name ? ` · ${row.actor.name}` : ''}
                </div>
                <pre className="text-xs text-pb-subtext whitespace-pre-wrap break-words">
                  {JSON.stringify(row.payload, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
