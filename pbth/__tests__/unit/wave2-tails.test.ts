import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SlotOffer } from '../../api/track4';
import { EventCard } from '../../components/EventCard';
import { joinLinkHint } from '../../lib/team-roster';
import { GuestBookingCards } from '../../components/track4/GuestBookingCards';
import { upcomingGuestBookings } from '../../components/track4/slot-format';
import { buildDashboardEventSections, captainHomeHints, countdownLabels, showUpcomingSection } from '../../lib/events';
import { isExpectedInitState } from '../../lib/init-state';
import { runOptimistic } from '../../lib/optimistic';
import { countLabel, pluralRu } from '../../lib/plural';
import { answerAndRefresh, applyRsvpToAttendees, applyRsvpToEvent, canAnswerRsvp, createLatestOnly } from '../../lib/rsvp';
import { teamLinkAccess } from '../../lib/team-link-access';
import { Dashboard } from '../../views/Dashboard';
import { TeamView } from '../../views/TeamView';
import { EventType, PlayerStatus, Role, RSVPStatus, type Event, type TeamMember } from '../../types';

// Хвосты второй волны ревизии PBTH (11.11.2026): явка на экране события,
// владелец в чужой команде, ссылка команды у тренера, склонения, главная
// капитана новой команды, записи гостем.

const NOW = Date.parse('2026-11-11T10:00:00.000Z');

const ev = (id: string, patch: Partial<Event> = {}): Event => ({
  id,
  teamId: 't1',
  type: EventType.TRAINING,
  title: `Событие ${id}`,
  startDate: new Date(NOW + 86_400_000),
  endDate: new Date(NOW + 86_400_000 + 7_200_000),
  rsvpStatus: RSVPStatus.UNANSWERED,
  attendeesCount: 0,
  ...patch,
});

type Row = { userId: string; rsvpStatus: string; name: string };
const rows = (): Row[] => [
  { userId: 'me', rsvpStatus: 'CONFIRMED', name: 'Я' },
  { userId: 'other', rsvpStatus: 'UNANSWERED', name: 'Другой' },
];

describe('1. экран события: свой ответ сразу в списке явки', () => {
  it('меняется только своя строка, счётчик идущих — на единицу', () => {
    const next = applyRsvpToAttendees(rows(), 'me', RSVPStatus.DECLINED);
    expect(next.map((r) => r.rsvpStatus)).toEqual(['DECLINED', 'UNANSWERED']);
    expect(applyRsvpToEvent(ev('a', { rsvpStatus: RSVPStatus.CONFIRMED, attendeesCount: 3 }), RSVPStatus.DECLINED).attendeesCount).toBe(2);
    expect(applyRsvpToEvent(ev('a', { rsvpStatus: RSVPStatus.DECLINED, attendeesCount: 3 }), RSVPStatus.CONFIRMED).attendeesCount).toBe(4);
    // Повторное «Иду» не прибавляет второго идущего.
    expect(applyRsvpToEvent(ev('a', { rsvpStatus: RSVPStatus.CONFIRMED, attendeesCount: 3 }), RSVPStatus.CONFIRMED).attendeesCount).toBe(3);
  });

  it('после ответа список перечитывается с сервера, а раннее чтение его не затирает', async () => {
    const latest = createLatestOnly();
    let list = rows();
    const commit = (next: Row[]) => {
      list = next;
    };
    // Чтение при открытии экрана ещё идёт и вернёт старое «Иду».
    const staleToken = latest.next();
    let finishSend: (ok: boolean) => void = () => {};
    const sent = new Promise<boolean>((resolve) => {
      finishSend = resolve;
    });
    const load = vi.fn(async () => [
      { userId: 'me', rsvpStatus: 'DECLINED', name: 'Я' },
      { userId: 'other', rsvpStatus: 'CONFIRMED', name: 'Другой' },
    ]);
    const flow = answerAndRefresh({
      latest,
      applyLocal: () => commit(applyRsvpToAttendees(list, 'me', RSVPStatus.DECLINED)),
      send: () => sent,
      load,
      commit,
    });
    // Локально — сразу.
    expect(list[0].rsvpStatus).toBe('DECLINED');
    // Старое чтение пришло позже — не применяется.
    if (latest.isLatest(staleToken)) commit(rows());
    expect(list[0].rsvpStatus).toBe('DECLINED');
    // С сервера перечитывается только после завершения запроса.
    expect(load).not.toHaveBeenCalled();
    finishSend(true);
    await flow;
    expect(load).toHaveBeenCalledTimes(1);
    expect(list.map((r) => r.rsvpStatus)).toEqual(['DECLINED', 'CONFIRMED']);
  });

  it('нет сети на перечитывании — остаётся локальный ответ', async () => {
    const latest = createLatestOnly();
    let list = rows();
    await answerAndRefresh({
      latest,
      applyLocal: () => {
        list = applyRsvpToAttendees(list, 'me', RSVPStatus.PENDING);
      },
      send: async () => true,
      load: async () => {
        throw new Error('offline');
      },
      commit: (next: Row[]) => {
        list = next;
      },
    });
    expect(list[0].rsvpStatus).toBe('PENDING');
  });
});

