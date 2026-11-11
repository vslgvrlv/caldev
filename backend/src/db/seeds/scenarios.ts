// Наполнитель тестовых сценариев PBTH: команды, люди и события, на которых
// главный человек (существующий аккаунт) проходит большую часть действий
// приложения в разных ролях. Что внутри — docs/scenarios.md.
//
//   SEED_SCENARIOS_ALLOW=local   npm run db:seed:scenarios -- --owner-telegram-id 9000000101
//   SEED_SCENARIOS_ALLOW=staging node dist/db/seeds/scenarios.js --owner-telegram-id <id>
//
// Режимы: без флагов — записать (повторный запуск возвращает набор в исходное
// состояние, id те же); `--dry-run` — только показать; `--remove` — убрать всё
// тестовое и только его. Защита от прода — `./scenarios/guard.ts`.
//
// Сообщений никому не шлёт: пишет прямо в базу, мимо ручек, которые рассылают
// уведомления, и заранее занимает авто-напоминания о тестовых событиях
// (см. `plan.ts`, раздел «Авто-напоминания»).

import pg from "pg";
import { applyPlan, countScope, removeScope, resolveScope, type ScopeCounts } from "./scenarios/apply.js";
import { checkConnectedDatabase, checkSeedTarget } from "./scenarios/guard.js";
import { isTestTelegramId, SEED_MARK } from "./scenarios/ids.js";
import { buildScenarioPlan } from "./scenarios/plan.js";

type Args = {
  ownerTelegramId: string | null;
  ownerUserId: string | null;
  dryRun: boolean;
  remove: boolean;
  help: boolean;
};

const USAGE = `Наполнитель тестовых сценариев PBTH.

  SEED_SCENARIOS_ALLOW=local|staging node dist/db/seeds/scenarios.js --owner-telegram-id <id> [--dry-run]
  SEED_SCENARIOS_ALLOW=local|staging node dist/db/seeds/scenarios.js --remove [--dry-run]

  --owner-telegram-id <id>  главный человек по telegram id (должен уже существовать)
  --owner-user-id <uuid>    главный человек по id пользователя
  --dry-run                 ничего не писать, показать, что будет сделано
  --remove                  удалить только тестовые данные наполнителя
`;

function parseArgs(argv: string[]): Args {
  const args: Args = { ownerTelegramId: null, ownerUserId: null, dryRun: false, remove: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw new Error(`${a}: нужно значение`);
      i += 1;
      return v;
    };
    if (a === "--owner-telegram-id") args.ownerTelegramId = value();
    else if (a.startsWith("--owner-telegram-id=")) args.ownerTelegramId = a.split("=")[1];
    else if (a === "--owner-user-id") args.ownerUserId = value();
    else if (a.startsWith("--owner-user-id=")) args.ownerUserId = a.split("=")[1];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--remove") args.remove = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Неизвестный параметр ${a}`);
  }
  return args;
}

