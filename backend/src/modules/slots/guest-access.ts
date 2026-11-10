import { registerEventAccessProvider } from "../../lib/event-access.js";
import { hasGuestEventAccess } from "./service.js";

// «Гость события» для `resolveEventAccess` (трек 3, `lib/event-access.ts`).
// Записанный в слот человек читает это событие — время, место, игры, кто
// идёт — до его окончания. Только чтение: ни правки, ни явки, ни денег, ни
// разбора; состав, казна и другие события команды ему закрыты. Подключается
// при загрузке модуля `/slots` (импорт из `routes.ts`).
export const SLOT_GUEST_PROVIDER = "slots-guest";

export const unregisterSlotGuestAccess = registerEventAccessProvider({
  name: SLOT_GUEST_PROVIDER,
  resolve: async ({ userId, eventId }) =>
    (await hasGuestEventAccess(userId, eventId)) ? { via: "guest", readOnly: true } : null,
});
