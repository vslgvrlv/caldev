import { createHash } from "node:crypto";

// Метки тестовых данных сценариев. По ним наполнитель находит своё и только своё.

/** Версия набора: входит в устойчивые id, метку журнала и вывод. */
export const SEED_VERSION = "v1";
/** Метка в `audit_logs.payload.seedScenarios` и в `error_code` служебных строк. */
export const SEED_MARK = `seed-scenarios-${SEED_VERSION}`;
/**
 * Метка в конце названий тестовых команд: «Гроза (тест)». В конце, а не в
 * начале: знак команды берёт первые буквы названия, и с меткой «Тест ·»
 * впереди у всех команд был бы одинаковый знак.
 */
export const TEAM_NAME_SUFFIX = " (тест)";
/** Префикс коротких кодов тестовых команд (адрес `/t/tst-...`). */
export const TEAM_CODE_PREFIX = "tst-";
/** Префикс ников тестовых людей. */
export const TEST_USERNAME_PREFIX = "pbth_test_";
/**
 * Диапазон telegram id тестовых людей. Настоящие id Telegram сейчас меньше
 * 10^10; здесь 7,7·10^12 — заведомо ничей, сообщение на такой id Telegram не
 * доставит никому.
 */
export const TEST_TELEGRAM_BASE = 7_700_000_000_000;
export const TEST_TELEGRAM_RANGE = 10_000;

export function testTelegramId(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n >= TEST_TELEGRAM_RANGE) throw new Error(`test telegram index out of range: ${n}`);
  return String(TEST_TELEGRAM_BASE + n);
}

export function isTestTelegramId(value: string | number | bigint): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n >= TEST_TELEGRAM_BASE && n < TEST_TELEGRAM_BASE + TEST_TELEGRAM_RANGE;
}

/**
 * Устойчивый UUID по ключу: повторный запуск даёт те же id, поэтому ссылки на
 * команды и события из документа сценариев не протухают. Формат — RFC 4122,
 * версия 5 по разметке битов.
 */
export function stableUuid(key: string, salt = ""): string {
  const hex = createHash("sha256").update(`pbth-seed-scenarios/${SEED_VERSION}/${salt}/${key}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

const JOIN_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Код ссылки команды: шесть знаков из алфавита ссылок, устойчивый по ключу. */
export function stableJoinCode(key: string): string {
  const digest = createHash("sha256").update(`pbth-seed-scenarios/${SEED_VERSION}/join/${key}`).digest();
  let code = "";
  for (let i = 0; i < 6; i += 1) code += JOIN_ALPHABET[digest[i] % JOIN_ALPHABET.length];
  return code;
}
