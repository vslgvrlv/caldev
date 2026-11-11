// Набор сценариев для проверки приложения под одним аккаунтом («главный
// человек»). Чистая функция: по моменту запуска и id главного человека
// возвращает строки для каждой таблицы. Писать их в базу — `apply.ts`.
//
// Описание сценариев человеческим языком — docs/scenarios.md. Если меняешь
// здесь что-то заметное, поправь и документ.

import { autoReminderWindows, localParts, zonedTimeToUtc } from "../../../lib/notification-schedule.js";
import {
  SEED_MARK,
  TEAM_CODE_PREFIX,
  TEAM_NAME_SUFFIX,
  TEST_USERNAME_PREFIX,
  stableJoinCode,
  stableUuid,
  testTelegramId,
} from "./ids.js";

export type Row = Record<string, unknown>;

export type PlanInput = {
  now: Date;
  /** Главный человек: существующий пользователь, его не создаём. */
  ownerUserId: string;
};

type Role = "CAPTAIN" | "TRAINER" | "PLAYER";
type Status = "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
type Answer = "CONFIRMED" | "PENDING" | "DECLINED";
type EventType = "TRAINING" | "TOURNAMENT" | "CHAMPIONSHIP" | "FRIENDLY_MATCH" | "MEETING" | "MAINTENANCE" | "OTHER";

export type PlanTeam = {
  key: string;
  id: string;
  name: string;
  shortCode: string;
  timezone: string;
  /** Роль главного человека: CAPTAIN / TRAINER / PLAYER или чем он ещё связан с командой. */
  ownerRelation: string;
  joinCode: string;
};

export type PlanLink = { label: string; path: string };

export type ScenarioPlan = {
  /** Таблицы в порядке вставки. */
  tables: Array<{ table: string; rows: Row[] }>;
  teams: PlanTeam[];
  links: PlanLink[];
  /** Id команд набора — по ним наполнитель находит и удаляет своё. */
  teamIds: string[];
};

// --- Люди ------------------------------------------------------------------

type PersonSpec = { key: string; n: number; name: string; nick: string; photo: boolean };

const KEY_PEOPLE: PersonSpec[] = [
  { key: "sokolov", n: 1, name: "Артём Соколов", nick: "artem_sokol", photo: true },
  { key: "mironov", n: 2, name: "Олег Миронов", nick: "oleg_coach", photo: true },
  // Человек без имени в Telegram: вместо имени приходит ник.
  { key: "kirill", n: 3, name: "kirill_2007", nick: "kirill_2007", photo: false },
  { key: "kovalev", n: 4, name: "Степан Ковалёв", nick: "stepan_k", photo: true },
  { key: "belov", n: 5, name: "Игорь Белов", nick: "belov_igor", photo: false },
  { key: "laptev", n: 6, name: "Сергей Лаптев", nick: "laptev", photo: true },
  { key: "orlova", n: 7, name: "Марина Орлова", nick: "marina_orl", photo: true },
  { key: "gusev", n: 8, name: "Павел Гусев", nick: "pgusev", photo: false },
  { key: "zuev", n: 9, name: "Никита Зуев", nick: "zuev_n", photo: true },
  { key: "frolov", n: 10, name: "Роман Фролов", nick: "frolov_rom", photo: false },
  { key: "efimov", n: 11, name: "Илья Ефимов", nick: "ilya_ef", photo: true },
  { key: "chernov", n: 12, name: "Влад Чернов", nick: "vlad_ch", photo: false },
  { key: "titov", n: 13, name: "Егор Титов", nick: "egor_titov", photo: true },
  { key: "pakhomov", n: 14, name: "Максим Пахомов", nick: "max_pakh", photo: false },
  { key: "romanov", n: 15, name: "Глеб Романов", nick: "gleb_r", photo: true },
  { key: "galiev", n: 16, name: "Тимур Галиев", nick: "timur_g", photo: false },
  { key: "aksenov", n: 17, name: "Лев Аксёнов", nick: "lev_aks", photo: true },
  { key: "ershov", n: 18, name: "Ян Ершов", nick: "yan_ershov", photo: false },
  { key: "savina", n: 19, name: "Алина Савина", nick: "alina_sav", photo: true },
  { key: "vetrov", n: 20, name: "Дмитрий Ветров", nick: "d_vetrov", photo: false },
  { key: "lukin", n: 21, name: "Фёдор Лукин", nick: "lukin_f", photo: true },
  // Только имя, без фамилии.
  { key: "belka", n: 22, name: "Белка", nick: "belka_pb", photo: false },
];

const FIRST = [
  "Алексей", "Андрей", "Борис", "Вадим", "Виктор", "Георгий", "Даниил", "Евгений", "Захар", "Иван",
  "Анна", "Кирилл", "Константин", "Леонид", "Матвей", "Михаил", "Николай", "Дарья", "Пётр", "Руслан",
  "Семён", "Тарас", "Ксения", "Филипп", "Юрий", "Ярослав", "Полина", "Вера", "Арсений", "Тихон",
];
const FEMALE = new Set(["Анна", "Дарья", "Ксения", "Полина", "Вера"]);
const LAST = [
  "Абрамов", "Баранов", "Воронин", "Голубев", "Дьяков", "Ежов", "Жуков", "Зайцев", "Ильин", "Казаков",
  "Лебедев", "Мельников", "Носов", "Осипов", "Попов", "Рябов", "Семёнов", "Тихонов", "Ушаков", "Фомин",
  "Харитонов", "Цветков", "Чистяков", "Шаров", "Щукин", "Юдин", "Яковлев", "Белоусов", "Гришин", "Карпов",
];
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
function translit(value: string): string {
  return value
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("");
}
function feminine(last: string): string {
  return /(ов|ев|ёв|ин)$/.test(last) ? `${last}а` : last;
}

const GENERATED_COUNT = 87;
function generatedPerson(i: number): PersonSpec {
  const first = FIRST[(i - 1) % FIRST.length];
  const baseLast = LAST[((i - 1) * 7 + Math.floor((i - 1) / FIRST.length)) % LAST.length];
  const last = FEMALE.has(first) ? feminine(baseLast) : baseLast;
  return {
    key: `g${i}`,
    n: 100 + i,
    name: `${first} ${last}`,
    nick: `${translit(first)}_${translit(last).slice(0, 4)}${i}`,
    photo: i % 3 === 0,
  };
}

const PALETTE = ["#2f6fdf", "#d9480f", "#2b8a3e", "#ae3ec9", "#e8590c", "#1098ad", "#5c7cfa", "#c2255c", "#495057", "#f08c00"];

