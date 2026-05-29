import { describe, it, expect } from 'vitest';
import { buildRecurrence } from '../../lib/recurrence';

describe('buildRecurrence', () => {
  it('returns kind "none" when disabled (ignores other fields)', () => {
    expect(buildRecurrence({ enabled: false, weekdays: ['MON'], untilDate: '2026-06-01' })).toEqual({
      kind: 'none',
    });
  });

  it('returns ok payload when enabled with weekdays and untilDate', () => {
    expect(buildRecurrence({ enabled: true, weekdays: ['TUE', 'THU'], untilDate: '2026-07-01' })).toEqual({
      kind: 'ok',
      value: { enabled: true, weekdays: ['TUE', 'THU'], untilDate: '2026-07-01' },
    });
  });

  it('errors when enabled but no weekdays chosen', () => {
    const result = buildRecurrence({ enabled: true, weekdays: [], untilDate: '2026-07-01' });
    expect(result.kind).toBe('error');
  });

  it('errors when enabled but untilDate is missing', () => {
    const result = buildRecurrence({ enabled: true, weekdays: ['MON'], untilDate: '' });
    expect(result.kind).toBe('error');
  });

  it('errors when untilDate is not YYYY-MM-DD', () => {
    const result = buildRecurrence({ enabled: true, weekdays: ['MON'], untilDate: '01.06.2026' });
    expect(result.kind).toBe('error');
  });
});
