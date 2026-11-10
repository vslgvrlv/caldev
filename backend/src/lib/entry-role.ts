import type { Request } from "express";
import { env } from "../config/env.js";
import type { AuthUser } from "../middleware/auth.js";

// Режима учётной записи «админ или игрок» больше нет (решение Василия
// 10.11.2026, п. 2; трек 3 ревизии). Права владельца платформы определяются
// тем, кто он — список `ADMIN_ROLE_ALLOWLIST_*` и доверенный способ входа
// (`isPlatformOwner` в `lib/team-access.ts`), а не переключателем в сессии.
//
// `getEffectiveEntryRole` оставлен, чтобы не трогать ручки других треков:
// он всегда отвечает «USER», и ветки «ADMIN» в них больше не срабатывают.
// Владелец действует в чужой команде через явную команду в запросе
// (`resolveTeamAccess`, `resolveEventAccess`), консоль — ручки `/platform`.
// `session.entryRole` и `users.account_role` больше ни на что не влияют.

export type EntryRole = "ADMIN" | "USER";

/** Входит ли человек в список владельцев платформы (без проверки способа входа). */
export function canChooseAdminRole(user: Pick<AuthUser, "telegram_id" | "username">): boolean {
  const username = (user.username || "").toLowerCase();
  return env.adminRoleAllowlist.telegramIds.includes(user.telegram_id) || env.adminRoleAllowlist.usernames.includes(username);
}

// Тип ответа прежний (с `null`), чтобы сравнения в чужих модулях компилировались.
export function getEffectiveEntryRole(_req: Request, _user: Pick<AuthUser, "telegram_id" | "username">): EntryRole | null {
  return "USER" as EntryRole | null;
}
