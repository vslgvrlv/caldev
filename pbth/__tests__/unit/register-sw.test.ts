// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { readFileSync } from 'node:fs';
// @ts-ignore local test runtime provides Node built-ins, but the project does not ship @types/node
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_PROMPT_ID,
  showUpdatePrompt,
  startServiceWorker,
  watchForUpdates,
} from '../../lib/register-sw';

// В проекте нет jsdom, а плашка обновления рисуется прямым DOM — намеренно, без
// React: она должна работать и тогда, когда приложение само упало на устаревшем
// куске кода. Поэтому документ здесь поддельный, ровно на те вызовы, что нужны.
class FakeElement {
  id = '';
  className = '';
  textContent: string | null = '';
  disabled = false;
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  private handlers: Record<string, Array<() => void>> = {};

  constructor(public tagName: string) {}

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  appendChild(child: FakeElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  addEventListener(type: string, handler: () => void) {
    (this.handlers[type] ||= []).push(handler);
  }
  click() {
    if (this.disabled) return;
    (this.handlers.click || []).forEach((handler) => handler());
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  find(predicate: (el: FakeElement) => boolean): FakeElement | null {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
  get text(): string {
    return [this.textContent || '', ...this.children.map((child) => child.text)].join(' ').trim();
  }
}

class FakeDocument {
  body = new FakeElement('body');
  visibilityState: 'visible' | 'hidden' = 'visible';
  private handlers: Record<string, Array<() => void>> = {};

  createElement(tag: string) {
    return new FakeElement(tag);
  }
  getElementById(id: string) {
    return this.body.find((el) => el.id === id);
  }
  addEventListener(type: string, handler: () => void) {
    (this.handlers[type] ||= []).push(handler);
  }
  emit(type: string) {
    (this.handlers[type] || []).forEach((handler) => handler());
  }
}

const asDoc = (doc: FakeDocument) => doc as unknown as Document;
const button = (doc: FakeDocument, label: string) =>
  doc.body.find((el) => el.tagName === 'button' && el.textContent === label) as FakeElement;

describe('плашка «Доступна новая версия»', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('появляется в документе и говорит человеческими словами', () => {
    const doc = new FakeDocument();
    showUpdatePrompt(asDoc(doc), () => undefined);

    const prompt = doc.getElementById(UPDATE_PROMPT_ID);
    expect(prompt).not.toBeNull();
    expect(prompt!.text).toContain('Доступна новая версия');
    expect(button(doc, 'Обновить')).toBeTruthy();
    expect(button(doc, 'Позже')).toBeTruthy();
  });

  it('читается вспомогательными технологиями как статус', () => {
    const doc = new FakeDocument();
    showUpdatePrompt(asDoc(doc), () => undefined);
    expect(doc.getElementById(UPDATE_PROMPT_ID)!.attributes.role).toBe('status');
  });

  it('второй вызов не плодит плашки', () => {
    const doc = new FakeDocument();
    showUpdatePrompt(asDoc(doc), () => undefined);
    showUpdatePrompt(asDoc(doc), () => undefined);
    expect(doc.body.children.filter((el) => el.id === UPDATE_PROMPT_ID)).toHaveLength(1);
  });

  it('«Обновить» запускает обновление один раз и показывает, что идёт работа', () => {
    const doc = new FakeDocument();
    const accept = vi.fn(() => new Promise<void>(() => undefined));
    showUpdatePrompt(asDoc(doc), accept);

    const update = button(doc, 'Обновить');
    update.click();
    update.click();

    expect(accept).toHaveBeenCalledTimes(1);
    expect(update.disabled).toBe(true);
    expect(update.textContent).toBe('Обновляем…');
  });

  it('если обновление не началось, кнопка снова нажимается', async () => {
    const doc = new FakeDocument();
    const accept = vi.fn(() => Promise.reject(new Error('нет ожидающей версии')));
    showUpdatePrompt(asDoc(doc), accept);

    const update = button(doc, 'Обновить');
    update.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(update.disabled).toBe(false);
    expect(update.textContent).toBe('Обновить');
  });

  it('если страница так и не перезагрузилась, через несколько секунд даёт нажать ещё раз', async () => {
    const doc = new FakeDocument();
    showUpdatePrompt(asDoc(doc), () => new Promise<void>(() => undefined));

    const update = button(doc, 'Обновить');
    update.click();
    expect(update.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(update.disabled).toBe(false);
    expect(update.textContent).toBe('Обновить');
  });

  it('«Позже» убирает плашку и ничего не обновляет', () => {
    const doc = new FakeDocument();
    const accept = vi.fn();
    showUpdatePrompt(asDoc(doc), accept);

    button(doc, 'Позже').click();

    expect(doc.getElementById(UPDATE_PROMPT_ID)).toBeNull();
    expect(accept).not.toHaveBeenCalled();
  });
});

describe('регистрация сервис-воркера показывает плашку сама', () => {
  it('новая версия готова — плашка появляется, «Обновить» применяет её с перезагрузкой', () => {
    const doc = new FakeDocument();
    const updateSW = vi.fn(async () => undefined);
    let options: Record<string, (...args: any[]) => void> = {};
    const registerSW = vi.fn((opts: Record<string, (...args: any[]) => void>) => {
      options = opts;
      return updateSW;
    });

    startServiceWorker(registerSW as any, asDoc(doc));
    expect(doc.getElementById(UPDATE_PROMPT_ID)).toBeNull();

    options.onNeedRefresh();
    expect(doc.getElementById(UPDATE_PROMPT_ID)).not.toBeNull();

    button(doc, 'Обновить').click();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('регистрируется сразу, а не после загрузки страницы', () => {
    const registerSW = vi.fn(() => (async () => undefined) as any);
    startServiceWorker(registerSW as any, asDoc(new FakeDocument()));
    expect(registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }));
  });
});

describe('проверка обновлений у долго открытого приложения', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('раз в полчаса спрашивает, нет ли новой версии', async () => {
    const doc = new FakeDocument();
    const registration = { update: vi.fn(async () => undefined) };
    watchForUpdates(registration as any, asDoc(doc));

    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('при возврате в приложение проверяет, если давно не проверяли', async () => {
    const doc = new FakeDocument();
    const registration = { update: vi.fn(async () => undefined) };
    watchForUpdates(registration as any, asDoc(doc));

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    doc.visibilityState = 'visible';
    doc.emit('visibilitychange');

    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('частые переключения не заваливают сервер проверками', async () => {
    const doc = new FakeDocument();
    const registration = { update: vi.fn(async () => undefined) };
    watchForUpdates(registration as any, asDoc(doc));

    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(10_000);
      doc.emit('visibilitychange');
    }

    expect(registration.update).not.toHaveBeenCalled();
  });

  it('свёрнутое приложение не проверяет', async () => {
    const doc = new FakeDocument();
    const registration = { update: vi.fn(async () => undefined) };
    watchForUpdates(registration as any, asDoc(doc));

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');

    expect(registration.update).not.toHaveBeenCalled();
  });

  it('без сети проверка падает тихо', async () => {
    const doc = new FakeDocument();
    const registration = { update: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) };
    watchForUpdates(registration as any, asDoc(doc));

    await expect(vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)).resolves.not.toThrow();
    expect(registration.update).toHaveBeenCalled();
  });

  it('без регистрации (сборка без сервис-воркера) ничего не делает', () => {
    expect(() => watchForUpdates(undefined, asDoc(new FakeDocument()))).not.toThrow();
  });
});

// Корень белого экрана — режим autoUpdate: новая версия включается молча и
// стирает старые куски кода из-под открытого приложения. Настройка живёт в
// конфиге сборки, поэтому проверяем её там же, где проверены соседние.
describe('режим обновления в конфиге сборки', () => {
  const source = readFileSync(fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf8');

  it('новая версия ждёт согласия человека, а не включается молча', () => {
    expect(source).toContain("registerType: 'prompt'");
    expect(source).not.toContain("registerType: 'autoUpdate'");
  });
});
