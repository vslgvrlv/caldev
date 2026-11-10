import { describe, expect, it } from 'vitest';
import { describeInviteProblem } from '../../lib/invite-problem';

const apiError = (code: string, detail: string) => Object.assign(new Error(detail), { code, detail });

// Старая ссылка /invite/<ID команды> раньше предлагала «вступить напрямую».
// Теперь человек видит, что ссылка устарела и что делать — попросить новую.
describe('describeInviteProblem', () => {
  it('старая ссылка с ID команды — «устарела, попросите новую»', () => {
    const text = describeInviteProblem(apiError('INVITE_NOT_FOUND', 'Invite not found'));
    expect(text).toMatch(/устарела/);
    expect(text).toMatch(/капитана новую/);
    expect(text).not.toMatch(/напрямую/);
  });

  it('истёкшее и отозванное приглашение — свой понятный текст', () => {
    expect(describeInviteProblem(apiError('INVITE_EXPIRED', 'Invite expired'))).toMatch(/истёк/);
    expect(describeInviteProblem(apiError('INVITE_REVOKED', 'Invite is revoked'))).toMatch(/отозвал/);
    expect(describeInviteProblem(apiError('INVITE_REQUIRED', 'Joining a team requires a valid invite'))).toMatch(/устарела/);
  });

  it('прочие ошибки — не про приглашение', () => {
    expect(describeInviteProblem(apiError('AUTH_REQUIRED', 'Authentication required'))).toBeNull();
    expect(describeInviteProblem(new Error('HTTP 500'))).toBeNull();
    expect(describeInviteProblem(null)).toBeNull();
  });
});