/** Абстрактная картинка вместо фото: цветной круг и фигура. Не похожа ни на кого. */
function avatarFor(key: string): string {
  const id = stableUuid(`avatar:${key}`).replace(/-/g, "");
  const bg = PALETTE[parseInt(id.slice(0, 2), 16) % PALETTE.length];
  const fg = PALETTE[(parseInt(id.slice(2, 4), 16) + 3) % PALETTE.length];
  const shape = parseInt(id.slice(4, 6), 16) % 3;
  const figure =
    shape === 0
      ? `<circle cx="64" cy="64" r="30" fill="${fg}"/>`
      : shape === 1
        ? `<rect x="34" y="34" width="60" height="60" rx="10" fill="${fg}" transform="rotate(20 64 64)"/>`
        : `<polygon points="64,26 102,96 26,96" fill="${fg}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="${bg}"/>${figure}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// --- Время -----------------------------------------------------------------

const MSK = "Europe/Moscow";

type DayParts = { year: number; month: number; day: number };

function addDays(day: DayParts, offset: number): DayParts {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day + offset));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function isoDate(day: DayParts): string {
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}

function isoWeekday(day: DayParts): number {
  const w = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
  return w === 0 ? 7 : w;
}

function minutes(m: number): number {
  return m * 60_000;
}

// --- Сборка ----------------------------------------------------------------

type TeamSpec = {
  key: string;
  name: string;
  timezone: string;
  ownerRelation: string;
  members: Array<{ person: string; role: Role; status?: Status }>;
};

type EventSpec = {
  key: string;
  team: string;
  type: EventType;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
  cost: number | null;
  description?: string | null;
  seriesKey?: string;
  occurrenceDate?: string;
  cancelled?: boolean;
  finance?: "NOT_CALCULATED" | "COLLECTING" | "CLOSED";
};

export function buildScenarioPlan(input: PlanInput): ScenarioPlan {
  const now = new Date(Math.floor(input.now.getTime() / 60_000) * 60_000);
  const OWNER = "owner";
  const salt = input.ownerUserId;

  const people = new Map<string, PersonSpec>();
  for (const p of KEY_PEOPLE) people.set(p.key, p);
  for (let i = 1; i <= GENERATED_COUNT; i += 1) {
    const p = generatedPerson(i);
    people.set(p.key, p);
  }
  const userId = (key: string): string => (key === OWNER ? input.ownerUserId : stableUuid(`user:${key}`));
  const nameOf = (key: string): string => (key === OWNER ? "главный человек" : people.get(key)!.name);
  const gen = (from: number, to: number) => {
    const list: string[] = [];
    for (let i = from; i <= to; i += 1) list.push(`g${i}`);
    return list;
  };

  // День по поясу команды и момент «в такой-то день в такое-то время по поясу».
  const today = (tz: string): DayParts => {
    const p = localParts(now, tz);
    return { year: p.year, month: p.month, day: p.day };
  };
  const at = (tz: string, dayOffset: number, hh: number, mm = 0): Date => {
    const d = addDays(today(tz), dayOffset);
    return zonedTimeToUtc(d.year, d.month, d.day, hh, mm, tz);
  };

  // --- Команды и состав ---
  const groza: TeamSpec = {
    key: "groza",
    name: "Гроза",
    timezone: MSK,
    ownerRelation: "капитан (второй капитан — Артём Соколов), 30 участников",
    members: [
      { person: OWNER, role: "CAPTAIN" },
      { person: "sokolov", role: "CAPTAIN" },
      { person: "mironov", role: "TRAINER" },
      { person: "kirill", role: "PLAYER" },
      ...gen(1, 26).map((person, idx) => {
        const i = idx + 1;
        const status: Status = [3, 8, 15, 21].includes(i) ? "RESERVE" : [5, 12].includes(i) ? "INJURED" : i === 18 ? "VACATION" : "ACTIVE";
        return { person, role: "PLAYER" as Role, status };
      }),
    ],
  };
  const teamsSpec: TeamSpec[] = [
    groza,
    {
      key: "veter",
      name: "Северный ветер",
      timezone: MSK,
      ownerRelation: "тренер",
      members: [
        { person: "kovalev", role: "CAPTAIN" },
        { person: OWNER, role: "TRAINER" },
        ...gen(27, 36).map((person, idx) => ({ person, role: "PLAYER" as Role, status: (idx === 4 ? "RESERVE" : "ACTIVE") as Status })),
      ],
    },
    {
      key: "kobry",
      name: "Кобры",
      timezone: MSK,
      ownerRelation: "игрок основного состава, есть долг",
      members: [
        { person: "belov", role: "CAPTAIN" },
        { person: OWNER, role: "PLAYER", status: "ACTIVE" },
        // Тренер «Грозы» — здесь обычный игрок.
        { person: "mironov", role: "PLAYER" },
        { person: "belka", role: "PLAYER" },
        ...gen(37, 44).map((person) => ({ person, role: "PLAYER" as Role })),
      ],
    },
    {
      key: "lisy",
      name: "Лисы",
      timezone: MSK,
      ownerRelation: "игрок в запасе",
      members: [
        { person: "laptev", role: "CAPTAIN" },
        { person: OWNER, role: "PLAYER", status: "RESERVE" },
        ...gen(45, 51).map((person) => ({ person, role: "PLAYER" as Role })),
      ],
    },
    {
      key: "tayfun",
      name: "Тайфун",
      timezone: "Asia/Vladivostok",
      ownerRelation: "игрок; команда живёт по времени Владивостока",
      members: [
        { person: "orlova", role: "CAPTAIN" },
        { person: OWNER, role: "PLAYER" },
        ...gen(52, 57).map((person) => ({ person, role: "PLAYER" as Role })),
      ],
    },
    {
      key: "pustosh",
      name: "Пустошь",
      timezone: MSK,
      ownerRelation: "игрок; у команды нет ни одного события и пустая казна",
      members: [
        { person: "gusev", role: "CAPTAIN" },
        { person: OWNER, role: "PLAYER" },
        ...gen(58, 60).map((person) => ({ person, role: "PLAYER" as Role })),
      ],
    },
    {
      key: "novichki",
      name: "Новички",
      timezone: MSK,
      ownerRelation: "капитан, в команде больше никого",
      members: [{ person: OWNER, role: "CAPTAIN" }],
    },
    {
      key: "metel",
      name: "Метель",
      timezone: MSK,
      ownerRelation: "игрок со статусом «Травма»",
      members: [
        { person: "vetrov", role: "CAPTAIN" },
        { person: OWNER, role: "PLAYER", status: "INJURED" },
        ...gen(61, 64).map((person) => ({ person, role: "PLAYER" as Role })),
      ],
    },
    {
      key: "shtorm",
      name: "Шторм",
      timezone: MSK,
      ownerRelation: "игрок со статусом «Отпуск»",
      members: [
        { person: "lukin", role: "CAPTAIN" },
        { person: OWNER, role: "PLAYER", status: "VACATION" },
        ...gen(65, 68).map((person) => ({ person, role: "PLAYER" as Role })),
      ],
    },
    {
      key: "sapsan",
      name: "Сапсан",
      timezone: MSK,
      ownerRelation: "не в команде: подписан на открытое расписание, записан гостем",
      members: [{ person: "efimov", role: "CAPTAIN" }, ...gen(69, 76).map((person) => ({ person, role: "PLAYER" as Role }))],
    },
    {
      key: "yastreby",
      name: "Ястребы",
      timezone: MSK,
      ownerRelation: "не в команде: твоя заявка ждёт ответа; казна в минусе (видно владельцу платформы)",
      members: [{ person: "zuev", role: "CAPTAIN" }, ...gen(77, 82).map((person) => ({ person, role: "PLAYER" as Role }))],
    },
    {
      key: "berkuty",
      name: "Беркуты",
      timezone: MSK,
      ownerRelation: "не в команде: тебе выпущено приглашение",
      members: [{ person: "frolov", role: "CAPTAIN" }, ...gen(83, 87).map((person) => ({ person, role: "PLAYER" as Role }))],
    },
  ];

  const teamById = new Map<string, TeamSpec>(teamsSpec.map((t) => [t.key, t]));
  const teamId = (key: string) => stableUuid(`team:${key}`);
  const captainOf = (key: string): string => {
    const t = teamById.get(key)!;
    const test = t.members.find((m) => m.role === "CAPTAIN" && m.person !== OWNER);
    return test ? test.person : OWNER;
  };
  const membershipId = (team: string, person: string) => stableUuid(`membership:${team}:${person}`);
  const membersOf = (team: string) => teamById.get(team)!.members;

  // --- Таблицы ---
  const users: Row[] = [];
  const identities: Row[] = [];
  const teams: Row[] = [];
  const memberships: Row[] = [];
  const joinLinks: Row[] = [];
  const invites: Row[] = [];
  const openSchedules: Row[] = [];
  const followers: Row[] = [];
  const series: Row[] = [];
  const events: Row[] = [];
  const commitments: Row[] = [];
  const rsvps: Row[] = [];
  const attendance: Row[] = [];
  const games: Row[] = [];
  const points: Row[] = [];
  const pointRoster: Row[] = [];
  const reflections: Row[] = [];
  const kills: Row[] = [];
  const captainReports: Row[] = [];
  const transactions: Row[] = [];
  const charges: Row[] = [];
  const allocations: Row[] = [];
  const slots: Row[] = [];
  const guests: Row[] = [];
  const joinRequests: Row[] = [];
  const creationRequests: Row[] = [];
  const notificationSettings: Row[] = [];
  const deliveries: Row[] = [];
  const announcements: Row[] = [];
  const autoReminders: Row[] = [];
  const audit: Row[] = [];

  const usedPeople = new Set<string>();
  for (const t of teamsSpec) for (const m of t.members) if (m.person !== OWNER) usedPeople.add(m.person);
  for (const extra of ["chernov", "titov", "pakhomov", "romanov", "galiev", "aksenov", "ershov", "savina"]) usedPeople.add(extra);

  const nowIso = now.toISOString();
  for (const key of [...people.keys()].filter((k) => usedPeople.has(k))) {
    const p = people.get(key)!;
    users.push({
      id: userId(key),
      telegram_id: testTelegramId(p.n),
      username: `${TEST_USERNAME_PREFIX}${p.nick}`,
      name: p.name,
      nickname: p.nick,
      avatar: p.photo ? avatarFor(key) : null,
      is_active: true,
      account_role: "USER",
      role_selected_at: nowIso,
      onboarding_completed_at: nowIso,
    });
    identities.push({
      id: stableUuid(`identity:${key}`),
      user_id: userId(key),
      provider: "telegram",
      provider_user_id: testTelegramId(p.n),
    });
  }

  for (const t of teamsSpec) {
    teams.push({
      id: teamId(t.key),
      name: `${t.name}${TEAM_NAME_SUFFIX}`,
      short_code: `${TEAM_CODE_PREFIX}${t.key}`,
      timezone: t.timezone,
      budget: 0, // считается ниже из операций
    });
    for (const m of t.members) {
      memberships.push({
        id: membershipId(t.key, m.person),
        user_id: userId(m.person),
        team_id: teamId(t.key),
        role: m.role,
        status: m.status ?? "ACTIVE",
        balance: 0, // считается ниже из начислений и оплат
        created_at: new Date(now.getTime() - minutes(60 * 24 * 40)).toISOString(),
      });
    }
    joinLinks.push({
      id: stableUuid(`join-link:${t.key}`),
      team_id: teamId(t.key),
      code: stableJoinCode(t.key),
      created_by: userId(captainOf(t.key)),
    });
  }

  // --- События ---
  const eventSpecs = new Map<string, EventSpec>();
  const addEvent = (spec: EventSpec) => {
    if (eventSpecs.has(spec.key)) throw new Error(`duplicate event key ${spec.key}`);
    eventSpecs.set(spec.key, spec);
  };
  const eventId = (key: string) => stableUuid(`event:${key}`);
  const tzOf = (team: string) => teamById.get(team)!.timezone;
  const ev = (
    team: string,
    key: string,
    o: Omit<EventSpec, "key" | "team" | "start" | "end"> & { day: number; time: [number, number]; durationMin: number; endDay?: number; endTime?: [number, number] }
  ) => {
    const tz = tzOf(team);
    const start = at(tz, o.day, o.time[0], o.time[1]);
    const end = o.endTime ? at(tz, o.endDay ?? o.day, o.endTime[0], o.endTime[1]) : new Date(start.getTime() + minutes(o.durationMin));
    const { day: _d, time: _t, durationMin: _m, endDay: _ed, endTime: _et, ...rest } = o;
    addEvent({ key, team, start, end, ...rest });
  };

  // «Сегодня вечером»: в 20:00 по Москве, а если вечер уже наступил — через
  // полтора часа от запуска (с округлением до четверти часа).
  const mskNow = localParts(now, MSK);
  const tonightStart =
    mskNow.hour < 19 ? at(MSK, 0, 20, 0) : new Date(Math.ceil((now.getTime() + minutes(90)) / minutes(15)) * minutes(15));

  // Гроза — главный человек капитан.
  addEvent({
    key: "groza.tonight",
    team: "groza",
    type: "TRAINING",
    title: "Вечерняя тренировка",
    start: tonightStart,
    end: new Date(tonightStart.getTime() + minutes(120)),
    location: "Маяк",
    cost: 700,
    description: "Работаем над выходом на змейку. Шары командные.",
  });
  addEvent({
    key: "groza.live",
    team: "groza",
    type: "TRAINING",
    title: "Игровая тренировка: отработка разбежки",
    start: new Date(now.getTime() - minutes(60)),
    end: new Date(now.getTime() + minutes(60)),
    location: "ВТочку",
    cost: 500,
    description: "Идёт прямо сейчас.",
  });
  ev("groza", "groza.tour", {
    type: "TOURNAMENT",
    title: "Кубок Подмосковья, 2 тура",
    day: -6,
    time: [10, 0],
    durationMin: 0,
    endDay: -5,
    endTime: [18, 0],
    location: "АКМ",
    cost: 2500,
    description: "Два игровых дня. Сбор в 8:30 у парковки.",
  });
  ev("groza", "groza.rent", {
    type: "FRIENDLY_MATCH",
    title: "Аренда поля и шары: спарринг с «Беркутами»",
    day: -10,
    time: [19, 0],
    durationMin: 150,
    location: "Маяк",
    cost: 1500,
    description: "Сбор по 1500 ₽ за аренду и шары.",
    finance: "COLLECTING",
  });
  ev("groza", "groza.unmarked", {
    type: "TRAINING",
    title: "Тренировка на «ВТочке»",
    day: -3,
    time: [19, 30],
    durationMin: 120,
    location: "ВТочку",
    cost: 600,
  });
  ev("groza", "groza.long", {
    type: "TRAINING",
    title: "Совместная тренировка с «Северным ветром» и отработка выходов на змейку перед открытым кубком области",
    day: 5,
    time: [19, 0],
    durationMin: 150,
    location:
      "Московская область, Богородский городской округ, деревня Кашино, территория спортивного клуба, поле номер три за парковкой у второго КПП",
    cost: 1000,
    description:
      "Длинное описание: план разминки, разбор прошлой игры, работа в парах, два гейма на время. Маркеры проверить заранее, баллоны заправить накануне. Кто берёт прокатную маску — напишите капитану до четверга.",
  });
  ev("groza", "groza.noplace", {
    type: "MEETING",
    title: "Собрание по сезону",
    day: 2,
    time: [21, 0],
    durationMin: 60,
    location: null,
    cost: null,
  });
  ev("groza", "groza.bytrainer", {
    type: "TRAINING",
    title: "Разминка и стрельба по мишеням",
    day: 3,
    time: [18, 30],
    durationMin: 90,
    location: "Маяк",
    cost: 400,
    description: "Событие завёл тренер.",
  });
  ev("groza", "groza.futuretour", {
    type: "TOURNAMENT",
    title: "Открытое первенство Москвы",
    day: 16,
    time: [9, 0],
    durationMin: 600,
    location: "АКМ",
    cost: 3000,
  });

  // Серии: занятия по дням недели с двух недель назад до трёх недель вперёд.
  type SeriesSpec = {
    key: string;
    team: string;
    title: string;
    type: EventType;
    weekdays: number[];
    time: [number, number];
    durationMin: number;
    location: string;
    cost: number;
  };
  const seriesOcc = new Map<string, string[]>(); // seriesKey -> event keys по времени
  const addSeries = (s: SeriesSpec) => {
    const tz = tzOf(s.team);
    const first = addDays(today(tz), -14);
    const last = addDays(today(tz), 21);
    const startUtc = at(tz, 0, s.time[0], s.time[1]);
    const endUtc = new Date(startUtc.getTime() + minutes(s.durationMin));
    series.push({
      id: stableUuid(`series:${s.key}`),
      team_id: teamId(s.team),
      type: s.type,
      title: s.title,
      description: null,
      location: s.location,
      cost: s.cost,
      cost_status: "ESTIMATED",
      finance_state: "NOT_CALCULATED",
      start_time_utc: startUtc.toISOString().slice(11, 19),
      end_time_utc: endUtc.toISOString().slice(11, 19),
      weekdays: s.weekdays,
      until_date: isoDate(last),
      created_by: userId(captainOf(s.team)),
    });
    const keys: string[] = [];
    for (let offset = -14; offset <= 21; offset += 1) {
      const day = addDays(today(tz), offset);
      if (!s.weekdays.includes(isoWeekday(day))) continue;
      const key = `${s.key}@${isoDate(day)}`;
      addEvent({
        key,
        team: s.team,
        type: s.type,
        title: s.title,
        start: at(tz, offset, s.time[0], s.time[1]),
        end: new Date(at(tz, offset, s.time[0], s.time[1]).getTime() + minutes(s.durationMin)),
        location: s.location,
        cost: s.cost,
        seriesKey: s.key,
        occurrenceDate: isoDate(day),
      });
      keys.push(key);
    }
    seriesOcc.set(s.key, keys);
  };
  addSeries({ key: "groza.series", team: "groza", title: "Тренировка по вторникам и четвергам", type: "TRAINING", weekdays: [2, 4], time: [20, 0], durationMin: 120, location: "Маяк", cost: 600 });
  addSeries({ key: "veter.series", team: "veter", title: "Субботняя тренировка", type: "TRAINING", weekdays: [6], time: [11, 0], durationMin: 180, location: "АКМ", cost: 800 });
  addSeries({ key: "kobry.series", team: "kobry", title: "Пятничная тренировка", type: "TRAINING", weekdays: [5], time: [19, 0], durationMin: 120, location: "Маяк", cost: 600 });

  // Занятия серии «Грозы»: первое будущее главный человек пропускает,
  // второе перенесено на день позже, третье удалено.
  const isFuture = (key: string) => eventSpecs.get(key)!.start.getTime() > now.getTime();
  const grozaFuture = seriesOcc.get("groza.series")!.filter(isFuture);
  const grozaPast = seriesOcc.get("groza.series")!.filter((k) => !isFuture(k));
  const [skipKey, movedKey, cancelledKey] = grozaFuture;
  const movedOriginalStart = eventSpecs.get(movedKey)!.start;
  {
    const moved = eventSpecs.get(movedKey)!;
    const tz = tzOf("groza");
    moved.start = new Date(moved.start.getTime() + minutes(60 * 24));
    moved.end = new Date(moved.end.getTime() + minutes(60 * 24));
    const p = localParts(moved.start, tz);
    moved.occurrenceDate = isoDate({ year: p.year, month: p.month, day: p.day });
    moved.description = "Перенесено на день позже: поле занято.";
    eventSpecs.get(cancelledKey)!.cancelled = true;
  }

  // Северный ветер — главный человек тренер.
  ev("veter", "veter.remind", { type: "TRAINING", title: "Тренировка: разбежки и связка", day: 4, time: [19, 0], durationMin: 120, location: "ВТочку", cost: 700 });
  ev("veter", "veter.past", { type: "TRAINING", title: "Тренировка на выносливость", day: -2, time: [19, 0], durationMin: 120, location: "Маяк", cost: 600 });
  ev("veter", "veter.tour", { type: "TOURNAMENT", title: "Открытый кубок «Северного ветра»", day: 12, time: [10, 0], durationMin: 480, location: "АКМ", cost: 2000 });
  ev("veter", "veter.meet", { type: "MEETING", title: "Разбор сезона", day: 1, time: [20, 30], durationMin: 60, location: "Онлайн, ссылка в чате команды", cost: null });
  ev("veter", "veter.form", { type: "OTHER", title: "Сбор на форму", day: -20, time: [12, 0], durationMin: 60, location: null, cost: 3000, finance: "COLLECTING" });

  // Кобры — главный человек игрок основы.
  ev("kobry", "kobry.tomorrow", { type: "TRAINING", title: "Тренировка", day: 1, time: [19, 0], durationMin: 120, location: "Маяк", cost: 600 });
  ev("kobry", "kobry.friendly", { type: "FRIENDLY_MATCH", title: "Товарищеская игра с «Лисами»", day: 2, time: [18, 0], durationMin: 180, location: "ВТочку", cost: 1000 });
  ev("kobry", "kobry.trip", { type: "TRAINING", title: "Выезд на «АКМ»: тренировочный день", day: 6, time: [10, 0], durationMin: 420, location: "АКМ", cost: 2000 });
  ev("kobry", "kobry.liga", { type: "TOURNAMENT", title: "Лига Подмосковья, 3 этап", day: -12, time: [9, 0], durationMin: 540, location: "АКМ", cost: 1500, finance: "COLLECTING" });

  // Лисы — в запасе.
  ev("lisy", "lisy.train", { type: "TRAINING", title: "Тренировка основы", day: 3, time: [20, 0], durationMin: 120, location: "Маяк", cost: 600 });
  ev("lisy", "lisy.cup", { type: "TOURNAMENT", title: "Турнир «Осенний лис»", day: 13, time: [10, 0], durationMin: 480, location: "АКМ", cost: 2000 });
  ev("lisy", "lisy.past", { type: "TRAINING", title: "Тренировка", day: -5, time: [20, 0], durationMin: 120, location: "Маяк", cost: 600 });

  // Тайфун — пояс Владивостока (UTC+10).
  ev("tayfun", "tayfun.morning", { type: "TRAINING", title: "Утренняя тренировка", day: 1, time: [10, 0], durationMin: 120, location: "Владивосток, полигон «Аякс»", cost: 500 });
  ev("tayfun", "tayfun.cup", { type: "TOURNAMENT", title: "Тихоокеанский кубок", day: 8, time: [9, 0], durationMin: 540, location: "Владивосток, остров Русский", cost: 2500 });
  ev("tayfun", "tayfun.past", { type: "TRAINING", title: "Тренировка", day: -4, time: [18, 0], durationMin: 120, location: "Владивосток, полигон «Аякс»", cost: 500 });

  // Метель — травма; тренировка завтра пересекается с тренировкой «Кобр».
  ev("metel", "metel.tomorrow", { type: "TRAINING", title: "Тренировка", day: 1, time: [19, 30], durationMin: 120, location: "ВТочку", cost: 500 });
  ev("metel", "metel.past", { type: "TRAINING", title: "Тренировка", day: -7, time: [19, 30], durationMin: 120, location: "ВТочку", cost: 500 });

  // Шторм — отпуск.
  ev("shtorm", "shtorm.cup", { type: "TOURNAMENT", title: "Кубок «Шторм»", day: 10, time: [10, 0], durationMin: 480, location: "АКМ", cost: 1800 });

  // Сапсан — открытое расписание, слоты.
  ev("sapsan", "sapsan.free", { type: "TRAINING", title: "Игровая тренировка, нужны игроки", day: 4, time: [19, 0], durationMin: 150, location: "Маяк", cost: 800 });
  ev("sapsan", "sapsan.full", { type: "TOURNAMENT", title: "Турнир выходного дня", day: 6, time: [11, 0], durationMin: 420, location: "АКМ", cost: 1500 });
  ev("sapsan", "sapsan.booked", { type: "TRAINING", title: "Вечерняя игра", day: 1, time: [20, 0], durationMin: 120, location: "ВТочку", cost: 500 });
  ev("sapsan", "sapsan.closed", { type: "TRAINING", title: "Тренировка состава", day: 9, time: [19, 0], durationMin: 120, location: "Маяк", cost: 600 });

  // Ястребы, Беркуты.
  ev("yastreby", "yastreby.train", { type: "TRAINING", title: "Тренировка", day: 7, time: [19, 0], durationMin: 120, location: "Маяк", cost: 600 });
  ev("yastreby", "yastreby.past", { type: "TRAINING", title: "Тренировка с разбором", day: -9, time: [19, 0], durationMin: 120, location: "Маяк", cost: 800, finance: "COLLECTING" });
  ev("berkuty", "berkuty.train", { type: "TRAINING", title: "Тренировка перед кубком", day: 5, time: [20, 0], durationMin: 120, location: "ВТочку", cost: 700 });

  for (const spec of eventSpecs.values()) {
    events.push({
      id: eventId(spec.key),
      team_id: teamId(spec.team),
      series_id: spec.seriesKey ? stableUuid(`series:${spec.seriesKey}`) : null,
      occurrence_date: spec.occurrenceDate ?? (() => {
        const p = localParts(spec.start, tzOf(spec.team));
        return isoDate({ year: p.year, month: p.month, day: p.day });
      })(),
      type: spec.type,
      title: spec.title,
      description: spec.description ?? null,
      start_at: spec.start.toISOString(),
      end_at: spec.end.toISOString(),
      location: spec.location,
      cost: spec.cost,
      cost_status: spec.cost === null ? "UNKNOWN" : spec.start.getTime() < now.getTime() ? "FINAL" : "ESTIMATED",
      finance_state: spec.finance ?? "NOT_CALCULATED",
      is_cancelled: Boolean(spec.cancelled),
    });
  }

  // --- Ответы ---
  // Простая детерминированная раскладка: участники команды (кроме главного
  // человека) по кругу со сдвигом от ключа события.
  const rsvpSet = new Map<string, Answer>(); // `${event}|${person}`
  const setAnswer = (event: string, person: string, answer: Answer | null) => {
    const k = `${event}|${person}`;
    if (answer === null) rsvpSet.delete(k);
    else rsvpSet.set(k, answer);
  };
  const answerOf = (event: string, person: string) => rsvpSet.get(`${event}|${person}`) ?? null;
  const shiftOf = (key: string) => parseInt(stableUuid(`shift:${key}`).slice(0, 4), 16);
  const spread = (event: string, counts: { c?: number; p?: number; d?: number }, exclude: string[] = []) => {
    const spec = eventSpecs.get(event)!;
    const pool = membersOf(spec.team)
      .map((m) => m.person)
      .filter((p) => p !== OWNER && !exclude.includes(p));
    const shift = shiftOf(event) % Math.max(pool.length, 1);
    const ordered = [...pool.slice(shift), ...pool.slice(0, shift)];
    let i = 0;
    for (let n = 0; n < (counts.c ?? 0) && i < ordered.length; n += 1) setAnswer(event, ordered[i++], "CONFIRMED");
    for (let n = 0; n < (counts.p ?? 0) && i < ordered.length; n += 1) setAnswer(event, ordered[i++], "PENDING");
    for (let n = 0; n < (counts.d ?? 0) && i < ordered.length; n += 1) setAnswer(event, ordered[i++], "DECLINED");
  };

  spread("groza.tonight", { c: 8, p: 3, d: 4 });
  spread("groza.live", { c: 14, d: 3 });
  setAnswer("groza.live", OWNER, "CONFIRMED");
  spread("groza.tour", { c: 14, d: 6 });
  setAnswer("groza.tour", OWNER, "CONFIRMED");
  spread("groza.rent", { c: 10, d: 4 });
  setAnswer("groza.rent", OWNER, "CONFIRMED");
  spread("groza.unmarked", { c: 11, p: 2, d: 4 });
  setAnswer("groza.unmarked", OWNER, "CONFIRMED");
  spread("groza.long", { c: 6, p: 4, d: 2 });
  setAnswer("groza.long", OWNER, "CONFIRMED");
  spread("groza.noplace", { c: 9, p: 2, d: 1 });
  spread("groza.bytrainer", { c: 5, d: 1 });
  spread("groza.futuretour", { c: 12, p: 5, d: 3 });
  setAnswer("groza.futuretour", OWNER, "CONFIRMED");

  spread("veter.remind", { c: 2, p: 1, d: 1 });
  spread("veter.past", { c: 7, d: 2 });
  setAnswer("veter.past", OWNER, "CONFIRMED");
  spread("veter.tour", { c: 6, p: 2 });
  setAnswer("veter.tour", OWNER, "PENDING");
  spread("veter.meet", { c: 4 });
  spread("veter.form", { c: 6 });

  spread("kobry.tomorrow", { c: 6, p: 1, d: 1 });
  setAnswer("kobry.tomorrow", OWNER, "CONFIRMED");
  spread("kobry.friendly", { c: 5, p: 2, d: 1 });
  setAnswer("kobry.friendly", OWNER, "PENDING");
  spread("kobry.trip", { c: 4, p: 2, d: 2 });
  setAnswer("kobry.trip", OWNER, "DECLINED");
  spread("kobry.liga", { c: 8, d: 2 });
  setAnswer("kobry.liga", OWNER, "CONFIRMED");

  spread("lisy.train", { c: 4, p: 1 });
  spread("lisy.cup", { c: 3, p: 2 });
  spread("lisy.past", { c: 5, d: 1 });
  spread("tayfun.morning", { c: 3, p: 1 });
  spread("tayfun.cup", { c: 5 });
  setAnswer("tayfun.cup", OWNER, "CONFIRMED");
  spread("tayfun.past", { c: 5 });
  setAnswer("tayfun.past", OWNER, "CONFIRMED");
  spread("metel.tomorrow", { c: 3, d: 1 });
  spread("metel.past", { c: 4 });
  spread("shtorm.cup", { c: 3, p: 1 });
  setAnswer("shtorm.cup", OWNER, "DECLINED");
  spread("sapsan.free", { c: 5, d: 1 });
  spread("sapsan.full", { c: 7 });
  spread("sapsan.booked", { c: 4, p: 1 });
  spread("sapsan.closed", { c: 5 });
  spread("yastreby.train", { c: 3, p: 1 });
  spread("yastreby.past", { c: 5 });
  spread("berkuty.train", { c: 3 });

  // Серии: кто записан на все занятия.
  const commit = (seriesKey: string, person: string) =>
    commitments.push({
      id: stableUuid(`commit:${seriesKey}:${person}`),
      series_id: stableUuid(`series:${seriesKey}`),
      user_id: userId(person),
      status: "COMMITTED",
    });
  commit("groza.series", OWNER);
  for (const p of ["sokolov", "kirill", ...gen(1, 12)]) commit("groza.series", p);
  for (const p of gen(27, 31)) commit("veter.series", p);
  for (const p of ["belov", "mironov", ...gen(37, 41)]) commit("kobry.series", p);
  // Главный человек записан на серию «Грозы», но одно занятие пропускает.
  setAnswer(skipKey, OWNER, "DECLINED");
  // Пара явных «не приду» у других в будущих занятиях.
  setAnswer(skipKey, "g2", "DECLINED");
  setAnswer(movedKey, "g4", "DECLINED");
  for (const k of seriesOcc.get("veter.series")!) spread(k, { p: 1, d: 1 }, gen(27, 31));
  for (const k of seriesOcc.get("kobry.series")!) spread(k, { d: 1 }, ["belov", "mironov", ...gen(37, 41)]);

  // Исключённый из «Грозы» игрок: ответы на прошлые события остались.
  for (const k of ["groza.rent", "groza.tour", ...grozaPast]) setAnswer(k, "chernov", "CONFIRMED");

  for (const [k, status] of rsvpSet) {
    const [event, person] = k.split("|");
    const spec = eventSpecs.get(event)!;
    const answeredAt = new Date(Math.min(spec.start.getTime(), now.getTime()) - minutes(60 * 24 + (shiftOf(k) % 600)));
    rsvps.push({ event_id: eventId(event), user_id: userId(person), status, updated_at: answeredAt.toISOString() });
  }

  // --- Явка ---
  const markAttendance = (event: string, markedBy: string, extraPresent: string[] = [], absent: string[] = []) => {
    const spec = eventSpecs.get(event)!;
    const confirmed = [...rsvpSet.entries()]
      .filter(([k, v]) => k.startsWith(`${event}|`) && v === "CONFIRMED")
      .map(([k]) => k.split("|")[1]);
    const committed = spec.seriesKey
      ? commitments.filter((c) => c.series_id === stableUuid(`series:${spec.seriesKey}`)).map((c) => [...people.keys(), OWNER].find((p) => userId(p) === c.user_id)!)
      : [];
    const declined = new Set(
      [...rsvpSet.entries()].filter(([k, v]) => k.startsWith(`${event}|`) && v === "DECLINED").map(([k]) => k.split("|")[1])
    );
    const present = new Set([...confirmed, ...committed.filter((p) => !declined.has(p)), ...extraPresent]);
    for (const a of absent) present.delete(a);
    const marked = new Date(spec.end.getTime() + minutes(30)).toISOString();
    for (const person of present) {
      attendance.push({ id: stableUuid(`att:${event}:${person}`), event_id: eventId(event), user_id: userId(person), present: true, marked_by: userId(markedBy), marked_at: marked });
    }
    for (const person of absent) {
      attendance.push({ id: stableUuid(`att:${event}:${person}`), event_id: eventId(event), user_id: userId(person), present: false, marked_by: userId(markedBy), marked_at: marked });
    }
  };
  const confirmedOf = (event: string) =>
    [...rsvpSet.entries()].filter(([k, v]) => k.startsWith(`${event}|`) && v === "CONFIRMED").map(([k]) => k.split("|")[1]);
  const notConfirmed = (event: string) => membersOf(eventSpecs.get(event)!.team).map((m) => m.person).filter((p) => p !== OWNER && !confirmedOf(event).includes(p));

  markAttendance("groza.tour", "sokolov", [], [confirmedOf("groza.tour").filter((p) => p !== OWNER)[0]]);
  markAttendance("groza.rent", "sokolov", [notConfirmed("groza.rent")[0]], []);
  // Прошлые занятия серии «Грозы» отмечены, кроме последнего.
  for (const k of grozaPast.slice(0, -1)) markAttendance(k, "sokolov");
  markAttendance("tayfun.past", "orlova");
  markAttendance("lisy.past", "laptev");
  markAttendance("metel.past", "vetrov");
  // groza.unmarked, veter.past, последнее прошлое занятие серии — явка не отмечена.

  // --- Игры, пойнты, рефлексия ---
  const game = (event: string, key: string, time: string, opponent: string, score: string | null, pit: "NEAR" | "FAR" | null, pair: "FIRST" | "SECOND" | null) => {
    games.push({ id: stableUuid(`game:${event}:${key}`), event_id: eventId(event), time_label: time, opponent, score, pit_zone: pit, game_pair: pair });
    return stableUuid(`game:${event}:${key}`);
  };
  const g1 = game("groza.tour", "1", "10:00", "Дикие утки", "4:2", "NEAR", "FIRST");
  const g2 = game("groza.tour", "2", "11:30", "Медведи", "3:4", "FAR", "SECOND");
  game("groza.tour", "3", "13:00", "Красный октябрь", "5:1", "NEAR", "FIRST");
  game("groza.tour", "4", "10:30", "Медведи", "4:3", "FAR", "FIRST");
  game("groza.tour", "5", "12:30", "Тайга", "2:4", "NEAR", "SECOND");
  game("groza.futuretour", "1", "09:40", "Тайга", null, "NEAR", "FIRST");
  game("groza.futuretour", "2", "11:20", "Медведи", null, "FAR", "SECOND");
  game("groza.futuretour", "3", "13:00", "Дикие утки", null, null, null);
  game("veter.tour", "1", "10:30", "Кобры", null, "NEAR", "FIRST");
  game("veter.tour", "2", "12:00", "Лисы", null, "FAR", "SECOND");
  game("veter.tour", "3", "13:30", "Шторм", null, "NEAR", "FIRST");
  game("veter.tour", "4", "15:00", "Метель", null, "FAR", "SECOND");
  game("kobry.friendly", "1", "18:30", "Лисы", null, "NEAR", "FIRST");
  game("kobry.friendly", "2", "19:30", "Лисы", null, "FAR", "SECOND");
  game("kobry.liga", "1", "09:30", "Тайфун", "3:1", "NEAR", "FIRST");
  game("kobry.liga", "2", "11:00", "Шторм", "2:3", "FAR", "SECOND");
  game("kobry.liga", "3", "12:30", "Метель", "4:0", "NEAR", "FIRST");
  game("tayfun.cup", "1", "09:30", "Приморье", null, "NEAR", "FIRST");

  const point = (gameId: string, ordinal: number, result: "WIN" | "LOSS" | null, opponentSize: number | null) => {
    const id = stableUuid(`point:${gameId}:${ordinal}`);
    points.push({ id, game_id: gameId, ordinal, result, opponent_roster_size: opponentSize });
    return id;
  };
  const g1Points = (["WIN", "WIN", "LOSS", "WIN", "LOSS", "WIN"] as const).map((r, i) => point(g1, i + 1, r, i === 2 ? 4 : 5));
  // Вторая игра: размечены не все пойнты — приложение покажет, что разметка не сходится со счётом.
  (["LOSS", "WIN", "LOSS", "WIN", "WIN", null, null] as const).map((r, i) => point(g2, i + 1, r, null));

  const rosterPoint1 = [OWNER, "sokolov", "kirill", "g1", "g2"];
  for (const p of rosterPoint1) pointRoster.push({ point_id: g1Points[0], user_id: userId(p) });

  const reflect = (pointId: string, person: string, r: { exit: "SURVIVED" | "HIT" | "PENALTY"; phase?: "BREAK" | "COVER" | "ROTATION"; pos?: string; penalty?: "OWN" | "TEAMMATE"; rating?: number; note?: string; kills?: Array<{ phase: "BREAK" | "COVER" | "ROTATION"; pos?: string }> }) => {
    const id = stableUuid(`reflection:${pointId}:${person}`);
    reflections.push({
      id,
      point_id: pointId,
      user_id: userId(person),
      exit_reason: r.exit,
      penalty_kind: r.penalty ?? null,
      exit_phase: r.exit === "SURVIVED" ? null : r.phase ?? "COVER",
      exit_position_id: r.exit === "SURVIVED" ? null : r.pos ?? null,
      self_rating: r.rating ?? null,
      note: r.note ?? null,
    });
    (r.kills ?? []).forEach((k, i) =>
      kills.push({ id: stableUuid(`kill:${id}:${i}`), reflection_id: id, ordinal: i + 1, phase: k.phase, position_id: k.pos ?? null })
    );
  };
  reflect(g1Points[0], "sokolov", { exit: "SURVIVED", rating: 4, kills: [{ phase: "BREAK", pos: "snake.2.far" }, { phase: "COVER", pos: "grid.50.far" }] });
  reflect(g1Points[0], "kirill", { exit: "HIT", phase: "BREAK", pos: "snake.1.near", rating: 2, note: "Вышел рано, поймали на разбежке." });
  reflect(g1Points[0], "g1", { exit: "PENALTY", phase: "COVER", pos: "grid.30.near", penalty: "OWN", rating: 3 });
  reflect(g1Points[1], "sokolov", { exit: "HIT", phase: "ROTATION", pos: "grid.300.near", rating: 3, kills: [{ phase: "ROTATION" }] });
  reflect(g1Points[1], "g2", { exit: "SURVIVED", rating: 5 });
  reflect(g1Points[2], "kirill", { exit: "PENALTY", phase: "COVER", pos: "envelope.2.near", penalty: "TEAMMATE" });
  captainReports.push({
    id: stableUuid(`captain-report:${g1Points[0]}`),
    point_id: g1Points[0],
    author_user_id: userId("sokolov"),
    combination: "SNAKE_ATTACK",
    break_width: "WIDE",
    opponent_break_width: "NARROW",
    initiative_snake: 1,
    initiative_center: 0,
    initiative_envelope: -1,
    delta_otb: 1,
    note: "Змейку забрали сразу, по конвертам опоздали.",
  });

  // --- Деньги ---
  // Модель как в приложении: оплата (DEPOSIT) поднимает казну и баланс
  // плательщика, расход (EXPENSE) опускает казну. Начисление по событию
  // (`event_member_charges`) — долг участника; оплата по нему — распределение.
  // Баланс участника = оплаты − начисления: капитан в «Казне» и игрок в своём
  // долге видят одно и то же число.
  const memberBalance = new Map<string, number>(); // `${team}|${person}`
  const budget = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string, delta: number) => map.set(key, (map.get(key) ?? 0) + delta);
  let txSeq = 0;
  const tx = (team: string, type: "DEPOSIT" | "EXPENSE", amount: number, title: string, dayOffset: number, opts: { person?: string; event?: string } = {}) => {
    txSeq += 1;
    const id = stableUuid(`tx:${team}:${txSeq}`);
    transactions.push({
      id,
      team_id: teamId(team),
      type,
      amount,
      title,
      date: at(tzOf(team), dayOffset, 12, 0).toISOString(),
      user_id: opts.person ? userId(opts.person) : null,
      user_name_snapshot: opts.person ? nameOf(opts.person) : null,
      status: "COMPLETED",
      created_by: userId(captainOf(team) === OWNER ? "sokolov" : captainOf(team)),
      event_id: opts.event ? eventId(opts.event) : null,
      idempotency_scope: "SEED_SCENARIOS",
      idempotency_key: `${SEED_MARK}:${team}:${txSeq}`,
    });
    if (type === "DEPOSIT") {
      bump(budget, team, amount);
      if (opts.person) bump(memberBalance, `${team}|${opts.person}`, amount);
    } else {
      bump(budget, team, -amount);
    }
    return id;
  };
  const charge = (team: string, event: string, person: string, amount: number, paid: number, payDay: number) => {
    const chargeId = stableUuid(`charge:${event}:${person}`);
    charges.push({
      id: chargeId,
      event_id: eventId(event),
      user_id: userId(person),
      team_id: teamId(team),
      amount_due: amount,
      note: null,
      created_by: userId(captainOf(team) === OWNER ? "sokolov" : captainOf(team)),
      idempotency_key: `${SEED_MARK}:charge:${event}:${person}`,
    });
    bump(memberBalance, `${team}|${person}`, -amount);
    if (paid > 0) {
      const txId = tx(team, "DEPOSIT", paid, `Оплата: ${eventSpecs.get(event)!.title}`, payDay, { person, event });
      allocations.push({
        id: stableUuid(`alloc:${event}:${person}`),
        transaction_id: txId,
        event_member_charge_id: chargeId,
        amount: paid,
        created_by: userId(captainOf(team) === OWNER ? "sokolov" : captainOf(team)),
        idempotency_key: `${SEED_MARK}:alloc:${event}:${person}`,
      });
    }
  };

  // Гроза: плюс в казне, операции за месяц, трое должников.
  tx("groza", "DEPOSIT", 15000, "Спонсорская помощь от магазина снаряжения", -27);
  tx("groza", "EXPENSE", 6000, "Шары, 4 коробки", -21);
  tx("groza", "EXPENSE", 3500, "Аренда поля «Маяк» на месяц", -14);
  {
    const payers = confirmedOf("groza.rent").filter((p) => p !== OWNER).slice(0, 8);
    const paidPlan = [1500, 1500, 1500, 1500, 1500, 1000, 500, 0];
    payers.forEach((p, i) => charge("groza", "groza.rent", p, 1500, paidPlan[i], -9 + Math.min(i, 5)));
  }
  tx("groza", "EXPENSE", 2500, "Взнос за участие в «Кубке Подмосковья»", -7, { event: "groza.tour" });
  tx("groza", "DEPOSIT", 4000, "Призовые: 3 место в «Кубке Подмосковья»", -5, { event: "groza.tour" });
  tx("groza", "EXPENSE", 1200, "Ремонт маркера команды", -4);

  // Ветер: сбор на форму, двое не сдали.
  tx("veter", "DEPOSIT", 5000, "Остаток с прошлого сезона", -28);
  confirmedOf("veter.form").slice(0, 6).forEach((p, i) => charge("veter", "veter.form", p, 3000, i < 4 ? 3000 : 0, -19 + i));
  tx("veter", "EXPENSE", 9000, "Форма, 10 комплектов", -18);

  // Кобры: главный человек должен за этап лиги.
  tx("kobry", "DEPOSIT", 6000, "Остаток кассы", -29);
  {
    const others = confirmedOf("kobry.liga").filter((p) => p !== OWNER && p !== "mironov" && p !== "belka").slice(0, 4);
    charge("kobry", "kobry.liga", OWNER, 1500, 0, -11);
    charge("kobry", "kobry.liga", "mironov", 1500, 1500, -11);
    charge("kobry", "kobry.liga", "belka", 1500, 700, -10);
    others.forEach((p) => charge("kobry", "kobry.liga", p, 1500, 1500, -11));
  }
  tx("kobry", "EXPENSE", 10500, "Взнос за этап лиги", -13, { event: "kobry.liga" });

  tx("lisy", "DEPOSIT", 2000, "Взносы за октябрь", -20);
  tx("lisy", "EXPENSE", 800, "Шары на тренировку", -10);
  tx("tayfun", "DEPOSIT", 3000, "Взносы", -15);

  // Ястребы: казна в минусе.
  tx("yastreby", "DEPOSIT", 4000, "Взносы за октябрь", -25);
  tx("yastreby", "EXPENSE", 7000, "Аренда поля на сезон", -20);
  confirmedOf("yastreby.past").slice(0, 4).forEach((p, i) => charge("yastreby", "yastreby.past", p, 800, i < 2 ? 800 : 0, -8));
  tx("yastreby", "EXPENSE", 2500, "Шары", -8);

  for (const t of teams) {
    const key = teamsSpec.find((s) => teamId(s.key) === t.id)!.key;
    t.budget = budget.get(key) ?? 0;
  }
  for (const m of memberships) {
    const team = teamsSpec.find((s) => teamId(s.key) === m.team_id)!.key;
    const person = [...people.keys(), OWNER].find((p) => userId(p) === m.user_id)!;
    m.balance = memberBalance.get(`${team}|${person}`) ?? 0;
  }

  // --- Открытое расписание, подписки, слоты ---
  openSchedules.push({ team_id: teamId("sapsan"), enabled: true, updated_by: userId("efimov") });
  openSchedules.push({ team_id: teamId("groza"), enabled: true, updated_by: userId("sokolov") });
  for (const p of [OWNER, "aksenov", "ershov"]) followers.push({ team_id: teamId("sapsan"), user_id: userId(p) });
  for (const p of ["aksenov", "ershov"]) followers.push({ team_id: teamId("groza"), user_id: userId(p) });

  const openSlots = (event: string, capacity: number, price: number, openedBy: string, guestList: Array<{ person: string; paid: boolean }>) => {
    const spec = eventSpecs.get(event)!;
    const openedAt = new Date(now.getTime() - minutes(60 * 24 * 2));
    slots.push({
      event_id: eventId(event),
      team_id: teamId(spec.team),
      capacity,
      price,
      status: "OPEN",
      round: 1,
      free_seq: 0,
      opened_by: userId(openedBy),
      opened_at: openedAt.toISOString(),
    });
    guestList.forEach((g, i) => {
      const booked = new Date(openedAt.getTime() + minutes(60 * (i + 1)));
      guests.push({
        id: stableUuid(`guest:${event}:${g.person}`),
        event_id: eventId(event),
        user_id: userId(g.person),
        status: "BOOKED",
        price,
        paid: g.paid,
        paid_by: g.paid ? userId(openedBy) : null,
        paid_at: g.paid ? new Date(booked.getTime() + minutes(120)).toISOString() : null,
        booked_at: booked.toISOString(),
      });
    });
  };
  openSlots("sapsan.free", 4, 800, "efimov", [{ person: "aksenov", paid: true }, { person: "ershov", paid: false }]);
  openSlots("sapsan.full", 2, 1500, "efimov", [{ person: "galiev", paid: true }, { person: "savina", paid: false }]);
  openSlots("sapsan.booked", 3, 500, "efimov", [{ person: OWNER, paid: false }, { person: "aksenov", paid: true }]);
  openSlots("groza.long", 3, 1000, "sokolov", [{ person: "aksenov", paid: true }]);

  // --- Заявки, приглашение ---
  const linkId = (team: string) => stableUuid(`join-link:${team}`);
  const joinRequest = (team: string, person: string, hoursAgo: number) =>
    joinRequests.push({
      id: stableUuid(`join-request:${team}:${person}`),
      team_id: teamId(team),
      user_id: userId(person),
      link_id: linkId(team),
      status: "PENDING",
      created_at: new Date(now.getTime() - minutes(60 * hoursAgo)).toISOString(),
    });
  joinRequest("groza", "titov", 5);
  joinRequest("groza", "pakhomov", 26);
  joinRequest("veter", "romanov", 3);
  joinRequest("yastreby", OWNER, 20);

  creationRequests.push({
    id: stableUuid("team-request:galiev"),
    user_id: userId("galiev"),
    team_name: `Барсы${TEAM_NAME_SUFFIX}`,
    status: "PENDING",
    created_at: new Date(now.getTime() - minutes(60 * 30)).toISOString(),
  });
  creationRequests.push({
    id: stableUuid("team-request:savina"),
    user_id: userId("savina"),
    team_name: `Совы${TEAM_NAME_SUFFIX}`,
    status: "PENDING",
    created_at: new Date(now.getTime() - minutes(60 * 4)).toISOString(),
  });

  const inviteToken = stableUuid("invite:berkuty", salt);
  invites.push({
    id: stableUuid("invite-row:berkuty"),
    team_id: teamId("berkuty"),
    token: inviteToken,
    role: "PLAYER",
    created_by: userId("frolov"),
    expires_at: new Date(now.getTime() + minutes(60 * 24 * 7)).toISOString(),
    single_use: true,
    note: "Для тебя: нужен ещё один игрок на кубок",
  });

  // --- Уведомления ---
  notificationSettings.push({ user_id: userId("kirill"), auto_event_reminders: false });

  // «Напомнить» по вечерней тренировке два часа назад: у части не дошло.
  const reminderBatch = stableUuid("batch:groza.tonight:remind");
  const remindedAt = new Date(now.getTime() - minutes(120));
  const silent = membersOf("groza")
    .map((m) => m.person)
    // Кто нажал «Напомнить» (Соколов), сам напоминание не получает.
    .filter((p) => p !== OWNER && p !== "sokolov" && answerOf("groza.tonight", p) !== "CONFIRMED" && answerOf("groza.tonight", p) !== "DECLINED")
    .slice(0, 12);
  const outcomes: Array<{ status: string; channel: string; code: string | null; detail: string | null }> = [
    ...Array.from({ length: 8 }, () => ({ status: "SENT", channel: "TELEGRAM", code: null, detail: null })),
    { status: "QUEUED", channel: "TELEGRAM", code: null, detail: null },
    { status: "FAILED", channel: "TELEGRAM", code: "CHAT_NOT_FOUND", detail: "Bad Request: chat not found" },
    { status: "FAILED", channel: "TELEGRAM", code: "BOT_BLOCKED", detail: "Forbidden: bot was blocked by the user" },
    { status: "NO_CHANNEL", channel: "NONE", code: "NO_CHANNEL", detail: null },
  ];
  silent.forEach((p, i) => {
    const o = outcomes[i % outcomes.length];
    deliveries.push({
      id: stableUuid(`delivery:remind:${p}`),
      team_id: teamId("groza"),
      event_id: eventId("groza.tonight"),
      user_id: userId(p),
      kind: "EVENT_REMINDER",
      channel: o.channel,
      status: o.status === "NO_CHANNEL" ? "FAILED" : o.status,
      error_code: o.code,
      error_detail: o.detail,
      batch_id: reminderBatch,
      created_at: new Date(remindedAt.getTime() + i * 1000).toISOString(),
    });
  });

  // Сообщение о переносе занятия серии — вчера, у одного не дошло.
  const announceBatch = stableUuid("batch:groza.series:moved");
  const announcedAt = new Date(now.getTime() - minutes(60 * 20));
  announcements.push({
    id: stableUuid("announcement:groza.series:moved"),
    team_id: teamId("groza"),
    event_id: eventId(movedKey),
    series_id: null,
    scope: "EVENT",
    kind: "RESCHEDULED",
    actor_user_id: userId("sokolov"),
    payload: JSON.stringify({ startAt: movedOriginalStart.toISOString(), location: "Маяк", seed: SEED_MARK }),
    due_at: announcedAt.toISOString(),
    status: "SENT",
    batch_id: announceBatch,
    created_at: new Date(announcedAt.getTime() - minutes(3)).toISOString(),
    sent_at: announcedAt.toISOString(),
  });
  membersOf("groza")
    .map((m) => m.person)
    .filter((p) => p !== OWNER && p !== "sokolov" && (membersOf("groza").find((m) => m.person === p)!.status ?? "ACTIVE") !== "RESERVE")
    .slice(0, 10)
    .forEach((p, i) => {
      deliveries.push({
        id: stableUuid(`delivery:announce:${p}`),
        team_id: teamId("groza"),
        event_id: eventId(movedKey),
        user_id: userId(p),
        kind: "EVENT_ANNOUNCEMENT",
        channel: "TELEGRAM",
        status: i === 6 ? "FAILED" : "SENT",
        error_code: i === 6 ? "USER_DEACTIVATED" : null,
        error_detail: i === 6 ? "Forbidden: user is deactivated" : null,
        batch_id: announceBatch,
        created_at: new Date(announcedAt.getTime() + i * 1000).toISOString(),
      });
    });

  // Авто-напоминания. Видимые строки — для экрана «Кому дошло» вечерней
  // тренировки. Остальные строки служебные: приложение с включёнными
  // авто-напоминаниями не пошлёт напоминание ни о каком тестовом событии ни
  // главному человеку, ни тестовым людям. Канал `ANNOUNCEMENT` — так
  // приложение помечает «напоминание не уходило», в «Кому дошло» такие строки
  // не показываются.
  const visibleAuto = new Map<string, { status: string; code: string | null }>();
  const tonightSilent = silent.slice(0, 5);
  const autoOutcomes = [
    { status: "SENT", code: null },
    { status: "SENT", code: null },
    { status: "SENT", code: null },
    { status: "FAILED", code: "CHAT_NOT_FOUND" },
    { status: "NO_CHANNEL", code: "NO_CHANNEL" },
  ];
  tonightSilent.forEach((p, i) => visibleAuto.set(p, autoOutcomes[i]));
  for (const spec of eventSpecs.values()) {
    if (spec.start.getTime() <= now.getTime() || spec.cancelled) continue;
    const tz = tzOf(spec.team);
    const recipients = new Set<string>(membersOf(spec.team).map((m) => m.person));
    for (const window of autoReminderWindows(spec.start, tz)) {
      for (const person of recipients) {
        const visible = spec.key === "groza.tonight" && window.slot === "EVE" ? visibleAuto.get(person) : undefined;
        const createdAt = visible
          ? new Date(Math.min(window.windowStart.getTime() + minutes(5), now.getTime() - minutes(1)))
          : now;
        autoReminders.push({
          id: stableUuid(`auto:${spec.key}:${person}:${window.slotKey}`),
          event_id: eventId(spec.key),
          team_id: teamId(spec.team),
          user_id: userId(person),
          slot: window.slot,
          slot_key: window.slotKey,
          status: visible ? visible.status : "SENT",
          channel: visible ? (visible.status === "NO_CHANNEL" ? null : "TELEGRAM") : "ANNOUNCEMENT",
          error_code: visible ? visible.code : SEED_MARK,
          error_detail: null,
          created_at: createdAt.toISOString(),
        });
      }
    }
  }

  // --- Журнал «Грозы» ---
  const log = (person: string, action: string, payload: Row, agoMinutes: number) =>
    audit.push({
      id: stableUuid(`audit:${audit.length}:${action}`),
      user_id: userId(person),
      action,
      payload: JSON.stringify({ ...payload, teamId: teamId("groza"), seedScenarios: SEED_MARK }),
      created_at: new Date(now.getTime() - minutes(agoMinutes)).toISOString(),
    });
  log("sokolov", "events.create.recurrence", { seriesId: stableUuid("series:groza.series") }, 60 * 24 * 15);
  log("sokolov", "finance.payment.create", { amount: 1500 }, 60 * 24 * 8);
  log("sokolov", "events.attendance.mark", { eventId: eventId("groza.rent") }, 60 * 24 * 9);
  log("sokolov", "finance.transaction.create", { type: "EXPENSE", amount: 1200 }, 60 * 24 * 4);
  log("kirill", "reflection.submit", { pointId: g1Points[0] }, 60 * 24 * 4 + 30);
  log("sokolov", "reflection.captain_report", { pointId: g1Points[0] }, 60 * 24 * 4 + 10);
  log("sokolov", "teams.membership.update", { membershipId: membershipId("groza", "g3"), status: "RESERVE" }, 60 * 24 * 3);
  log("mironov", "events.create", { eventId: eventId("groza.bytrainer"), actorTeamRole: "TRAINER" }, 60 * 24);
  log("sokolov", "events.update.single", { eventId: eventId(movedKey) }, 60 * 20 + 5);
  log("sokolov", "events.delete.single", { eventId: eventId(cancelledKey) }, 60 * 20);
  log("sokolov", "notifications.event_reminder.send", { eventId: eventId("groza.tonight") }, 120);
  confirmedOf("groza.tonight")
    .slice(0, 4)
    .forEach((p, i) => log(p, "rsvp.update", { eventId: eventId("groza.tonight"), status: "CONFIRMED" }, 90 - i * 15));

  // --- Ссылки для документа ---
  const teamCode = (key: string) => `${TEAM_CODE_PREFIX}${key}`;
  const eventPath = (key: string) => `/t/${teamCode(eventSpecs.get(key)!.team)}/event/${eventId(key)}`;
  const links: PlanLink[] = [
    { label: "Гроза — Моё (капитан)", path: `/t/${teamCode("groza")}` },
    { label: "Гроза — вечерняя тренировка без твоего ответа", path: eventPath("groza.tonight") },
    { label: "Гроза — тренировка идёт сейчас", path: eventPath("groza.live") },
    { label: "Гроза — прошлая тренировка, явка не отмечена", path: eventPath("groza.unmarked") },
    { label: "Гроза — турнир на два дня с очками и разбором", path: eventPath("groza.tour") },
    { label: "Гроза — сбор и долги", path: eventPath("groza.rent") },
    { label: "Гроза — длинное название, слоты и гость", path: eventPath("groza.long") },
    { label: "Гроза — без места", path: eventPath("groza.noplace") },
    { label: "Гроза — событие завёл тренер", path: eventPath("groza.bytrainer") },
    { label: "Гроза — занятие серии, которое ты пропускаешь", path: eventPath(skipKey) },
    { label: "Гроза — перенесённое занятие серии", path: eventPath(movedKey) },
    { label: "Гроза — заявки", path: `/t/${teamCode("groza")}/requests` },
    { label: "Гроза — казна", path: `/t/${teamCode("groza")}/money` },
    { label: "Гроза — журнал", path: `/t/${teamCode("groza")}/journal` },
    { label: "Северный ветер — тренировка, где можно напомнить (тренер)", path: eventPath("veter.remind") },
    { label: "Северный ветер — прошлая тренировка, явку отмечает тренер", path: eventPath("veter.past") },
    { label: "Северный ветер — турнир (тренер не меняет)", path: eventPath("veter.tour") },
    { label: "Кобры — завтра, ты идёшь", path: eventPath("kobry.tomorrow") },
    { label: "Кобры — ты думаешь", path: eventPath("kobry.friendly") },
    { label: "Кобры — ты не идёшь", path: eventPath("kobry.trip") },
    { label: "Кобры — казна, твой долг", path: `/t/${teamCode("kobry")}/money` },
    { label: "Тайфун — событие по времени Владивостока", path: eventPath("tayfun.morning") },
    { label: "Новички — пустая команда", path: `/t/${teamCode("novichki")}` },
    { label: "Свободные слоты", path: `/teams` },
    { label: "Сапсан — событие со свободными местами", path: `/teams?event=${eventId("sapsan.free")}` },
    { label: "Сапсан — мест нет", path: `/teams?event=${eventId("sapsan.full")}` },
    { label: "Ястребы — экран ожидания заявки", path: `/join/${stableJoinCode("yastreby")}` },
    { label: "Беркуты — приглашение для тебя", path: `/invite/${inviteToken}` },
    { label: "Консоль владельца", path: `/admin` },
    { label: "Ястребы как владелец платформы (казна в минусе)", path: `/t/${teamCode("yastreby")}/money` },
  ];

  const planTeams: PlanTeam[] = teamsSpec.map((t) => ({
    key: t.key,
    id: teamId(t.key),
    name: `${t.name}${TEAM_NAME_SUFFIX}`,
    shortCode: teamCode(t.key),
    timezone: t.timezone,
    ownerRelation: t.ownerRelation,
    joinCode: stableJoinCode(t.key),
  }));

  return {
    tables: [
      { table: "users", rows: users },
      { table: "user_identities", rows: identities },
      { table: "teams", rows: teams },
      { table: "team_memberships", rows: memberships },
      { table: "team_join_links", rows: joinLinks },
      { table: "team_invites", rows: invites },
      { table: "team_open_schedules", rows: openSchedules },
      { table: "team_followers", rows: followers },
      { table: "event_series", rows: series },
      { table: "events", rows: events },
      { table: "event_series_commitment", rows: commitments },
      { table: "rsvps", rows: rsvps },
      { table: "event_attendance", rows: attendance },
      { table: "event_games", rows: games },
      { table: "game_points", rows: points },
      { table: "game_point_roster", rows: pointRoster },
      { table: "game_reflections", rows: reflections },
      { table: "game_reflection_kills", rows: kills },
      { table: "game_captain_reports", rows: captainReports },
      { table: "transactions", rows: transactions },
      { table: "event_member_charges", rows: charges },
      { table: "event_payment_allocations", rows: allocations },
      { table: "event_slots", rows: slots },
      { table: "event_slot_guests", rows: guests },
      { table: "team_join_requests", rows: joinRequests },
      { table: "team_creation_requests", rows: creationRequests },
      { table: "user_notification_settings", rows: notificationSettings },
      { table: "event_announcements", rows: announcements },
      { table: "notification_deliveries", rows: deliveries },
      { table: "event_auto_reminders", rows: autoReminders },
      { table: "audit_logs", rows: audit },
    ],
    teams: planTeams,
    links,
    teamIds: planTeams.map((t) => t.id),
  };
}
