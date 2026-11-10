import React from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Copy, Plus, Search, Share2, Shield, UserPlus, X } from 'lucide-react';
import { useShell } from '../../shell/context';
import { RequireAuth } from '../../shell/gates';
import { ContentLoader } from '../../components/shell/ScreenLoader';
import { confirmAction, errorText, notify } from '../../lib/notify';
import { playerStatusLabel, roleLabel } from '../../lib/labels';
import { buildInviteLink } from '../../lib/team-invite-link';
import { teamPath, eventPath } from '../../lib/team-url';
import {
  platformApi,
  type PlatformTeam,
  type PlatformTeamCard,
  type TeamCreationRequest,
} from '../../api/track3';
import { dateTimeLabel, plural, sinceLabel } from '../../components/track3/format';

// Консоль владельца платформы `/admin` (трек 3 ревизии, боль Б3).
//
// Здесь только то, что нужно над командами: список всех команд с состоянием,
// заявки на создание, создать команду, помочь команде (открыть её как капитан,
// пригласить капитана). События, состав, деньги владелец ведёт экранами
// капитана в самой команде — кнопка «Открыть как капитан».

const card = 'bg-pb-surface rounded-2xl border border-white/5';
// Высота кнопки задаётся при использовании (py-2 / py-2.5 / py-3).
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-pb-primary text-pb-background font-bold px-4 active:scale-[0.98] transition-transform disabled:opacity-50';
const secondaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 text-white font-semibold px-4 hover:bg-white/5 active:scale-[0.98] transition-transform disabled:opacity-50';
const input =
  'w-full rounded-xl bg-black/30 border border-white/10 px-3 py-3 text-white placeholder:text-pb-subtext focus:outline-none focus:border-pb-primary/60';

const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-pb-background bg-splatter bg-fixed text-white font-sans">
    <main className="max-w-3xl mx-auto px-4 pb-16" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
      {children}
    </main>
  </div>
);

const TopBar: React.FC<{ title: string; back?: { to: string; label: string } }> = ({ title, back }) => {
  const navigate = useNavigate();
  return (
    <header className="flex items-center justify-between gap-3 mb-5">
      <div className="min-w-0">
        {back ? (
          <Link to={back.to} className="inline-flex items-center gap-1 text-pb-subtext text-sm mb-1 hover:text-white">
            <ArrowLeft size={16} />
            {back.label}
          </Link>
        ) : (
          <div className="flex items-center gap-1.5 text-pb-subtext text-xs mb-1">
            <Shield size={14} className="text-pb-primary" />
            Владелец платформы
          </div>
        )}
        <h1 className="text-2xl font-bold break-words">{title}</h1>
      </div>
      <button type="button" onClick={() => navigate('/app')} className={`${secondaryBtn} shrink-0 py-2`}>
        В приложение
        <ArrowRight size={16} />
      </button>
    </header>
  );
};

function membersText(n: number): string {
  return `${n} ${plural(n, 'участник', 'участника', 'участников')}`;
}

// --- Заявки на создание команды (ручки трека 1) ------------------------------

type RequestsState = { status: 'loading' } | { status: 'ready'; items: TeamCreationRequest[] } | { status: 'unavailable' };

