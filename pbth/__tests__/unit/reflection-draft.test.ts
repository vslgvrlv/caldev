import { describe, expect, it } from 'vitest';
import { DRAFT_TTL_MS, chooseReflectionDraft, reflectionDraftKey } from '../../lib/reflection-draft';

const now = 1_700_000_000_000;

describe('выбор между черновиком и сохранённой рефлексией', () => {
  it('черновика нет — показываем сохранённое', () => {
    expect(chooseReflectionDraft(null, { note: 'сервер' }, now)).toEqual({ note: 'сервер' });
  });

  it('нет ни того, ни другого — форма пустая', () => {
    expect(chooseReflectionDraft(null, null, now)).toBeNull();
  });

  // Незаконченный черновик нигде не сохранён — это единственная копия работы.
  // Сохранённая версия уже лежит на сервере и от перекрытия не пострадает.
  it('свежий черновик побеждает сохранённое', () => {
    const local = { value: { note: 'черновик' }, savedAt: now - 60_000 };
    expect(chooseReflectionDraft(local, { note: 'сервер' }, now)).toEqual({ note: 'черновик' });
  });

  // Турнир — один день. Черновик старше суток остался от прошлого выезда, и
  // поднимать его поверх заполненной рефлексии значит подсунуть чужой пойнт.
  it('черновик прошлого турнира не поднимается', () => {
    const local = { value: { note: 'позапрошлый выезд' }, savedAt: now - DRAFT_TTL_MS - 1 };
    expect(chooseReflectionDraft(local, { note: 'сервер' }, now)).toEqual({ note: 'сервер' });
  });

  it('на границе суток черновик ещё жив', () => {
    const local = { value: { note: 'вчера вечером' }, savedAt: now - DRAFT_TTL_MS };
    expect(chooseReflectionDraft(local, null, now)).toEqual({ note: 'вчера вечером' });
  });

  it('ключ разводит пойнты между собой', () => {
    expect(reflectionDraftKey('p1')).not.toBe(reflectionDraftKey('p2'));
  });
});
