import type { PoolClient } from "pg";
import { pool } from "../pool.js";

const DEMO_TAG = "[DEMO_SEED_V2]";
const DEMO_SCOPE = "DEMO_SEED";

type Role = "CAPTAIN" | "TRAINER" | "PLAYER";
type PlayerStatus = "ACTIVE" | "INJURED" | "RESERVE" | "VACATION";
type EventType =
  | "TRAINING"
  | "TOURNAMENT"
  | "CHAMPIONSHIP"
  | "FRIENDLY_MATCH"
  | "MEETING"
  | "MAINTENANCE"
  | "OTHER";
type RsvpStatus = "PENDING" | "CONFIRMED" | "DECLINED";
type CostStatus = "UNKNOWN" | "ESTIMATED" | "FINAL";
type FinanceState = "NOT_CALCULATED" | "COLLECTING" | "CLOSED";
type TxType = "DEPOSIT" | "EXPENSE" | "FEE";
type TxStatus = "PENDING" | "COMPLETED";

type SchemaFlags = {
  hasTeamTimezone: boolean;
  hasEventSeries: boolean;
  hasEventCostStatus: boolean;
  hasEventFinanceState: boolean;
  hasEventIdInTransactions: boolean;
  hasIdempotencyKeyInTransactions: boolean;
  hasIdempotencyScopeInTransactions: boolean;
  hasEventMemberCharges: boolean;
  hasChargesIdempotency: boolean;
  hasEventPaymentAllocations: boolean;
  hasAllocationsIdempotency: boolean;
  hasEventGames: boolean;
};

type UserSeed = {
  key: string;
  telegramId: string;
  username: string;
  name: string;
  nickname: string;
  avatar: string;
};

type TeamSeed = {
  key: string;
  name: string;
  shortCode: string;
  budget: number;
  timezone: string;
};

type MembershipSeed = {
  userKey: string;
  teamKey: string;
  role: Role;
  status: PlayerStatus;
  balance: number;
};

type EventSeed = {
  key: string;
  teamKey: string;
  type: EventType;
  title: string;
  description: string;
  dayOffset: number;
  startHour: number;
  startMinute: number;
  durationMinutes: number;
  location: string;
  cost: number | null;
  costStatus?: CostStatus;
  financeState?: FinanceState;
};

type TransactionSeed = {
  key: string;
  teamKey: string;
  type: TxType;
  amount: number;
  title: string;
  dayOffset: number;
  userKey?: string;
  status: TxStatus;
  eventKey?: string;
  createdByKey: string;
};

function toIsoUtc(dayOffset: number, hour: number, minute: number): string {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + dayOffset);
  base.setUTCHours(hour, minute, 0, 0);
  return base.toISOString();
}

function plusMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

async function columnExists(client: PoolClient, table: string, column: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [table, column]
  );
  return Boolean(result.rows[0]?.exists);
}

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = $1
     ) AS exists`,
    [table]
  );
  return Boolean(result.rows[0]?.exists);
}

async function detectSchema(client: PoolClient): Promise<SchemaFlags> {
  return {
    hasTeamTimezone: await columnExists(client, "teams", "timezone"),
    hasEventSeries: await tableExists(client, "event_series"),
    hasEventCostStatus: await columnExists(client, "events", "cost_status"),
    hasEventFinanceState: await columnExists(client, "events", "finance_state"),
    hasEventIdInTransactions: await columnExists(client, "transactions", "event_id"),
    hasIdempotencyKeyInTransactions: await columnExists(client, "transactions", "idempotency_key"),
    hasIdempotencyScopeInTransactions: await columnExists(client, "transactions", "idempotency_scope"),
    hasEventMemberCharges: await tableExists(client, "event_member_charges"),
    hasChargesIdempotency: await columnExists(client, "event_member_charges", "idempotency_key"),
    hasEventPaymentAllocations: await tableExists(client, "event_payment_allocations"),
    hasAllocationsIdempotency: await columnExists(client, "event_payment_allocations", "idempotency_key"),
    hasEventGames: await tableExists(client, "event_games"),
  };
}

async function upsertUser(client: PoolClient, seed: UserSeed): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, nickname, avatar, account_role, role_selected_at, is_active)
     VALUES ($1::bigint, $2, $3, $4, $5, 'USER', NOW(), TRUE)
     ON CONFLICT (telegram_id)
     DO UPDATE SET
       username = EXCLUDED.username,
       name = EXCLUDED.name,
       nickname = EXCLUDED.nickname,
       avatar = EXCLUDED.avatar,
       account_role = COALESCE(users.account_role, 'USER'),
       role_selected_at = COALESCE(users.role_selected_at, NOW()),
       is_active = TRUE,
       updated_at = NOW()
     RETURNING id`,
    [seed.telegramId, seed.username, seed.name, seed.nickname, seed.avatar]
  );
  return result.rows[0].id;
}

