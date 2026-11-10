import { describe, expect, it } from 'vitest';
import { collectExtensions, shellExtensions } from '../../shell/extensions';

const Noop = () => null;

describe('места для треков', () => {
  it('собирает пункты меню, значки и блоки из файлов папки ext по порядку', () => {
    const collected = collectExtensions({
      './ext/track2-rsvp.tsx': {
        default: { id: 't2', eventBlocks: [{ id: 'delivery', Component: Noop }] },
      },
      './ext/track1-requests.tsx': {
        default: {
          id: 't1',
          teamMenu: [
            { id: 'invite', label: 'Ссылка команды', to: () => '/x', order: 20 },
            { id: 'requests', label: 'Заявки', to: () => '/y', order: 10 },
          ],
          headerBadges: [{ id: 'badge', Component: Noop }],
        },
      },
      './ext/broken.ts': {},
    });
    expect(collected.extensions.map((ext) => ext.id)).toEqual(['t1', 't2']);
    expect(collected.teamMenu.map((item) => item.id)).toEqual(['requests', 'invite']);
    expect(collected.headerBadges.map((item) => item.id)).toEqual(['badge']);
    expect(collected.eventBlocks.map((item) => item.id)).toEqual(['delivery']);
  });

  it('папка расширений подключена через import.meta.glob', () => {
    expect(Array.isArray(shellExtensions.extensions)).toBe(true);
  });
});
