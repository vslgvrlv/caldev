import { describe, expect, it } from 'vitest';
import { buildInviteLink } from '../../lib/team-invite-link';

describe('buildInviteLink', () => {
  it('builds an /invite/<token> link from the given origin', () => {
    expect(buildInviteLink('https://pbthub.ru', 'abc123')).toBe('https://pbthub.ru/invite/abc123');
  });

  it('trims a trailing slash on the origin so the link is not doubled', () => {
    expect(buildInviteLink('https://pbthub.ru/', 'abc123')).toBe('https://pbthub.ru/invite/abc123');
  });

  it('falls back to the production origin when no origin is provided', () => {
    expect(buildInviteLink('', 'tok')).toBe('https://pbthub.ru/invite/tok');
    expect(buildInviteLink(undefined, 'tok')).toBe('https://pbthub.ru/invite/tok');
  });

  it('url-encodes the token so a stray character cannot break the path', () => {
    expect(buildInviteLink('https://pbthub.ru', 'a b/c')).toBe('https://pbthub.ru/invite/a%20b%2Fc');
  });
});