const CreationRequests: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [state, setState] = React.useState<RequestsState>({ status: 'loading' });
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setState({ status: 'ready', items: await platformApi.listTeamCreationRequests() });
    } catch {
      setState({ status: 'unavailable' });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (request: TeamCreationRequest, approve: boolean) => {
    if (!approve) {
      const ok = await confirmAction(`Отклонить заявку на команду «${request.teamName}»?`, {
        confirmLabel: 'Отклонить',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(request.id);
    try {
      if (approve) {
        await platformApi.approveTeamCreationRequest(request.id);
        notify.success(`Команда «${request.teamName}» создана`);
      } else {
        await platformApi.declineTeamCreationRequest(request.id);
        notify.success('Заявка отклонена');
      }
      await load();
      onChanged();
    } catch (error) {
      notify.error(errorText(error, 'Не получилось. Попробуй ещё раз.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-6">
      <h2 className="text-lg font-bold mb-2">Заявки на создание команды</h2>
      {state.status === 'loading' && <p className="text-pb-subtext text-sm">Загружаю…</p>}
      {state.status === 'unavailable' && (
        <p className="text-pb-subtext text-sm">Заявки сейчас не загрузились. Загляни позже.</p>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <p className="text-pb-subtext text-sm">Новых заявок нет.</p>
      )}
      {state.status === 'ready' && state.items.length > 0 && (
        <ul className="space-y-3">
          {state.items.map((request) => (
            <li key={request.id} className={`${card} p-4`}>
              <div className="font-bold">{request.teamName}</div>
              <div className="text-pb-subtext text-sm mt-0.5">
                {request.requesterName}
                {request.requesterUsername ? ` · @${request.requesterUsername}` : ''}
                {request.createdAt ? ` · ${dateTimeLabel(request.createdAt)}` : ''}
              </div>
              {request.note && <p className="text-sm mt-2 text-white/90">{request.note}</p>}
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() => void act(request, true)}
                  className={`${primaryBtn} flex-1 py-2.5`}
                >
                  <Check size={16} />
                  Одобрить
                </button>
                <button
                  type="button"
                  disabled={busy === request.id}
                  onClick={() => void act(request, false)}
                  className={`${secondaryBtn} flex-1 py-2.5`}
                >
                  <X size={16} />
                  Отклонить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// --- Создать команду ---------------------------------------------------------

const CreateTeamForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const navigate = useNavigate();
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [codeEdited, setCodeEdited] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Код подставляется из названия, пока его не поправили руками.
  React.useEffect(() => {
    if (codeEdited) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setCode('');
      return;
    }
    const timer = window.setTimeout(() => {
      platformApi
        .suggestShortCode(trimmed)
        .then((res) => setCode(res.shortCode))
        .catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [name, codeEdited]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      notify.error('Название — хотя бы два знака.');
      return;
    }
    setSaving(true);
    try {
      const { team } = await platformApi.createTeam({ name: name.trim(), ...(code.trim() ? { shortCode: code.trim() } : {}) });
      notify.success('Команда создана. Пригласи капитана.');
      navigate(`/admin/teams/${team.shortCode.toLowerCase()}`);
    } catch (error) {
      notify.error(errorText(error, 'Команда не создалась. Попробуй ещё раз.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={`${card} p-4 mb-6 space-y-3`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Новая команда</h2>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="text-pb-subtext hover:text-white">
          <X size={20} />
        </button>
      </div>
      <label className="block">
        <span className="text-sm text-pb-subtext">Название</span>
        <input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Дневной Дозор" autoFocus />
      </label>
      <label className="block">
        <span className="text-sm text-pb-subtext">Короткий код — для адреса команды</span>
        <input
          className={`${input} mt-1 uppercase`}
          value={code}
          onChange={(e) => {
            setCodeEdited(true);
            setCode(e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16));
          }}
          placeholder="Подставится сам"
        />
      </label>
      <button type="submit" disabled={saving} className={`${primaryBtn} py-3 w-full`}>
        {saving ? 'Создаю…' : 'Создать команду'}
      </button>
    </form>
  );
};

// --- Список команд -----------------------------------------------------------

const TeamRow: React.FC<{ team: PlatformTeam }> = ({ team }) => (
  <li>
    <Link
      to={`/admin/teams/${team.shortCode.toLowerCase()}`}
      className={`${card} block p-4 hover:border-pb-primary/40 transition-colors`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold truncate">{team.name}</div>
          <div className="text-pb-subtext text-xs mt-0.5">
            {team.shortCode.toLowerCase()} · {membersText(team.membersCount)}
            {team.captains.length > 0 ? ` · капитан ${team.captains.join(', ')}` : ' · без капитана'}
          </div>
        </div>
        {team.isMine && (
          <span className="shrink-0 rounded-full bg-pb-primary/15 text-pb-primary text-[11px] font-semibold px-2 py-0.5">твоя</span>
        )}
      </div>
      <div className="text-sm mt-2 text-white/90">
        {team.nextEvent ? `Ближайшее: ${team.nextEvent.title}, ${dateTimeLabel(team.nextEvent.startAt).toLowerCase()}` : 'Ближайших событий нет'}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-pb-subtext mt-1">
        <span>Последнее действие: {sinceLabel(team.lastActivityAt)}</span>
        {team.pendingJoinRequests !== null && team.pendingJoinRequests > 0 && (
          <span className="text-amber-200">
            {team.pendingJoinRequests} {plural(team.pendingJoinRequests, 'заявка', 'заявки', 'заявок')} на вступление
          </span>
        )}
      </div>
    </Link>
  </li>
);

const ConsoleHome: React.FC = () => {
  const [teams, setTeams] = React.useState<PlatformTeam[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setTeams((await platformApi.listTeams()).items);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Список команд не загрузился. Проверь связь и попробуй ещё раз.'));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const needle = query.trim().toLowerCase();
  const visible = (teams ?? []).filter(
    (t) => !needle || t.name.toLowerCase().includes(needle) || t.shortCode.toLowerCase().includes(needle),
  );

  return (
    <Page>
      <TopBar title="Консоль" />

      <CreationRequests onChanged={() => void load()} />

      {creating ? (
        <CreateTeamForm onClose={() => setCreating(false)} />
      ) : null}

      <section className="mb-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-lg font-bold">
            Команды{teams ? <span className="text-pb-subtext font-normal"> · {teams.length}</span> : null}
          </h2>
          {!creating && (
            <button type="button" onClick={() => setCreating(true)} className={`${secondaryBtn} py-2`}>
              <Plus size={16} />
              Создать
            </button>
          )}
        </div>
        <label className="relative block mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pb-subtext" />
          <input
            className={`${input} pl-9`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти команду"
            type="search"
          />
        </label>
        {error && <div className="rounded-2xl border border-pb-danger/30 bg-pb-danger/10 px-4 py-3 text-sm">{error}</div>}
        {!error && teams === null && <ContentLoader />}
        {teams !== null && visible.length === 0 && (
          <p className="text-pb-subtext text-sm">{needle ? 'Ничего не нашлось.' : 'Команд пока нет.'}</p>
        )}
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((team) => (
            <TeamRow key={team.id} team={team} />
          ))}
        </ul>
      </section>

      <section className={`${card} p-4 text-sm text-white/90 space-y-2`}>
        <h2 className="text-base font-bold text-white">Как помочь команде</h2>
        <p>
          Открой команду и нажми «Открыть как капитан» — попадёшь в её приложение с правами капитана: события,
          состав, приглашения, деньги, рефлексия. В составе ты не числишься и напоминаний команды не получаешь.
        </p>
        <p>Каждое твоё действие капитан видит в журнале команды с пометкой «владелец платформы».</p>
        <p>Если у команды нет капитана — выпусти ему именную ссылку: «Пригласить капитана».</p>
      </section>
    </Page>
  );
};

// --- Карточка команды --------------------------------------------------------

const CaptainInvite: React.FC<{ team: PlatformTeam }> = ({ team }) => {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [link, setLink] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) {
      notify.error('Напиши, для кого ссылка.');
      return;
    }
    setSaving(true);
    try {
      const res = await platformApi.inviteCaptain(team.id, note.trim());
      setLink(buildInviteLink(window.location.origin, res.token));
    } catch (error) {
      notify.error(errorText(error, 'Ссылка не выпустилась. Попробуй ещё раз.'));
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notify.success('Ссылка скопирована');
    } catch {
      notify.error('Не получилось скопировать. Выдели ссылку и скопируй вручную.');
    }
  };

  const share = async () => {
    if (!link) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Капитан команды «${team.name}»`, url: link });
      } catch {
        // человек закрыл окно «Поделиться»
      }
    } else {
      await copy();
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${secondaryBtn} py-3 w-full`}>
        <UserPlus size={18} />
        Пригласить капитана
      </button>
    );
  }

  return (
    <div className={`${card} p-4 space-y-3`}>
      <h3 className="font-bold">Ссылка для капитана</h3>
      {link ? (
        <>
          <p className="text-sm text-pb-subtext">
            Одноразовая: по ней войдёт один человек и станет капитаном команды «{team.name}».
          </p>
          <div className="rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm break-all select-all">{link}</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void copy()} className={`${secondaryBtn} flex-1 py-2.5`}>
              <Copy size={16} />
              Скопировать
            </button>
            <button type="button" onClick={() => void share()} className={`${primaryBtn} flex-1 py-2.5`}>
              <Share2 size={16} />
              Поделиться
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={create} className="space-y-3">
          <label className="block">
            <span className="text-sm text-pb-subtext">Для кого ссылка</span>
            <input className={`${input} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Имя капитана" autoFocus />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className={`${secondaryBtn} flex-1 py-2.5`}>
              Отмена
            </button>
            <button type="submit" disabled={saving} className={`${primaryBtn} flex-1 py-2.5`}>
              {saving ? 'Выпускаю…' : 'Выпустить ссылку'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

const TeamCardView: React.FC = () => {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = React.useState<PlatformTeamCard | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    platformApi
      .getTeam(code)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as { status?: number })?.status === 404 ? 'Такой команды нет.' : errorText(err, 'Команда не загрузилась.'));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const team = data?.team;
  const teamCode = (team?.shortCode || code).toLowerCase();

  return (
    <Page>
      <TopBar title={team?.name ?? 'Команда'} back={{ to: '/admin', label: 'Все команды' }} />
      {error && <div className="rounded-2xl border border-pb-danger/30 bg-pb-danger/10 px-4 py-3 text-sm">{error}</div>}
      {!error && !data && <ContentLoader />}
      {team && data && (
        <div className="space-y-5">
          <section className={`${card} p-4 grid grid-cols-2 gap-3 text-sm`}>
            <div>
              <div className="text-pb-subtext text-xs">Участников</div>
              <div className="font-bold text-lg">{team.membersCount}</div>
            </div>
            <div>
              <div className="text-pb-subtext text-xs">Заявок на вступление</div>
              <div className="font-bold text-lg">{team.pendingJoinRequests ?? '—'}</div>
            </div>
            <div>
              <div className="text-pb-subtext text-xs">Ближайшее событие</div>
              <div className="font-semibold">{team.nextEvent ? dateTimeLabel(team.nextEvent.startAt) : 'Нет'}</div>
            </div>
            <div>
              <div className="text-pb-subtext text-xs">Последнее действие</div>
              <div className="font-semibold">{sinceLabel(team.lastActivityAt)}</div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-2">
            <button type="button" onClick={() => navigate(teamPath(teamCode))} className={`${primaryBtn} py-3 w-full`}>
              {team.isMine ? 'Открыть команду' : 'Открыть как капитан'}
              <ArrowRight size={18} />
            </button>
            <CaptainInvite team={team} />
          </section>
          {!team.isMine && (
            <p className="text-pb-subtext text-xs -mt-2">
              В команде ты не числишься и её напоминаний не получаешь; твои действия капитан видит в журнале.
            </p>
          )}

          <section>
            <h2 className="text-lg font-bold mb-2">Ближайшие события</h2>
            {data.upcomingEvents.length === 0 ? (
              <p className="text-pb-subtext text-sm">Событий нет. Капитан заводит их сам — или ты, открыв команду.</p>
            ) : (
              <ul className={`${card} divide-y divide-white/5`}>
                {data.upcomingEvents.map((event) => (
                  <li key={event.id}>
                    <Link to={eventPath(teamCode, event.id)} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/5">
                      <span className="font-semibold text-sm truncate">{event.title}</span>
                      <span className="text-pb-subtext text-xs shrink-0">{dateTimeLabel(event.startAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-lg font-bold mb-2">Состав</h2>
            {data.members.length === 0 ? (
              <p className="text-pb-subtext text-sm">В команде пока никого. Пригласи капитана — он позовёт остальных.</p>
            ) : (
              <ul className={`${card} divide-y divide-white/5`}>
                {data.members.map((member) => (
                  <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{member.name}</div>
                      <div className="text-pb-subtext text-xs">{playerStatusLabel(member.status)}</div>
                    </div>
                    <span className="text-xs text-pb-subtext shrink-0">{roleLabel(member.role)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Page>
  );
};

// --- Вход в консоль ----------------------------------------------------------

const NotOwner: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Page>
      <div className="pt-16 text-center">
        <h1 className="text-2xl font-bold mb-2">Консоль — для владельца платформы</h1>
        <p className="text-pb-subtext mb-6">Командой управляют в самом приложении: события, состав и казна — там.</p>
        <button type="button" onClick={() => navigate('/app')} className={`${primaryBtn} py-3`}>
          В приложение
        </button>
      </div>
    </Page>
  );
};

const ConsoleRoutes: React.FC = () => {
  const shell = useShell();
  if (!shell.canEnterAdmin) return <NotOwner />;
  return (
    <Routes>
      <Route index element={<ConsoleHome />} />
      <Route path="teams/:code" element={<TeamCardView />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
};

export const OwnerConsoleView: React.FC = () => (
  <RequireAuth>
    <ConsoleRoutes />
  </RequireAuth>
);
