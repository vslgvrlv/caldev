import React, { useEffect, useState } from 'react';
import { Event, RSVPStatus, EventType, Role, Game } from '../types';
import { EVENT_COLORS, EVENT_LABELS, getEventIcon } from '../constants';
import { ChevronLeft, MapPin, Clock, Users, DollarSign, Check, X, HelpCircle, Swords, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { api } from '../api';

interface EventDetailAttendee {
  userId: string;
  name: string;
  nickname: string;
  avatar?: string;
  role: 'CAPTAIN' | 'TRAINER' | 'PLAYER';
  memberStatus: 'ACTIVE' | 'INJURED' | 'RESERVE' | 'VACATION';
  rsvpStatus: 'UNANSWERED' | 'PENDING' | 'CONFIRMED' | 'DECLINED';
}

interface EventDetailViewProps {
  event: Event;
  currentUserRole: Role;
  onBack: () => void;
  onRsvp: (id: string, status: RSVPStatus) => void;
  onAddGame: (eventId: string, game: Omit<Game, 'id'>) => void;
  onUpdateGame: (eventId: string, gameId: string, game: Omit<Game, 'id'>) => Promise<void> | void;
  onSendEventReminder: (payload: {
    eventId: string;
    audience: 'ALL' | 'RESPONDED' | 'UNANSWERED' | 'CONFIRMED' | 'PENDING' | 'DECLINED';
    template: 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP';
    gameId?: string;
  }) => Promise<void>;
  onAttendeeClick: (
    userId: string,
    seed?: { name: string; nickname: string; avatar?: string; role?: 'CAPTAIN' | 'TRAINER' | 'PLAYER' }
  ) => void;
}

const PIT_ZONE_LABELS: Record<'NEAR' | 'FAR', string> = {
  NEAR: 'Ближняя пит-зона',
  FAR: 'Дальняя пит-зона',
};

const PIT_ZONE_BADGE: Record<'NEAR' | 'FAR', string> = {
  NEAR: 'Ближняя',
  FAR: 'Дальняя',
};

const GAME_PAIR_LABELS: Record<'FIRST' | 'SECOND', string> = {
  FIRST: 'Первая пара',
  SECOND: 'Вторая пара',
};

export const EventDetailView: React.FC<EventDetailViewProps> = ({
  event,
  currentUserRole,
  onBack,
  onRsvp,
  onAddGame,
  onUpdateGame,
  onSendEventReminder,
  onAttendeeClick,
}) => {
  const Icon = getEventIcon(event.type);
  const color = EVENT_COLORS[event.type];

  const [isAddingGame, setIsAddingGame] = useState(false);
  const [newGameTime, setNewGameTime] = useState('');
  const [newGameOpponent, setNewGameOpponent] = useState('');
  const [newGamePitZone, setNewGamePitZone] = useState<'NEAR' | 'FAR'>('NEAR');
  const [newGamePair, setNewGamePair] = useState<'FIRST' | 'SECOND'>('FIRST');

  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editGameTime, setEditGameTime] = useState('');
  const [editGameOpponent, setEditGameOpponent] = useState('');
  const [editGameScore, setEditGameScore] = useState('');
  const [editGamePitZone, setEditGamePitZone] = useState<'NEAR' | 'FAR'>('NEAR');
  const [editGamePair, setEditGamePair] = useState<'FIRST' | 'SECOND'>('FIRST');
  const [isSavingGame, setIsSavingGame] = useState(false);
  const [isRemindingUnanswered, setIsRemindingUnanswered] = useState(false);
  const [reminderAudience, setReminderAudience] = useState<'ALL' | 'RESPONDED' | 'UNANSWERED' | 'CONFIRMED' | 'PENDING' | 'DECLINED'>('UNANSWERED');
  const [reminderTemplate, setReminderTemplate] = useState<'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP'>('EVENT_REMINDER');
  const [reminderGameId, setReminderGameId] = useState<string>('');

  const [attendees, setAttendees] = useState<EventDetailAttendee[]>([]);
  const [isAttendeesLoading, setIsAttendeesLoading] = useState(false);

  const isAdminOrCaptain = currentUserRole === Role.ADMIN || currentUserRole === Role.CAPTAIN;
  const canSendEventReminder = currentUserRole !== Role.PLAYER;
  const isTournament = event.type === EventType.TOURNAMENT || event.type === EventType.CHAMPIONSHIP;
  const isGameReminderTemplate = reminderTemplate === 'GAME_GATHERING' || reminderTemplate === 'GAME_WARMUP';

  useEffect(() => {
    let cancelled = false;

    const loadAttendees = async () => {
      setIsAttendeesLoading(true);
      try {
        const response = await api.getEventAttendees(event.id);
        if (cancelled) return;
        setAttendees(response.attendees.filter((item) => item.rsvpStatus === 'CONFIRMED'));
      } catch (error) {
        if (cancelled) return;
        const fallback = (event.attendeePreview || []).map((item) => ({
          userId: item.userId,
          name: item.name,
          nickname: item.nickname,
          avatar: item.avatar,
          role: 'PLAYER' as const,
          memberStatus: 'ACTIVE' as const,
          rsvpStatus: 'CONFIRMED' as const,
        }));
        setAttendees(fallback);
      } finally {
        if (!cancelled) setIsAttendeesLoading(false);
      }
    };

    loadAttendees();
    return () => {
      cancelled = true;
    };
  }, [event.id, event.attendeePreview]);

  const confirmedAttendees = attendees;
  const trainerAttendees = confirmedAttendees.filter((item) => item.role === 'TRAINER');
  const playerAttendees = confirmedAttendees.filter((item) => item.role !== 'TRAINER');
  const attendeesCount = confirmedAttendees.length || event.attendeesCount;

  const handleStatusChange = (status: RSVPStatus) => {
    onRsvp(event.id, status);
  };

  const handleSendReminder = async () => {
    if (isGameReminderTemplate && !reminderGameId) {
      alert('Для игрового напоминания выберите игру из расписания.');
      return;
    }
    setIsRemindingUnanswered(true);
    try {
      await onSendEventReminder({
        eventId: event.id,
        audience: reminderAudience,
        template: reminderTemplate,
        gameId: isGameReminderTemplate ? reminderGameId : undefined,
      });
    } finally {
      setIsRemindingUnanswered(false);
    }
  };

  const handleAddGameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newGameTime && newGameOpponent) {
      onAddGame(event.id, {
        time: newGameTime,
        opponent: newGameOpponent.trim(),
        pitZone: newGamePitZone,
        gamePair: newGamePair,
      });
      setNewGameTime('');
      setNewGameOpponent('');
      setNewGamePitZone('NEAR');
      setNewGamePair('FIRST');
      setIsAddingGame(false);
    }
  };

  const normalizeTimeForInput = (time: string) => {
    const match = String(time).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  };

  const openGameCard = (game: Game) => {
    setEditingGame(game);
    setEditGameTime(normalizeTimeForInput(game.time));
    setEditGameOpponent(game.opponent);
    setEditGameScore(game.score || '');
    setEditGamePitZone(game.pitZone || 'NEAR');
    setEditGamePair(game.gamePair || 'FIRST');
  };

  const handleUpdateGameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGame || !editGameTime || !editGameOpponent) return;
    try {
      setIsSavingGame(true);
      await onUpdateGame(event.id, editingGame.id, {
        time: editGameTime,
        opponent: editGameOpponent.trim(),
        score: editGameScore.trim() || undefined,
        pitZone: editGamePitZone,
        gamePair: editGamePair,
      });
      setEditingGame(null);
    } finally {
      setIsSavingGame(false);
    }
  };

  const sortedSchedule = [...(event.schedule || [])].sort((a, b) => a.time.localeCompare(b.time));

  useEffect(() => {
    if (!isGameReminderTemplate) return;
    if (sortedSchedule.length === 0) {
      setReminderGameId('');
      return;
    }
    if (!reminderGameId || !sortedSchedule.some((game) => game.id === reminderGameId)) {
      setReminderGameId(sortedSchedule[0].id);
    }
  }, [isGameReminderTemplate, sortedSchedule, reminderGameId]);

  const renderAttendeeList = (title: string, data: EventDetailAttendee[]) => {
    if (data.length === 0) return null;
    return (
      <div className="mb-3 last:mb-0">
        <div className="text-xs text-pb-subtext uppercase tracking-wider font-bold mb-2">{title}</div>
        <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
          {data.map((attendee) => (
            <button
              key={attendee.userId}
              type="button"
              onClick={() =>
                onAttendeeClick(attendee.userId, {
                  name: attendee.name,
                  nickname: attendee.nickname,
                  avatar: attendee.avatar,
                  role: attendee.role,
                })
              }
              className="w-full bg-white/5 hover:bg-white/10 border border-white/5 hover:border-pb-primary/40 rounded-xl px-3 py-2 flex items-center gap-3 text-left transition-colors"
            >
              <img
                src={attendee.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(attendee.name)}&background=0F0F0F&color=fff`}
                alt={attendee.name}
                className="w-8 h-8 rounded-full object-cover"
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{attendee.name}</div>
                <div className="text-xs text-pb-primary truncate">@{attendee.nickname}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-pb-background flex flex-col pb-safe animate-fade-in relative z-50">
      <div className="sticky top-0 z-10 bg-pb-background/80 backdrop-blur-md px-4 py-3 flex items-center border-b border-white/5">
        <button onClick={onBack} className="p-2 -ml-2 text-white hover:bg-white/10 rounded-full">
          <ChevronLeft size={24} />
        </button>
        <span className="ml-2 font-bold text-lg text-white">Событие</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="h-32 relative overflow-hidden flex items-end p-6" style={{ backgroundColor: `${color}20` }}>
          <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: color }}></div>
          <Icon size={120} className="absolute -right-6 -top-6 opacity-10" color={color} />

          <span
            className="inline-block px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-black/40 backdrop-blur-md text-white border border-white/10 shadow-lg"
            style={{ borderColor: `${color}50`, color: color }}
          >
            {EVENT_LABELS[event.type]}
          </span>
        </div>

        <div className="px-6 py-6 space-y-6">
          <div>
            <h1 className="text-2xl font-black text-white leading-tight mb-2">{event.title}</h1>
            <div className="flex items-center text-pb-subtext">
              <Clock size={16} className="mr-2 text-pb-primary" />
              <span className="text-lg">{format(event.startDate, 'd MMMM yyyy, HH:mm', { locale: ru })}</span>
            </div>
            {event.teamTimezone && (
              <div className="mt-2 inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-pb-subtext">
                TZ команды: {event.teamTimezone}
              </div>
            )}
          </div>

          {event.description && (
            <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
              <p className="text-gray-300 leading-relaxed text-sm whitespace-pre-wrap">{event.description}</p>
            </div>
          )}

          {isTournament && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <div className="flex items-center text-white font-bold uppercase text-sm tracking-wider">
                  <Swords size={16} className="mr-2 text-pb-primary" /> Расписание игр
                </div>
                {isAdminOrCaptain && (
                  <button
                    onClick={() => setIsAddingGame(true)}
                    className="text-xs bg-white/10 hover:bg-white/20 text-pb-primary px-3 py-1.5 rounded-lg transition-colors flex items-center"
                  >
                    <Plus size={12} className="mr-1" /> Добавить
                  </button>
                )}
              </div>

              <div className="bg-pb-surface rounded-2xl p-4 border border-white/5 relative overflow-hidden">
                <div className="absolute top-4 bottom-4 left-[5.5rem] w-px bg-white/10"></div>

                <div className="space-y-6 relative">
                  {sortedSchedule.length === 0 && (
                    <div className="text-center py-4 text-pb-subtext text-sm italic">Расписание пока не добавлено</div>
                  )}

                  {sortedSchedule.map((game) => (
                    <button
                      key={game.id}
                      type="button"
                      onClick={() => openGameCard(game)}
                      className="w-full flex items-center relative z-0 group text-left"
                    >
                      <div className="w-16 font-mono font-bold text-pb-primary text-lg text-right pr-4 shrink-0">{game.time}</div>

                      <div className="w-2.5 h-2.5 rounded-full bg-pb-background border-2 border-pb-primary shrink-0 mr-4 z-10 shadow-[0_0_10px_rgba(0,230,118,0.5)]"></div>

                      <div className="flex-1 bg-white/5 p-3 rounded-xl border border-white/5 group-hover:border-pb-primary/40 transition-colors flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-white text-sm truncate">{game.opponent}</div>
                          <div className="text-xs text-pb-subtext mt-1">
                            {game.gamePair ? GAME_PAIR_LABELS[game.gamePair] : 'Пара не указана'}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          {game.pitZone && (
                            <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-white/10 text-pb-subtext" title={PIT_ZONE_LABELS[game.pitZone]}>
                              {PIT_ZONE_BADGE[game.pitZone]} пит-зона
                            </span>
                          )}
                          {game.score && <span className="text-pb-warning font-mono font-bold">{game.score}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
              <div className="flex items-center text-pb-subtext mb-1">
                <MapPin size={14} className="mr-1.5" /> Место
              </div>
              <div className="font-semibold text-white">{event.location || 'Не указано'}</div>
            </div>

            <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
              <div className="flex items-center text-pb-subtext mb-1">
                <DollarSign size={14} className="mr-1.5" /> Стоимость
              </div>
              <div className="font-semibold text-white">{event.cost ? `${event.cost} ₽` : 'Бесплатно'}</div>
            </div>
          </div>

          <div className="bg-pb-surface rounded-2xl p-4 border border-white/5">
            <div className="mb-4 space-y-3">
              <div className="flex justify-between items-center gap-3">
                <div className="flex items-center text-white font-bold min-w-0">
                  <Users size={18} className="mr-2 text-pb-primary" />
                  Участники ({attendeesCount})
                </div>
                {event.maxAttendees && <span className="text-xs text-pb-subtext shrink-0">из {event.maxAttendees}</span>}
              </div>
              {canSendEventReminder && (
                <div className="bg-black/20 border border-white/10 rounded-xl p-3 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={reminderAudience}
                      onChange={(e) => setReminderAudience(e.target.value as typeof reminderAudience)}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white focus:border-pb-primary focus:outline-none"
                    >
                      <option value="ALL">Напомнить всем</option>
                      <option value="RESPONDED">Напомнить ответившим</option>
                      <option value="UNANSWERED">Напомнить неответившим</option>
                      <option value="CONFIRMED">Только подтвердившим</option>
                      <option value="PENDING">Только думающим</option>
                      <option value="DECLINED">Только отказавшимся</option>
                    </select>
                    <select
                      value={reminderTemplate}
                      onChange={(e) =>
                        setReminderTemplate(
                          e.target.value as 'EVENT_REMINDER' | 'WARMUP_REMINDER' | 'ROLE_REMINDER' | 'GAME_GATHERING' | 'GAME_WARMUP'
                        )
                      }
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white focus:border-pb-primary focus:outline-none"
                    >
                      <option value="EVENT_REMINDER">Обычное напоминание</option>
                      <option value="WARMUP_REMINDER">Разминка по событию</option>
                      <option value="ROLE_REMINDER">Роли и задачи</option>
                      <option value="GAME_GATHERING">Сбор перед игрой</option>
                      <option value="GAME_WARMUP">Начало разминки (игра)</option>
                    </select>
                  </div>
                  {isGameReminderTemplate && (
                    <select
                      value={reminderGameId}
                      onChange={(e) => setReminderGameId(e.target.value)}
                      disabled={sortedSchedule.length === 0}
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-2 text-xs text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                    >
                      {sortedSchedule.length === 0 && <option value="">Нет игр в расписании</option>}
                      {sortedSchedule.map((game) => (
                        <option key={game.id} value={game.id}>
                          {`${game.time} • ${game.opponent} • ${game.pitZone ? `${PIT_ZONE_BADGE[game.pitZone]} пит` : 'пит ?'} • ${game.gamePair ? GAME_PAIR_LABELS[game.gamePair] : 'пара ?'}`}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={handleSendReminder}
                    disabled={isRemindingUnanswered || (isGameReminderTemplate && sortedSchedule.length === 0)}
                    className="w-full text-[12px] font-semibold text-pb-primary border border-pb-primary/30 rounded-lg px-2.5 py-2 hover:bg-pb-primary/10 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRemindingUnanswered ? 'Отправляем...' : 'Отправить напоминание'}
                  </button>
                </div>
              )}
            </div>

            {isAttendeesLoading && (
              <div className="text-sm text-pb-subtext py-2">Загрузка списка участников...</div>
            )}

            {!isAttendeesLoading && confirmedAttendees.length === 0 && (
              <div className="text-sm text-pb-subtext py-2">Подтвержденных участников пока нет</div>
            )}

            {!isAttendeesLoading && confirmedAttendees.length > 0 && (
              <div className="mt-1 border-t border-white/5 pt-3">
                {renderAttendeeList('Тренерский штаб', trainerAttendees)}
                {renderAttendeeList('Игроки', playerAttendees)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-pb-surface border-t border-white/5 p-4 pb-safe space-y-3 shadow-[0_-5px_20px_rgba(0,0,0,0.3)]">
        <div className="text-center text-xs text-pb-subtext mb-1 uppercase font-bold tracking-widest">Ваше решение</div>
        <div className="flex gap-2">
          <button
            onClick={() => handleStatusChange(RSVPStatus.CONFIRMED)}
            className={`flex-1 py-3 rounded-xl font-bold flex flex-col items-center justify-center transition-all ${
              event.rsvpStatus === RSVPStatus.CONFIRMED
                ? 'bg-pb-primary text-pb-background shadow-[0_0_15px_rgba(0,230,118,0.4)]'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            <Check size={20} className="mb-0.5" />
            <span className="text-xs">Иду</span>
          </button>

          <button
            onClick={() => handleStatusChange(RSVPStatus.DECLINED)}
            className={`flex-1 py-3 rounded-xl font-bold flex flex-col items-center justify-center transition-all ${
              event.rsvpStatus === RSVPStatus.DECLINED
                ? 'bg-pb-danger text-white shadow-[0_0_15px_rgba(255,23,68,0.4)]'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            <X size={20} className="mb-0.5" />
            <span className="text-xs">Не иду</span>
          </button>

          <button
            onClick={() => handleStatusChange(RSVPStatus.PENDING)}
            className={`flex-1 py-3 rounded-xl font-bold flex flex-col items-center justify-center transition-all ${
              event.rsvpStatus === RSVPStatus.PENDING
                ? 'bg-pb-warning text-white shadow-[0_0_15px_rgba(255,109,0,0.4)]'
                : 'bg-white/5 text-gray-400 hover:bg-white/10'
            }`}
          >
            <HelpCircle size={20} className="mb-0.5" />
            <span className="text-xs">Думаю</span>
          </button>
        </div>
      </div>

      {isAddingGame && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsAddingGame(false)}></div>
          <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-white mb-4">Добавить игру</h3>
            <form onSubmit={handleAddGameSubmit} className="space-y-4">
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Время начала</label>
                <input
                  type="time"
                  value={newGameTime}
                  onChange={(e) => setNewGameTime(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none [color-scheme:dark]"
                  required
                />
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Соперник</label>
                <input
                  type="text"
                  placeholder="Название команды"
                  value={newGameOpponent}
                  onChange={(e) => setNewGameOpponent(e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Пит-зона</label>
                <select
                  value={newGamePitZone}
                  onChange={(e) => setNewGamePitZone(e.target.value as 'NEAR' | 'FAR')}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                >
                  <option value="NEAR">Ближняя пит-зона</option>
                  <option value="FAR">Дальняя пит-зона</option>
                </select>
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Пара</label>
                <select
                  value={newGamePair}
                  onChange={(e) => setNewGamePair(e.target.value as 'FIRST' | 'SECOND')}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none"
                >
                  <option value="FIRST">Первая пара</option>
                  <option value="SECOND">Вторая пара</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingGame(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingGame && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setEditingGame(null)}></div>
          <div className="relative w-full max-w-sm bg-pb-surface rounded-2xl border border-white/10 shadow-2xl p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-white mb-1">Карточка игры</h3>
            <p className="text-xs text-pb-subtext mb-4">Соперник: {editingGame.opponent}</p>

            <form onSubmit={handleUpdateGameSubmit} className="space-y-4">
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Время игры</label>
                <input
                  type="time"
                  value={editGameTime}
                  onChange={(e) => setEditGameTime(e.target.value)}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60 [color-scheme:dark]"
                  required
                />
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Соперник</label>
                <input
                  type="text"
                  value={editGameOpponent}
                  onChange={(e) => setEditGameOpponent(e.target.value)}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                  required
                />
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Пит-зона</label>
                <select
                  value={editGamePitZone}
                  onChange={(e) => setEditGamePitZone(e.target.value as 'NEAR' | 'FAR')}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                >
                  <option value="NEAR">Ближняя пит-зона</option>
                  <option value="FAR">Дальняя пит-зона</option>
                </select>
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Пара</label>
                <select
                  value={editGamePair}
                  onChange={(e) => setEditGamePair(e.target.value as 'FIRST' | 'SECOND')}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                >
                  <option value="FIRST">Первая пара</option>
                  <option value="SECOND">Вторая пара</option>
                </select>
              </div>
              <div>
                <label className="text-pb-subtext text-xs uppercase font-bold mb-1 block">Счет (необязательно)</label>
                <input
                  type="text"
                  placeholder="например 4:2"
                  value={editGameScore}
                  onChange={(e) => setEditGameScore(e.target.value)}
                  disabled={!isAdminOrCaptain || isSavingGame}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-white focus:border-pb-primary focus:outline-none disabled:opacity-60"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingGame(null)}
                  className="flex-1 py-3 rounded-xl bg-white/5 text-pb-subtext hover:text-white transition-colors"
                >
                  Закрыть
                </button>
                {isAdminOrCaptain && (
                  <button
                    type="submit"
                    disabled={isSavingGame}
                    className="flex-1 py-3 rounded-xl bg-pb-primary text-pb-background font-bold hover:bg-opacity-90 transition-colors disabled:opacity-60"
                  >
                    {isSavingGame ? 'Сохранение...' : 'Сохранить'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