async function upsertTeam(client: PoolClient, seed: TeamSeed, flags: SchemaFlags): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO teams (name, short_code, budget)
     VALUES ($1, $2, $3::numeric)
     ON CONFLICT (short_code)
     DO UPDATE SET
       name = EXCLUDED.name,
       budget = EXCLUDED.budget,
       updated_at = NOW()
     RETURNING id`,
    [seed.name, seed.shortCode, seed.budget]
  );
  const teamId = result.rows[0].id;

  if (flags.hasTeamTimezone) {
    await client.query(`UPDATE teams SET timezone = $2, updated_at = NOW() WHERE id = $1`, [teamId, seed.timezone]);
  }

  return teamId;
}

async function upsertMembership(client: PoolClient, params: { userId: string; teamId: string; role: Role; status: PlayerStatus; balance: number }) {
  await client.query(
    `INSERT INTO team_memberships (user_id, team_id, role, status, balance)
     VALUES ($1, $2, $3::membership_role, $4::player_status, $5::numeric)
     ON CONFLICT (user_id, team_id)
     DO UPDATE SET
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       balance = EXCLUDED.balance,
       updated_at = NOW()`,
    [params.userId, params.teamId, params.role, params.status, params.balance]
  );
}

async function clearPreviousDemoData(client: PoolClient, teamIds: string[], flags: SchemaFlags) {
  if (flags.hasIdempotencyScopeInTransactions) {
    await client.query(
      `DELETE FROM transactions
       WHERE team_id = ANY($1::uuid[])
         AND idempotency_scope = $2`,
      [teamIds, DEMO_SCOPE]
    );
  } else {
    await client.query(
      `DELETE FROM transactions
       WHERE team_id = ANY($1::uuid[])
         AND title LIKE 'DEMO:%'`,
      [teamIds]
    );
  }

  await client.query(
    `DELETE FROM events
     WHERE team_id = ANY($1::uuid[])
       AND (title LIKE 'DEMO:%' OR description LIKE $2)`,
    [teamIds, `%${DEMO_TAG}%`]
  );

  if (flags.hasEventSeries) {
    await client.query(
      `DELETE FROM event_series
       WHERE team_id = ANY($1::uuid[])
         AND (title LIKE 'DEMO:%' OR description LIKE $2)`,
      [teamIds, `%${DEMO_TAG}%`]
    );
  }
}

async function createEvent(client: PoolClient, seed: EventSeed, teamId: string, flags: SchemaFlags): Promise<string> {
  const startAt = toIsoUtc(seed.dayOffset, seed.startHour, seed.startMinute);
  const endAt = plusMinutes(startAt, seed.durationMinutes);
  const description = `${seed.description}\n${DEMO_TAG}`;

  const result = await client.query<{ id: string }>(
    `INSERT INTO events (team_id, type, title, description, start_at, end_at, location, cost, is_cancelled)
     VALUES ($1, $2::event_type, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8::numeric, FALSE)
     RETURNING id`,
    [teamId, seed.type, seed.title, description, startAt, endAt, seed.location, seed.cost]
  );
  const eventId = result.rows[0].id;

  if (flags.hasEventCostStatus && seed.costStatus) {
    await client.query(
      `UPDATE events
       SET cost_status = $2::event_cost_status,
           updated_at = NOW()
       WHERE id = $1`,
      [eventId, seed.costStatus]
    );
  }

  if (flags.hasEventFinanceState && seed.financeState) {
    await client.query(
      `UPDATE events
       SET finance_state = $2::event_finance_state,
           updated_at = NOW()
       WHERE id = $1`,
      [eventId, seed.financeState]
    );
  }

  return eventId;
}

async function upsertRsvp(client: PoolClient, eventId: string, userId: string, status: RsvpStatus) {
  await client.query(
    `INSERT INTO rsvps (event_id, user_id, status, updated_at)
     VALUES ($1, $2, $3::rsvp_status, NOW())
     ON CONFLICT (event_id, user_id)
     DO UPDATE SET
       status = EXCLUDED.status,
       updated_at = NOW()`,
    [eventId, userId, status]
  );
}

async function insertEventGame(client: PoolClient, eventId: string, timeLabel: string, opponent: string, score: string | null) {
  await client.query(
    `INSERT INTO event_games (event_id, time_label, opponent, score)
     VALUES ($1, $2, $3, $4)`,
    [eventId, timeLabel, opponent, score]
  );
}

async function insertTransaction(
  client: PoolClient,
  flags: SchemaFlags,
  tx: TransactionSeed,
  ids: { users: Record<string, string>; teams: Record<string, string>; events: Record<string, string> }
): Promise<string> {
  const columns = ["team_id", "type", "amount", "title", "date", "user_id", "user_name_snapshot", "status", "created_by"];
  const values: unknown[] = [
    ids.teams[tx.teamKey],
    tx.type,
    tx.amount,
    tx.title,
    toIsoUtc(tx.dayOffset, 12, 0),
    tx.userKey ? ids.users[tx.userKey] : null,
    tx.userKey ? tx.userKey : null,
    tx.status,
    ids.users[tx.createdByKey],
  ];

  if (flags.hasEventIdInTransactions) {
    columns.push("event_id");
    values.push(tx.eventKey ? ids.events[tx.eventKey] : null);
  }

  if (flags.hasIdempotencyScopeInTransactions) {
    columns.push("idempotency_scope");
    values.push(DEMO_SCOPE);
  }
  if (flags.hasIdempotencyKeyInTransactions) {
    columns.push("idempotency_key");
    values.push(`${DEMO_SCOPE}:${tx.key}`);
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const queryText = `INSERT INTO transactions (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`;
  const result = await client.query<{ id: string }>(queryText, values);
  return result.rows[0].id;
}

async function insertCharge(
  client: PoolClient,
  flags: SchemaFlags,
  params: {
    key: string;
    eventId: string;
    userId: string;
    teamId: string;
    amountDue: number;
    note: string;
    createdBy: string;
  }
): Promise<string> {
  const columns = ["event_id", "user_id", "team_id", "amount_due", "note", "created_by"];
  const values: unknown[] = [params.eventId, params.userId, params.teamId, params.amountDue, params.note, params.createdBy];
  if (flags.hasChargesIdempotency) {
    columns.push("idempotency_key");
    values.push(`${DEMO_SCOPE}:charge:${params.key}`);
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const updateParts = ["amount_due = EXCLUDED.amount_due", "note = EXCLUDED.note", "updated_at = NOW()"];
  if (flags.hasChargesIdempotency) {
    updateParts.push("idempotency_key = EXCLUDED.idempotency_key");
  }

  const result = await client.query<{ id: string }>(
    `INSERT INTO event_member_charges (${columns.join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (event_id, user_id)
     DO UPDATE SET ${updateParts.join(", ")}
     RETURNING id`,
    values
  );

  return result.rows[0].id;
}

async function insertAllocation(
  client: PoolClient,
  flags: SchemaFlags,
  params: {
    key: string;
    transactionId: string;
    chargeId: string;
    amount: number;
    createdBy: string;
  }
) {
  const columns = ["transaction_id", "event_member_charge_id", "amount", "created_by"];
  const values: unknown[] = [params.transactionId, params.chargeId, params.amount, params.createdBy];
  if (flags.hasAllocationsIdempotency) {
    columns.push("idempotency_key");
    values.push(`${DEMO_SCOPE}:alloc:${params.key}`);
  }
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  await client.query(`INSERT INTO event_payment_allocations (${columns.join(", ")}) VALUES (${placeholders})`, values);
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const flags = await detectSchema(client);

    const usersSeed: UserSeed[] = [
      {
        key: "captain_a",
        telegramId: "9000000101",
        username: "demo_captain_a",
        name: "Demo Captain A",
        nickname: "captain_a",
        avatar: "https://i.pravatar.cc/150?u=demo_captain_a",
      },
      {
        key: "trainer_a",
        telegramId: "9000000102",
        username: "demo_trainer_a",
        name: "Demo Trainer A",
        nickname: "trainer_a",
        avatar: "https://i.pravatar.cc/150?u=demo_trainer_a",
      },
      {
        key: "player_main",
        telegramId: "9000000103",
        username: "demo_player",
        name: "Demo Main Player",
        nickname: "main_player",
        avatar: "https://i.pravatar.cc/150?u=demo_player",
      },
      {
        key: "sniper",
        telegramId: "9000000104",
        username: "demo_sniper",
        name: "Demo Sniper",
        nickname: "sniper",
        avatar: "https://i.pravatar.cc/150?u=demo_sniper",
      },
      {
        key: "support",
        telegramId: "9000000105",
        username: "demo_support",
        name: "Demo Support",
        nickname: "support",
        avatar: "https://i.pravatar.cc/150?u=demo_support",
      },
      {
        key: "reserve",
        telegramId: "9000000106",
        username: "demo_reserve",
        name: "Demo Reserve",
        nickname: "reserve",
        avatar: "https://i.pravatar.cc/150?u=demo_reserve",
      },
      {
        key: "injured",
        telegramId: "9000000107",
        username: "demo_injured",
        name: "Demo Injured",
        nickname: "injured",
        avatar: "https://i.pravatar.cc/150?u=demo_injured",
      },
      {
        key: "captain_b",
        telegramId: "9000000201",
        username: "demo_captain_b",
        name: "Demo Captain B",
        nickname: "captain_b",
        avatar: "https://i.pravatar.cc/150?u=demo_captain_b",
      },
      {
        key: "captain_c",
        telegramId: "9000000301",
        username: "demo_captain_c",
        name: "Demo Captain C",
        nickname: "captain_c",
        avatar: "https://i.pravatar.cc/150?u=demo_captain_c",
      },
    ];

    const teamsSeed: TeamSeed[] = [
      { key: "alpha", name: "Demo Team Alpha", shortCode: "DTA", budget: 32000, timezone: "Europe/Moscow" },
      { key: "beta", name: "Demo Team Beta", shortCode: "DTB", budget: 18500, timezone: "Europe/Moscow" },
      { key: "gamma", name: "Demo Team Gamma", shortCode: "DTG", budget: 9700, timezone: "Europe/Moscow" },
    ];

    const membershipsSeed: MembershipSeed[] = [
      { userKey: "captain_a", teamKey: "alpha", role: "CAPTAIN", status: "ACTIVE", balance: 0 },
      { userKey: "trainer_a", teamKey: "alpha", role: "TRAINER", status: "ACTIVE", balance: -500 },
      { userKey: "player_main", teamKey: "alpha", role: "PLAYER", status: "ACTIVE", balance: -1200 },
      { userKey: "sniper", teamKey: "alpha", role: "PLAYER", status: "ACTIVE", balance: -650 },
      { userKey: "support", teamKey: "alpha", role: "PLAYER", status: "VACATION", balance: 0 },
      { userKey: "reserve", teamKey: "alpha", role: "PLAYER", status: "RESERVE", balance: -200 },
      { userKey: "injured", teamKey: "alpha", role: "PLAYER", status: "INJURED", balance: -3000 },

      { userKey: "captain_b", teamKey: "beta", role: "CAPTAIN", status: "ACTIVE", balance: 0 },
      { userKey: "player_main", teamKey: "beta", role: "PLAYER", status: "ACTIVE", balance: -400 },
      { userKey: "sniper", teamKey: "beta", role: "PLAYER", status: "ACTIVE", balance: 250 },
      { userKey: "reserve", teamKey: "beta", role: "PLAYER", status: "RESERVE", balance: 0 },

      { userKey: "captain_c", teamKey: "gamma", role: "CAPTAIN", status: "ACTIVE", balance: 0 },
      { userKey: "player_main", teamKey: "gamma", role: "PLAYER", status: "ACTIVE", balance: -900 },
      { userKey: "support", teamKey: "gamma", role: "PLAYER", status: "ACTIVE", balance: -200 },
    ];

    const users: Record<string, string> = {};
    for (const userSeed of usersSeed) {
      users[userSeed.key] = await upsertUser(client, userSeed);
    }

    const teams: Record<string, string> = {};
    for (const teamSeed of teamsSeed) {
      teams[teamSeed.key] = await upsertTeam(client, teamSeed, flags);
    }

    for (const membership of membershipsSeed) {
      await upsertMembership(client, {
        userId: users[membership.userKey],
        teamId: teams[membership.teamKey],
        role: membership.role,
        status: membership.status,
        balance: membership.balance,
      });
    }

    await clearPreviousDemoData(client, Object.values(teams), flags);

    const eventsSeed: EventSeed[] = [
      {
        key: "alpha_training",
        teamKey: "alpha",
        type: "TRAINING",
        title: "DEMO: Alpha Training Session",
        description: "Sprint drills and bunker transitions.",
        dayOffset: 1,
        startHour: 19,
        startMinute: 30,
        durationMinutes: 120,
        location: "Arena North",
        cost: 1200,
        costStatus: "ESTIMATED",
        financeState: "NOT_CALCULATED",
      },
      {
        key: "alpha_tournament",
        teamKey: "alpha",
        type: "TOURNAMENT",
        title: "DEMO: Alpha Cup",
        description: "Group stage with 3 opponents.",
        dayOffset: 3,
        startHour: 10,
        startMinute: 0,
        durationMinutes: 480,
        location: "AKM Arena",
        cost: 3600,
        costStatus: "FINAL",
        financeState: "COLLECTING",
      },
      {
        key: "alpha_championship",
        teamKey: "alpha",
        type: "CHAMPIONSHIP",
        title: "DEMO: Winter Championship",
        description: "Playoff day and final matches.",
        dayOffset: 6,
        startHour: 9,
        startMinute: 0,
        durationMinutes: 540,
        location: "AKM Arena",
        cost: 4200,
        costStatus: "FINAL",
        financeState: "CLOSED",
      },
      {
        key: "alpha_friendly",
        teamKey: "alpha",
        type: "FRIENDLY_MATCH",
        title: "DEMO: Friendly vs Phoenix",
        description: "Mixed roster scrim.",
        dayOffset: 9,
        startHour: 18,
        startMinute: 0,
        durationMinutes: 180,
        location: "Point X",
        cost: 1500,
        costStatus: "ESTIMATED",
        financeState: "COLLECTING",
      },
      {
        key: "alpha_meeting",
        teamKey: "alpha",
        type: "MEETING",
        title: "DEMO: Weekly Team Meeting",
        description: "Roles, logistics and planning.",
        dayOffset: 0,
        startHour: 20,
        startMinute: 0,
        durationMinutes: 60,
        location: "Discord",
        cost: null,
        costStatus: "UNKNOWN",
        financeState: "NOT_CALCULATED",
      },
      {
        key: "alpha_maintenance",
        teamKey: "alpha",
        type: "MAINTENANCE",
        title: "DEMO: Gear Maintenance Day",
        description: "Masks, markers and air systems.",
        dayOffset: 12,
        startHour: 11,
        startMinute: 0,
        durationMinutes: 120,
        location: "Team Storage",
        cost: null,
        costStatus: "UNKNOWN",
        financeState: "NOT_CALCULATED",
      },
      {
        key: "alpha_other",
        teamKey: "alpha",
        type: "OTHER",
        title: "DEMO: Media Day",
        description: "Photo and promo content shooting.",
        dayOffset: 14,
        startHour: 17,
        startMinute: 0,
        durationMinutes: 90,
        location: "Studio Box",
        cost: 700,
        costStatus: "ESTIMATED",
        financeState: "NOT_CALCULATED",
      },
      {
        key: "beta_training",
        teamKey: "beta",
        type: "TRAINING",
        title: "DEMO: Beta Core Training",
        description: "Communication and lane control.",
        dayOffset: 2,
        startHour: 20,
        startMinute: 30,
        durationMinutes: 90,
        location: "Beta Field",
        cost: 900,
        costStatus: "ESTIMATED",
        financeState: "NOT_CALCULATED",
      },
      {
        key: "beta_tournament",
        teamKey: "beta",
        type: "TOURNAMENT",
        title: "DEMO: Beta Open",
        description: "One-day local competition.",
        dayOffset: 7,
        startHour: 11,
        startMinute: 0,
        durationMinutes: 360,
        location: "Beta Arena",
        cost: 2400,
        costStatus: "ESTIMATED",
        financeState: "COLLECTING",
      },
      {
        key: "gamma_friendly",
        teamKey: "gamma",
        type: "FRIENDLY_MATCH",
        title: "DEMO: Gamma Friendly",
        description: "Practice against mixed squad.",
        dayOffset: 4,
        startHour: 19,
        startMinute: 0,
        durationMinutes: 150,
        location: "Gamma Field",
        cost: 1100,
        costStatus: "ESTIMATED",
        financeState: "NOT_CALCULATED",
      },
      {
        key: "gamma_meeting",
        teamKey: "gamma",
        type: "MEETING",
        title: "DEMO: Gamma Planning",
        description: "Short tactical sync.",
        dayOffset: 5,
        startHour: 21,
        startMinute: 0,
        durationMinutes: 45,
        location: "Voice Chat",
        cost: null,
        costStatus: "UNKNOWN",
        financeState: "NOT_CALCULATED",
      },
    ];

    const events: Record<string, string> = {};
    for (const eventSeed of eventsSeed) {
      events[eventSeed.key] = await createEvent(client, eventSeed, teams[eventSeed.teamKey], flags);
    }

    if (flags.hasEventGames) {
      await insertEventGame(client, events.alpha_tournament, "10:30", "Phoenix", null);
      await insertEventGame(client, events.alpha_tournament, "12:00", "Red Wolves", null);
      await insertEventGame(client, events.alpha_tournament, "14:30", "Steel Guard", null);

      await insertEventGame(client, events.alpha_championship, "09:40", "AKM", "2:1");
      await insertEventGame(client, events.alpha_championship, "11:20", "Spartans", "3:0");
      await insertEventGame(client, events.alpha_championship, "13:00", "North Stars", "2:2");

      await insertEventGame(client, events.beta_tournament, "11:30", "Ghost Squad", null);
      await insertEventGame(client, events.beta_tournament, "13:30", "Carbon Unit", null);
    }

    const rsvps: Array<{ eventKey: string; userKey: string; status: RsvpStatus }> = [
      { eventKey: "alpha_training", userKey: "player_main", status: "CONFIRMED" },
      { eventKey: "alpha_training", userKey: "captain_a", status: "CONFIRMED" },
      { eventKey: "alpha_training", userKey: "trainer_a", status: "PENDING" },
      { eventKey: "alpha_training", userKey: "sniper", status: "DECLINED" },
      { eventKey: "alpha_training", userKey: "reserve", status: "PENDING" },

      { eventKey: "alpha_tournament", userKey: "player_main", status: "PENDING" },
      { eventKey: "alpha_tournament", userKey: "captain_a", status: "CONFIRMED" },
      { eventKey: "alpha_tournament", userKey: "sniper", status: "CONFIRMED" },
      { eventKey: "alpha_tournament", userKey: "trainer_a", status: "CONFIRMED" },

      { eventKey: "alpha_championship", userKey: "player_main", status: "CONFIRMED" },
      { eventKey: "alpha_championship", userKey: "captain_a", status: "CONFIRMED" },
      { eventKey: "alpha_championship", userKey: "trainer_a", status: "CONFIRMED" },
      { eventKey: "alpha_championship", userKey: "sniper", status: "PENDING" },

      { eventKey: "alpha_friendly", userKey: "player_main", status: "CONFIRMED" },
      { eventKey: "alpha_friendly", userKey: "captain_a", status: "PENDING" },

      { eventKey: "alpha_meeting", userKey: "player_main", status: "CONFIRMED" },
      { eventKey: "alpha_maintenance", userKey: "player_main", status: "DECLINED" },

      { eventKey: "beta_training", userKey: "player_main", status: "CONFIRMED" },
      { eventKey: "beta_training", userKey: "captain_b", status: "CONFIRMED" },
      { eventKey: "beta_tournament", userKey: "player_main", status: "PENDING" },
      { eventKey: "beta_tournament", userKey: "captain_b", status: "CONFIRMED" },

      { eventKey: "gamma_friendly", userKey: "player_main", status: "CONFIRMED" },
      { eventKey: "gamma_friendly", userKey: "captain_c", status: "PENDING" },
      { eventKey: "gamma_meeting", userKey: "player_main", status: "PENDING" },
    ];

    for (const row of rsvps) {
      await upsertRsvp(client, events[row.eventKey], users[row.userKey], row.status);
    }

    const transactionsSeed: TransactionSeed[] = [
      {
        key: "alpha_deposit_1",
        teamKey: "alpha",
        type: "DEPOSIT",
        amount: 5000,
        title: "DEMO: Alpha monthly deposit",
        dayOffset: -3,
        userKey: "player_main",
        status: "COMPLETED",
        createdByKey: "captain_a",
      },
      {
        key: "alpha_expense_1",
        teamKey: "alpha",
        type: "EXPENSE",
        amount: 1800,
        title: "DEMO: Paintballs purchase",
        dayOffset: -2,
        status: "COMPLETED",
        createdByKey: "captain_a",
      },
      {
        key: "alpha_fee_1",
        teamKey: "alpha",
        type: "FEE",
        amount: 900,
        title: "DEMO: Late RSVP fee",
        dayOffset: -1,
        userKey: "player_main",
        status: "PENDING",
        createdByKey: "captain_a",
      },
      {
        key: "beta_deposit_1",
        teamKey: "beta",
        type: "DEPOSIT",
        amount: 2400,
        title: "DEMO: Beta tournament pool",
        dayOffset: -1,
        userKey: "captain_b",
        status: "COMPLETED",
        eventKey: "beta_tournament",
        createdByKey: "captain_b",
      },
    ];

    const transactions: Record<string, string> = {};
    for (const tx of transactionsSeed) {
      transactions[tx.key] = await insertTransaction(client, flags, tx, { users, teams, events });
    }

    if (flags.hasEventMemberCharges && flags.hasEventPaymentAllocations) {
      const chargeAlphaP1 = await insertCharge(client, flags, {
        key: "alpha_tournament_main",
        eventId: events.alpha_tournament,
        userId: users.player_main,
        teamId: teams.alpha,
        amountDue: 1200,
        note: `${DEMO_TAG} Tournament fee`,
        createdBy: users.captain_a,
      });
      const chargeAlphaP2 = await insertCharge(client, flags, {
        key: "alpha_tournament_sniper",
        eventId: events.alpha_tournament,
        userId: users.sniper,
        teamId: teams.alpha,
        amountDue: 1200,
        note: `${DEMO_TAG} Tournament fee`,
        createdBy: users.captain_a,
      });
      const chargeAlphaP3 = await insertCharge(client, flags, {
        key: "alpha_tournament_trainer",
        eventId: events.alpha_tournament,
        userId: users.trainer_a,
        teamId: teams.alpha,
        amountDue: 1200,
        note: `${DEMO_TAG} Tournament fee`,
        createdBy: users.captain_a,
      });

      const chargeClosed1 = await insertCharge(client, flags, {
        key: "alpha_champ_main",
        eventId: events.alpha_championship,
        userId: users.player_main,
        teamId: teams.alpha,
        amountDue: 1000,
        note: `${DEMO_TAG} Championship fee`,
        createdBy: users.captain_a,
      });
      const chargeClosed2 = await insertCharge(client, flags, {
        key: "alpha_champ_sniper",
        eventId: events.alpha_championship,
        userId: users.sniper,
        teamId: teams.alpha,
        amountDue: 1000,
        note: `${DEMO_TAG} Championship fee`,
        createdBy: users.captain_a,
      });

      const txTournamentPayment = await insertTransaction(client, flags, {
        key: "alpha_tournament_payment",
        teamKey: "alpha",
        type: "DEPOSIT",
        amount: 1800,
        title: "DEMO: Tournament payment batch",
        dayOffset: -1,
        userKey: "captain_a",
        status: "COMPLETED",
        eventKey: "alpha_tournament",
        createdByKey: "captain_a",
      }, { users, teams, events });

      const txClosedPayment = await insertTransaction(client, flags, {
        key: "alpha_championship_payment",
        teamKey: "alpha",
        type: "DEPOSIT",
        amount: 2000,
        title: "DEMO: Championship fully paid",
        dayOffset: -1,
        userKey: "captain_a",
        status: "COMPLETED",
        eventKey: "alpha_championship",
        createdByKey: "captain_a",
      }, { users, teams, events });

      await insertAllocation(client, flags, {
        key: "alpha_tournament_main",
        transactionId: txTournamentPayment,
        chargeId: chargeAlphaP1,
        amount: 1200,
        createdBy: users.captain_a,
      });
      await insertAllocation(client, flags, {
        key: "alpha_tournament_sniper_partial",
        transactionId: txTournamentPayment,
        chargeId: chargeAlphaP2,
        amount: 600,
        createdBy: users.captain_a,
      });
      await insertAllocation(client, flags, {
        key: "alpha_champ_main",
        transactionId: txClosedPayment,
        chargeId: chargeClosed1,
        amount: 1000,
        createdBy: users.captain_a,
      });
      await insertAllocation(client, flags, {
        key: "alpha_champ_sniper",
        transactionId: txClosedPayment,
        chargeId: chargeClosed2,
        amount: 1000,
        createdBy: users.captain_a,
      });

      if (flags.hasEventFinanceState) {
        await client.query(
          `UPDATE events
           SET finance_state = CASE id
             WHEN $1::uuid THEN 'COLLECTING'::event_finance_state
             WHEN $2::uuid THEN 'CLOSED'::event_finance_state
             ELSE finance_state
           END,
           updated_at = NOW()
           WHERE id IN ($1::uuid, $2::uuid)`,
          [events.alpha_tournament, events.alpha_championship]
        );
      }

      void chargeAlphaP3;
      void transactions.alpha_deposit_1;
    }

    await client.query("COMMIT");
    console.log("demo seed complete");
    console.log(`users: ${Object.keys(users).length}, teams: ${Object.keys(teams).length}, events: ${Object.keys(events).length}`);
    console.log(`tag: ${DEMO_TAG}, scope: ${DEMO_SCOPE}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