describe('2. владелец платформы в чужой команде: своего ответа на явку нет', () => {
  const foreign = ev('foreign', { viewerInRoster: false });

  it('по флагу сервера; старый ответ без флага — как раньше', () => {
    expect(canAnswerRsvp(foreign)).toBe(false);
    expect(canAnswerRsvp(ev('own', { viewerInRoster: true }))).toBe(true);
    expect(canAnswerRsvp(ev('legacy'))).toBe(true);
  });

  it('на главной события чужой команды не «требуют ответа»', () => {
    const sections = buildDashboardEventSections(
      [ev('hero', { viewerInRoster: false }), ev('next', { viewerInRoster: false, startDate: new Date(NOW + 2 * 86_400_000) })],
      NOW,
    );
    expect(sections.heroEventNeedsResponse).toBe(false);
    expect(sections.pendingEvents).toEqual([]);
    expect(sections.upcomingEvents.map((e) => e.id)).toEqual(['next']);
  });

  it('в карточке события нет кнопок «Иду / Не иду»', () => {
    const html = renderToStaticMarkup(React.createElement(EventCard, { event: foreign, onRsvp: () => {} }));
    expect(html).not.toContain('Не иду');
    const own = renderToStaticMarkup(React.createElement(EventCard, { event: ev('own'), onRsvp: () => {} }));
    expect(own).toContain('Не иду');
  });

  it('ошибка ответа не вылетает наружу: откат и сообщение', async () => {
    let status = RSVPStatus.UNANSWERED;
    const onError = vi.fn();
    const result = await runOptimistic({
      apply: () => {
        status = RSVPStatus.CONFIRMED;
      },
      send: async () => {
        throw new Error('EVENT_NOT_FOUND');
      },
      rollback: () => {
        status = RSVPStatus.UNANSWERED;
      },
      onError,
    });
    expect(result.ok).toBe(false);
    expect(status).toBe(RSVPStatus.UNANSWERED);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

const member = (id: string, role: Role): TeamMember => ({
  id,
  name: `Игрок ${id}`,
  nickname: `p${id}`,
  role,
  status: PlayerStatus.ACTIVE,
});

const renderTeam = (role: Role, count = 1) =>
  renderToStaticMarkup(
    React.createElement(TeamView, {
      team: { id: 't1', name: 'Дозор', shortCode: 'DZ', role, budget: 0 },
      members: Array.from({ length: count }, (_, i) => member(String(i), i === 0 ? Role.CAPTAIN : Role.PLAYER)),
      currentUserRole: role,
      onMemberClick: () => {},
      onUpdateMemberStatus: () => {},
      onRemoveMember: () => {},
    }),
  );

describe('7. ссылка команды у тренера', () => {
  it('тренер видит «Ссылку команды», но не отзывает её', () => {
    expect(teamLinkAccess(Role.TRAINER)).toEqual({ canShare: true, canRotate: false });
    expect(teamLinkAccess(Role.CAPTAIN)).toEqual({ canShare: true, canRotate: true });
    expect(teamLinkAccess(Role.ADMIN)).toEqual({ canShare: true, canRotate: true });
    expect(teamLinkAccess(Role.PLAYER)).toEqual({ canShare: false, canRotate: false });
    expect(renderTeam(Role.TRAINER)).toContain('Ссылка команды');
    expect(renderTeam(Role.CAPTAIN)).toContain('Ссылка команды');
    expect(renderTeam(Role.PLAYER)).not.toContain('Ссылка команды');
  });

  it('подпись шторки — от лица того, кто её открыл', () => {
    expect(joinLinkHint(false)).toContain('принимаешь ты или капитан');
    expect(joinLinkHint(true)).toContain('принимаешь ты или тренер');
  });
});

describe('9. человек без команды — штатное состояние, не ошибка', () => {
  it('INIT_NO_TEAM в консоль ошибкой не идёт', () => {
    expect(isExpectedInitState(new Error('INIT_NO_TEAM'))).toBe(true);
    expect(isExpectedInitState(new Error('INIT_INVALID_SHAPE'))).toBe(false);
    expect(isExpectedInitState('boom')).toBe(false);
  });
});

describe('10. запись в кассе: сервер отказал — запись убирается', () => {
  it('откат и сообщение', async () => {
    let list = ['old'];
    const onError = vi.fn();
    await runOptimistic({
      apply: () => {
        list = ['new', ...list];
      },
      send: async () => {
        throw new Error('Нет прав');
      },
      rollback: () => {
        list = list.filter((item) => item !== 'new');
      },
      onError,
    });
    expect(list).toEqual(['old']);
    expect(onError).toHaveBeenCalledWith(new Error('Нет прав'));
  });
});

describe('11. склонения', () => {
  it('один помощник: участник, день, час', () => {
    expect([1, 2, 5, 11, 21, 22, 0].map((n) => countLabel(n, 'участник', 'участника', 'участников'))).toEqual([
      '1 участник',
      '2 участника',
      '5 участников',
      '11 участников',
      '21 участник',
      '22 участника',
      '0 участников',
    ]);
    expect(pluralRu(111, 'день', 'дня', 'дней')).toBe('дней');
  });

  it('шапка состава', () => {
    expect(renderTeam(Role.CAPTAIN, 1)).toContain('1 игрок · ты капитан<');
    expect(renderTeam(Role.CAPTAIN, 2)).toContain('2 игрока · ты капитан<');
    expect(renderTeam(Role.CAPTAIN, 5)).toContain('5 игроков · ты капитан<');
  });

  it('таймер ближайшего события: день, дня, дней; час, часа, часов', () => {
    expect(countdownLabels({ days: '01', hours: '01', mins: '01' })).toEqual({ days: 'день', hours: 'час', mins: 'мин' });
    expect(countdownLabels({ days: '02', hours: '03', mins: '05' })).toEqual({ days: 'дня', hours: 'часа', mins: 'мин' });
    expect(countdownLabels({ days: '11', hours: '21', mins: '00' })).toEqual({ days: 'дней', hours: 'час', mins: 'мин' });
    expect(countdownLabels({ days: '00', hours: '05', mins: '00' })).toEqual({ days: 'дней', hours: 'часов', mins: 'мин' });
  });
});

const renderHome = (props: Partial<React.ComponentProps<typeof Dashboard>> = {}) =>
  renderToStaticMarkup(
    React.createElement(Dashboard, {
      teams: [],
      events: [],
      onRsvp: () => {},
      onEventClick: () => {},
      onEventLongPress: () => {},
      onCommitSeries: () => {},
      ...props,
    }),
  );

describe('12. главная капитана новой команды', () => {
  it('подсказки только капитану, пока условие не выполнено', () => {
    expect(captainHomeHints({ role: Role.CAPTAIN, membersCount: 1, teamEventsCount: 0 })).toEqual({
      inviteTeam: true,
      createFirstEvent: true,
    });
    expect(captainHomeHints({ role: Role.ADMIN, membersCount: 3, teamEventsCount: 0 })).toEqual({
      inviteTeam: false,
      createFirstEvent: true,
    });
    expect(captainHomeHints({ role: Role.CAPTAIN, membersCount: 4, teamEventsCount: 2 })).toEqual({
      inviteTeam: false,
      createFirstEvent: false,
    });
    expect(captainHomeHints({ role: Role.TRAINER, membersCount: 1, teamEventsCount: 0 })).toEqual({
      inviteTeam: false,
      createFirstEvent: false,
    });
    expect(captainHomeHints({ role: Role.PLAYER, membersCount: 1, teamEventsCount: 0 })).toEqual({
      inviteTeam: false,
      createFirstEvent: false,
    });
  });

  it('на главной — «Позови команду» и «Создай первое событие»', () => {
    const html = renderHome({ captainHints: { inviteTeam: true, createFirstEvent: true }, onInviteTeam: () => {}, onCreateEvent: () => {} });
    expect(html).toContain('Позови команду');
    expect(html).toContain('Создай первое событие');
    // Подсказка «Создай первое событие» заменяет пустое «Ближайшие — Событий нет».
    expect(html).not.toContain('Событий нет');
    const none = renderHome({ captainHints: { inviteTeam: false, createFirstEvent: false } });
    expect(none).not.toContain('Позови команду');
    expect(none).not.toContain('Создай первое событие');
  });
});

describe('13. «Ближайшие» без противоречия', () => {
  it('единственное событие уже наверху — блока «Ближайшие» нет', () => {
    const sections = buildDashboardEventSections([ev('only', { rsvpStatus: RSVPStatus.CONFIRMED })], NOW);
    expect(showUpcomingSection(sections)).toBe(false);
    const html = renderHome({ events: [ev('only', { rsvpStatus: RSVPStatus.CONFIRMED })] });
    expect(html).not.toContain('Ближайшие');
    expect(html).not.toContain('Событий нет');
  });

  it('событий нет совсем — «Событий нет»; есть другие — «Ближайшие» со списком', () => {
    expect(renderHome()).toContain('Событий нет');
    const two = [
      ev('a', { rsvpStatus: RSVPStatus.CONFIRMED }),
      ev('b', { rsvpStatus: RSVPStatus.CONFIRMED, startDate: new Date(NOW + 3 * 86_400_000) }),
    ];
    expect(showUpcomingSection(buildDashboardEventSections(two, NOW))).toBe(true);
    expect(renderHome({ events: two })).toContain('Ближайшие');
  });
});

const booking = (patch: Partial<SlotOffer> = {}): SlotOffer => ({
  eventId: 'e1',
  teamId: 'other',
  teamName: 'Holy Guns',
  timezone: 'Europe/Moscow',
  title: 'Тренировка',
  type: 'TRAINING',
  startAt: '2026-11-18T17:30:00.000Z',
  endAt: '2026-11-18T19:30:00.000Z',
  location: 'Точка',
  price: 3000,
  capacity: 2,
  free: 1,
  open: true,
  booked: true,
  myBooking: { paid: false, price: 3000 },
  ...patch,
});

describe('14. записи гостем видны на главной и в профиле', () => {
  it('будущие записи — карточкой «Ты записан гостем»', () => {
    const past = booking({ eventId: 'old', startAt: '2026-11-01T17:30:00.000Z', endAt: '2026-11-01T19:30:00.000Z' });
    expect(upcomingGuestBookings([past, booking()], NOW).map((b) => b.eventId)).toEqual(['e1']);
    const html = renderToStaticMarkup(React.createElement(GuestBookingCards, { bookings: [booking()], onOpen: () => {} }));
    expect(html).toContain('Ты записан гостем: Holy Guns · Тренировка · среда, 18 ноября, 20:30');
    expect(renderToStaticMarkup(React.createElement(GuestBookingCards, { bookings: [], onOpen: () => {} }))).toBe('');
  });

  it('на главной карточка стоит сверху', () => {
    const card = React.createElement('div', null, 'GUEST-CARD');
    const html = renderHome({ guestBookings: card, events: [ev('only')] });
    expect(html.indexOf('GUEST-CARD')).toBeGreaterThan(-1);
    expect(html.indexOf('GUEST-CARD')).toBeLessThan(html.indexOf('Событие only'));
  });
});
