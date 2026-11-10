import type { Request } from "express";
import { query } from "../db/pool.js";
import { isPlatformOwner, markOwnerAccess, type TeamRole } from "./team-access.js";

// Доступ к событию — трек 3 ревизии 11.11.2026.
//
// Ручки по событию (`/events/:eventId/*`, рефлексии, деньги события) раньше
// смотрели только членство в команде события. `resolveEventAccess` отвечает,
// кто перед нами:
//   - участник команды события — роль из состава (`via: 'membership'`);
//   - владелец платформы без членства — права капитана (`via: 'owner'`,
//     решение Василия 10.11.2026, п. 11). Событие само называет команду, так
//     что это явная команда в запросе, как параметр `/teams/:teamId`. Его
//     действия в этом запросе помечаются в журнале;
//   - кто-то ещё, кого признал зарегистрированный поставщик доступа (трек 4 —
//     «гость события» с правом только на чтение);
//   - никто — `null`.
//
// Поставщики подключаются из своих модулей через `registerEventAccessProvider`,
// этот файл ради них не меняется. Порядок: членство → владелец → поставщики в
// порядке регистрации. Первый ответивший побеждает: участник команды остаётся
// участником, даже если он ещё и гость.

export type EventAccessVia = "membership" | "owner" | (string & {});

export type EventAccess = {
  eventId: string;
  teamId: string;
  /** Роль в команде события. `null` — не участник (например, гость). */
  role: TeamRole | null;
  membershipId: string | null;
  via: EventAccessVia;
  /** Только чтение события: ни правки, ни денег, ни разбора. */
  readOnly: boolean;
};

export type EventAccessGrant = {
  /** Как назвать доступ в ответах и журнале, например `guest`. */
  via: string;
  role?: TeamRole | null;
  readOnly: boolean;
};

export type EventAccessProviderInput = {
  req: Request;
  userId: string;
  eventId: string;
  teamId: string;
};

export type EventAccessProvider = {
  name: string;
  resolve: (input: EventAccessProviderInput) => Promise<EventAccessGrant | null>;
};

const providers: EventAccessProvider[] = [];

/**
 * Подключить поставщика доступа. Повторная регистрация того же имени заменяет
 * прежнего (модуль мог загрузиться дважды в тестах). Возвращает отключение.
 */
export function registerEventAccessProvider(provider: EventAccessProvider): () => void {
  const existing = providers.findIndex((item) => item.name === provider.name);
  if (existing >= 0) providers.splice(existing, 1, provider);
  else providers.push(provider);
  return () => {
    const index = providers.indexOf(provider);
    if (index >= 0) providers.splice(index, 1);
  };
}

export function listEventAccessProviders(): string[] {
  return providers.map((provider) => provider.name);
}

/** Команда события. `null` — события нет. Отменённые тоже находятся: фильтр — дело ручки. */
export async function findEventTeam(eventId: string): Promise<string | null> {
  const result = await query<{ team_id: string }>(`SELECT team_id FROM events WHERE id = $1`, [eventId]);
  return result.rows[0]?.team_id ?? null;
}

/**
 * Кто перед нами в событии. `null` — события нет или доступа к нему нет:
 * ручки сами решают, отвечать 404 или 403.
 */
export async function resolveEventAccess(req: Request, eventId: string): Promise<EventAccess | null> {
  const userId = req.authUser?.id;
  if (!userId) return null;

  const teamId = await findEventTeam(eventId);
  if (!teamId) return null;

  const membership = await query<{ id: string; role: TeamRole }>(
    `SELECT id, role::text AS role FROM team_memberships WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );
  if (membership.rows[0]) {
    return {
      eventId,
      teamId,
      role: membership.rows[0].role,
      membershipId: membership.rows[0].id,
      via: "membership",
      readOnly: false,
    };
  }

  if (isPlatformOwner(req)) {
    markOwnerAccess(teamId);
    return { eventId, teamId, role: "CAPTAIN", membershipId: null, via: "owner", readOnly: false };
  }

  for (const provider of providers) {
    const grant = await provider.resolve({ req, userId, eventId, teamId });
    if (grant) {
      return {
        eventId,
        teamId,
        role: grant.role ?? null,
        membershipId: null,
        via: grant.via,
        readOnly: grant.readOnly,
      };
    }
  }
  return null;
}

const TRAINER_MANAGEABLE_EVENT_TYPES = new Set(["TRAINING", "MEETING"]);

/** Правка и удаление события: капитан — любое, тренер — тренировки и собрания. */
export function canManageEvent(access: EventAccess, eventType: string): boolean {
  if (access.readOnly) return false;
  if (access.role === "CAPTAIN") return true;
  if (access.role === "TRAINER") return TRAINER_MANAGEABLE_EVENT_TYPES.has(eventType);
  return false;
}

/** Роль в команде для проверок, которым гость не положен: только при полном доступе. */
export function teamRoleOf(access: EventAccess | null): TeamRole | null {
  if (!access || access.readOnly) return null;
  return access.role;
}
