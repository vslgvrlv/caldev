import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123:dummy";
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "dummy_bot";

vi.mock("../../db/pool.js", () => ({ query: vi.fn(), pool: { query: vi.fn() } }));

describe("кнопки бота: каталог обработчиков", () => {
  it("префикс — часть callback_data до первого двоеточия", async () => {
    const { callbackPrefix } = await import("../../bot-callbacks/types.js");
    expect(callbackPrefix("pair:approve:123")).toBe("pair");
    expect(callbackPrefix("rsvp")).toBe("rsvp");
    expect(callbackPrefix("")).toBeNull();
    expect(callbackPrefix(":x")).toBeNull();
    expect(callbackPrefix(undefined)).toBeNull();
  });

  it("каталог содержит перенесённый обработчик pair", async () => {
    const { loadBotCallbacks } = await import("../../bot-callbacks/index.js");
    const registry = await loadBotCallbacks();
    expect([...registry.keys()]).toContain("pair");
  });

  it("повтор префикса — ошибка, а не тихая подмена", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pbth-cb-"));
    const body = `export const prefix = "dup"; export async function handle() { return true; }\n`;
    writeFileSync(path.join(dir, "a.mjs"), body);
    writeFileSync(path.join(dir, "b.mjs"), body);
    const { loadBotCallbacks } = await import("../../bot-callbacks/index.js");
    await expect(loadBotCallbacks(dir)).rejects.toThrow(/duplicate prefix/);
  });

  it("неизвестный префикс не обрабатывается", async () => {
    const { dispatchBotCallback } = await import("../../bot-callbacks/index.js");
    expect(await dispatchBotCallback({ callback_query: { id: "1", data: "nosuch:1" } })).toBe(false);
    expect(await dispatchBotCallback({ message: { text: "hi" } })).toBe(false);
  });
});
