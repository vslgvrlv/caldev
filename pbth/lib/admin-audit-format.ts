// #57: человекочитаемые подписи действий аудита вместо технических ключей и JSON.
// Капитанам /admin не нужен по курсу A, но и оператору (Василию) проще читать.

const ACTION_LABELS: Record<string, string> = {
  'admin.v1.events.create': 'Создано событие',
  'admin.v1.events.patch': 'Изменено событие',
  'admin.v1.events.registration.upsert': 'Обновлена регистрация',
  'admin.v1.events.schedule.import': 'Импортировано расписание',
  'admin.v1.team.members.patch': 'Изменён участник команды',
  'admin.user.patch': 'Изменён пользователь',
  'admin.membership.delete': 'Удалён участник',
  'admin.invite.revoke': 'Отозвано приглашение',
  'admin.team.delete': 'Удалена команда',
  'notifications.event_reminder.send': 'Отправлены напоминания о событии',
  'notifications.team_debt_reminder.send': 'Отправлены напоминания должникам',
};

export function humanizeAuditAction(action: string): string {
  return ACTION_LABELS[action] || action;
}