function printCounts(title: string, counts: ScopeCounts) {
  console.log(title);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(26)} ${n}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  // Сначала окружение, потом параметры: на проде отказ при любых флагах.
  const check = checkSeedTarget(process.env, argv);
  if (!check.ok || !check.target) {
    console.error("ОТКАЗ: наполнитель сценариев не будет работать с этой базой.");
    for (const reason of check.reasons) console.error(`  - ${reason}`);
    if (check.prodMarkers.length > 0) console.error("  Признаки прода: отказ не отключается никаким флагом.");
    process.exitCode = 2;
    return;
  }
  const target = check.target;
  const args = parseArgs(argv);
  if (!args.remove && !args.ownerTelegramId && !args.ownerUserId) {
    console.error("Нужен главный человек: --owner-telegram-id <id> или --owner-user-id <uuid>.\n");
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const pool = new pg.Pool({
    host: target.host,
    port: target.port,
    user: target.user,
    password: process.env.DB_PASSWORD ?? "pbth",
    database: target.database,
    ssl: ["1", "true"].includes(String(process.env.DB_SSL ?? "").toLowerCase()) ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  const client = await pool.connect();
  try {
    const info = await client.query<{ db: string; version: string }>(
      `SELECT current_database() AS db, current_setting('server_version') AS version`
    );
    const connectedDb = info.rows[0].db;
    const dbProblems = checkConnectedDatabase(target, connectedDb);
    if (dbProblems.length > 0) {
      console.error("ОТКАЗ после подключения:");
      for (const p of dbProblems) console.error(`  - ${p}`);
      process.exitCode = 2;
      return;
    }

    const action = args.dryRun ? "Смотрю (ничего не пишу)" : args.remove ? "Удаляю тестовые данные из базы" : "Пишу в базу";
    console.log(`${action}: ${target.host}:${target.port}/${connectedDb} (Postgres ${info.rows[0].version})`);
    console.log(`Режим: SEED_SCENARIOS_ALLOW=${target.mode}; адрес приложения: ${target.frontendUrl || "не задан"}; метка: ${SEED_MARK}`);

    const fixedTeamIds = buildScenarioPlan({ now: new Date(), ownerUserId: "00000000-0000-4000-8000-000000000000" }).teamIds;

    if (args.remove) {
      const scope = await resolveScope(client, fixedTeamIds);
      const counts = await countScope(client, scope);
      printCounts(args.dryRun ? "Будет удалено:" : "Удаляю:", counts);
      if (args.dryRun) return;
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('pbth-seed-scenarios'))`);
      await removeScope(client, await resolveScope(client, fixedTeamIds));
      const after = await countScope(client, await resolveScope(client, fixedTeamIds));
      await client.query("COMMIT");
      printCounts("Осталось после удаления:", after);
      return;
    }

    const owner = await client.query<{ id: string; name: string; telegram_id: string; is_active: boolean }>(
      args.ownerUserId
        ? `SELECT id, name, telegram_id::text, is_active FROM users WHERE id = $1::uuid`
        : `SELECT id, name, telegram_id::text, is_active FROM users WHERE telegram_id = $1::bigint`,
      [args.ownerUserId ?? args.ownerTelegramId]
    );
    const ownerRow = owner.rows[0];
    if (!ownerRow) {
      console.error("Главный человек не найден. Наполнитель его не создаёт: пусть он сначала войдёт в приложение.");
      process.exitCode = 3;
      return;
    }
    if (isTestTelegramId(ownerRow.telegram_id)) {
      console.error("Главный человек — тестовый пользователь наполнителя. Укажи настоящий аккаунт.");
      process.exitCode = 3;
      return;
    }
    if (!ownerRow.is_active) {
      console.error("Аккаунт главного человека выключен (is_active = false).");
      process.exitCode = 3;
      return;
    }
    console.log(`Главный человек: ${ownerRow.name} (id ${ownerRow.id}, telegram ${ownerRow.telegram_id})`);

    const plan = buildScenarioPlan({ now: new Date(), ownerUserId: ownerRow.id });
    const existing = await countScope(client, await resolveScope(client, plan.teamIds));
    const existingTotal = Object.values(existing).reduce((a, b) => a + b, 0);

    if (args.dryRun) {
      console.log(existingTotal > 0 ? "В базе уже есть тестовый набор — он будет заменён таким же." : "Тестового набора в базе нет.");
      console.log("Будет записано:");
      for (const { table, rows } of plan.tables) console.log(`  ${table.padEnd(26)} ${rows.length}`);
      console.log("Команды и роль главного человека:");
      for (const t of plan.teams) console.log(`  ${t.name} (${t.shortCode}, ${t.timezone}): ${t.ownerRelation}`);
      return;
    }

    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('pbth-seed-scenarios'))`);
    await applyPlan(client, plan, ownerRow.id);
    const counts = await countScope(client, await resolveScope(client, plan.teamIds));
    await client.query("COMMIT");

    printCounts("Готово. В базе тестовых строк:", counts);
    console.log("Команды:");
    for (const t of plan.teams) console.log(`  ${t.name} — ${t.ownerRelation}; ссылка команды /join/${t.joinCode}`);
    const base = target.frontendUrl.replace(/\/+$/, "");
    console.log("Куда смотреть:");
    for (const link of plan.links) console.log(`  ${link.label}: ${base}${link.path}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
