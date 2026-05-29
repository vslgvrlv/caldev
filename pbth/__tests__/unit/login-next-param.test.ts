import { describe, expect, it } from 'vitest';
import { sanitizeNext } from '../../lib/login-next-param';

describe('sanitizeNext (login open-redirect guard)', () => {
  it('accepts a simple absolute path on this app', () => {
    expect(sanitizeNext('/admin')).toBe('/admin');
    expect(sanitizeNext('/app/calendar')).toBe('/app/calendar');
    expect(sanitizeNext('/app/event/abc-123?tab=rsvp')).toBe('/app/event/abc-123?tab=rsvp');
  });

  it('returns null for empty / nullish input', () => {
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext(undefined)).toBeNull();
    expect(sanitizeNext('')).toBeNull();
    expect(sanitizeNext('   ')).toBeNull();
  });

  it('rejects protocol-relative host injection (`//evil.example`)', () => {
    expect(sanitizeNext('//evil.example')).toBeNull();
    expect(sanitizeNext('//evil.example/admin')).toBeNull();
  });

  it('rejects absolute URLs to other origins', () => {
    expect(sanitizeNext('https://evil.example/admin')).toBeNull();
    expect(sanitizeNext('http://pbthub.ru/admin')).toBeNull();
    expect(sanitizeNext('javascript:alert(1)')).toBeNull();
  });

  it('rejects header-smuggling control chars', () => {
    expect(sanitizeNext('/admin\nLocation: https://evil')).toBeNull();
    expect(sanitizeNext('/admin\r\nset-cookie: x=y')).toBeNull();
    expect(sanitizeNext('/admin\ttab')).toBeNull();
  });

  it('rejects paths longer than 256 chars', () => {
    const long = '/' + 'a'.repeat(256);
    expect(sanitizeNext(long)).toBeNull();
    const justFits = '/' + 'a'.repeat(254);
    expect(sanitizeNext(justFits)).toBe(justFits);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(sanitizeNext('  /admin  ')).toBe('/admin');
  });
});
