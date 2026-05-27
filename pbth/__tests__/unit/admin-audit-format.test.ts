import { describe, it, expect } from 'vitest';
import { humanizeAuditAction } from '../../lib/admin-audit-format';

describe('humanizeAuditAction', () => {
  it('maps known admin actions to human Russian text', () => {
    expect(humanizeAuditAction('admin.v1.events.create')).toBe('Создано событие');
    expect(humanizeAuditAction('admin.v1.team.members.patch')).toBe('Изменён участник команды');
    expect(humanizeAuditAction('notifications.event_reminder.send')).toBe('Отправлены напоминания о событии');
  });

  it('falls back to the raw action for unknown keys (no crash)', () => {
    expect(humanizeAuditAction('some.unknown.action')).toBe('some.unknown.action');
  });
});
