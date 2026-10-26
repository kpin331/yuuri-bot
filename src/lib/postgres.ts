import { Pool } from "pg";

// PostgreSQL storage for the XP/leveling feature. Kept separate from db.ts
// (SQLite) so the bot still runs when POSTGRES_URL is unset: in that case the
// pool stays null and the feature answers "not configured".

let pool: Pool | null = null;
let initTried = false;

export function getPostgresUrl(): string {
  return process.env.POSTGRES_URL?.trim() ?? "";
}

export function isPostgresReady(): boolean {
  return pool !== null;
}

// Opens the pool and creates the xp table. Safe to call once at startup; a
// failure logs a warning and leaves the feature disabled instead of crashing.
export async function initPostgres(): Promise<void> {
  if (initTried) return;
  initTried = true;

  const url = getPostgresUrl();
  if (!url) {
    console.log("POSTGRES_URL belum diisi. /rank dan /leaderboard dinonaktifkan.");
    return;
  }

  let next: Pool | null = null;
  try {
    next = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 5000 });
    await next.query(`
      CREATE TABLE IF NOT EXISTS xp (
        platform     TEXT NOT NULL,
        chat_id      TEXT NOT NULL DEFAULT '',
        user_id      TEXT NOT NULL,
        display_name TEXT,
        xp           INTEGER NOT NULL DEFAULT 0,
        updated_at   INTEGER NOT NULL,
        PRIMARY KEY (platform, chat_id, user_id)
      )
    `);
    await next.query("ALTER TABLE xp ADD COLUMN IF NOT EXISTS chat_id TEXT NOT NULL DEFAULT ''");
    await next.query(`
      DO $$
      DECLARE old_pk TEXT;
      BEGIN
        SELECT conname INTO old_pk
        FROM pg_constraint
        WHERE conrelid = 'xp'::regclass AND contype = 'p'
          AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (platform, chat_id, user_id)';
        IF old_pk IS NOT NULL THEN
          EXECUTE format('ALTER TABLE xp DROP CONSTRAINT %I', old_pk);
          ALTER TABLE xp ADD CONSTRAINT xp_pkey PRIMARY KEY (platform, chat_id, user_id);
        END IF;
      END $$
    `);
    pool = next;
    console.log("PostgreSQL terhubung. Penyimpanan XP siap digunakan.");
  } catch (error) {
    pool = null;
    if (next) await next.end().catch(() => undefined);
    console.error("Inisialisasi PostgreSQL gagal. Penyimpanan XP tetap dinonaktifkan:", error);
  }
}

export async function closePostgres(): Promise<void> {
  const current = pool;
  pool = null;
  initTried = false;
  if (current) await current.end();
}

export interface XpRow {
  platform: string;
  chatId: string;
  userId: string;
  displayName: string | null;
  xp: number;
}

// Adds XP for a user, creating the row on first use. Returns the new total, or
// null when storage is unavailable or the query failed (the caller then just
// skips the level-up check, never breaking the command).
export async function addXp(input: {
  platform: string;
  chatId: string;
  userId: string;
  displayName: string | null;
  amount: number;
  at?: number;
}): Promise<number | null> {
  if (!pool) return null;
  const at = input.at ?? Date.now();
  try {
    const result = await pool.query(
      `INSERT INTO xp (platform, chat_id, user_id, display_name, xp, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(platform, chat_id, user_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, xp.display_name),
         xp           = xp.xp + excluded.xp,
         updated_at   = excluded.updated_at
       RETURNING xp`,
      [input.platform, input.chatId, input.userId, input.displayName, input.amount, at],
    );
    const value = result.rows[0]?.xp;
    return value === undefined ? null : Number(value);
  } catch (error) {
    console.error("Gagal menambahkan XP:", error);
    return null;
  }
}

// Total XP for one user, 0 when they have no row yet.
export async function getXp(platform: string, chatId: string, userId: string): Promise<number> {
  if (!pool) return 0;
  try {
    const result = await pool.query(
      "SELECT xp FROM xp WHERE platform = $1 AND chat_id = $2 AND user_id = $3",
      [platform, chatId, userId],
    );
    const value = result.rows[0]?.xp;
    return value === undefined ? 0 : Number(value);
  } catch (error) {
    console.error("Gagal membaca XP:", error);
    return 0;
  }
}

// Users in one chat, ordered by XP; ties go to the most recently active.
export async function getLeaderboard(
  platform: string,
  chatId: string,
  limit: number = 10,
): Promise<XpRow[]> {
  if (!pool) return [];
  try {
    const result = await pool.query(
      `SELECT platform, chat_id, user_id, display_name, xp
       FROM xp
       WHERE platform = $1 AND chat_id = $2
       ORDER BY xp DESC, updated_at DESC
       LIMIT $3`,
      [platform, chatId, limit],
    );
    return result.rows.map((row) => ({
      platform: String(row.platform),
      chatId: String(row.chat_id),
      userId: String(row.user_id),
      displayName: row.display_name === null ? null : String(row.display_name),
      xp: Number(row.xp),
    }));
  } catch (error) {
    console.error("Gagal membaca peringkat:", error);
    return [];
  }
}
