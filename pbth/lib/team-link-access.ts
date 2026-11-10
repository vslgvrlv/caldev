import { Role } from '../types';

// Ссылка команды (трек 1): заявки по ней одобряют капитан и тренер (решение
// Василия), поэтому показать её — «Пригласить», лист со ссылкой, кодом, QR и
// «Поделиться» — могут оба. Отозвать и выпустить новую — только капитан
// (владелец платформы в команде — в режиме капитана). Сервер держит то же.

export function teamLinkAccess(role: Role | null | undefined): { canShare: boolean; canRotate: boolean } {
  const canRotate = role === Role.CAPTAIN || role === Role.ADMIN;
  return { canShare: canRotate || role === Role.TRAINER, canRotate };
}
