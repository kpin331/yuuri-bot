import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface TgUser {
  id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
}

export interface IncomingActivity {
  user: TgUser;
  command?: string | null;
  at?: number;
}

export interface UserRecord {
  userId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  firstSeen: number;
  lastSeen: number;
}

export interface UserStats extends UserRecord {
  messages: number;
  activeDays: number;
  commandCount: number;
  topCommand: string | null;
}

let db: DatabaseSync | null = null;

export function getDbPath(): string {
  const override = process.env.BOT_DB_PATH?.trim();
  return override && override.length > 0 ? override : join(process.cwd(), "data", "bot.db");
}

export function isDatabaseReady(): boolean {
  return db !== null;
}

export function initDatabase(path: string = getDbPath()): void {
  if (db) return;

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id     INTEGER PRIMARY KEY,
      first_name  TEXT,
      last_name   TEXT,
      username    TEXT,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      user_id   INTEGER NOT NULL,
      day       TEXT NOT NULL,
      messages  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );

    CREATE TABLE IF NOT EXISTS command_activity (
      user_id    INTEGER NOT NULL,
      command    TEXT NOT NULL,
      uses       INTEGER NOT NULL DEFAULT 0,
      last_used  INTEGER NOT NULL,
      PRIMARY KEY (user_id, command)
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
  `);

  db = database;
}

export function closeDatabase(): void {
  if (!db) return;
  db.close();
  db = null;
}

export function dateKeyUTC(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

function normalizeCommand(command: string | null | undefined): string | null {
  if (!command) return null;
  const trimmed = command.trim().replace(/^[/$]/, "");
  const withoutMention = trimmed.split("@")[0] ?? trimmed;
  const name = withoutMention.trim().toLowerCase();
  return name.length > 0 ? name : null;
}

function toRecord(row: Record<string, unknown>): UserRecord {
  return {
    userId: Number(row.user_id),
    firstName: (row.first_name as string | null) ?? null,
    lastName: (row.last_name as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    firstSeen: Number(row.first_seen),
    lastSeen: Number(row.last_seen),
  };
}

export function recordIncoming(activity: IncomingActivity): void {
  if (!db) return;

  const { user } = activity;
  const at = activity.at ?? Date.now();
  const day = dateKeyUTC(at);
  const command = normalizeCommand(activity.command);
  const firstName = user.firstName?.trim() || null;
  const lastName = user.lastName?.trim() || null;
  const username = user.username?.trim().toLowerCase() || null;

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO users (user_id, first_name, last_name, username, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         first_name = COALESCE(excluded.first_name, users.first_name),
         last_name  = COALESCE(excluded.last_name, users.last_name),
         username   = COALESCE(excluded.username, users.username),
         last_seen  = excluded.last_seen`,
    ).run(user.id, firstName, lastName, username, at, at);

    db.prepare(
      `INSERT INTO activity (user_id, day, messages)
       VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET messages = messages + 1`,
    ).run(user.id, day);

    if (command) {
      db.prepare(
        `INSERT INTO command_activity (user_id, command, uses, last_used)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(user_id, command) DO UPDATE SET
           uses = uses + 1,
           last_used = excluded.last_used`,
      ).run(user.id, command, at);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getStats(userId: number): UserStats | null {
  if (!db) return null;

  const userRow = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
  if (!userRow) return null;

  const activity = db
    .prepare(
      "SELECT COALESCE(SUM(messages), 0) AS messages, COUNT(*) AS days FROM activity WHERE user_id = ?",
    )
    .get(userId);
  const commands = db
    .prepare("SELECT COALESCE(SUM(uses), 0) AS uses FROM command_activity WHERE user_id = ?")
    .get(userId);
  const topRow = db
    .prepare(
      "SELECT command FROM command_activity WHERE user_id = ? ORDER BY uses DESC, last_used DESC LIMIT 1",
    )
    .get(userId);

  return {
    ...toRecord(userRow as Record<string, unknown>),
    messages: Number(activity?.messages ?? 0),
    activeDays: Number(activity?.days ?? 0),
    commandCount: Number(commands?.uses ?? 0),
    topCommand: typeof topRow?.command === "string" ? topRow.command : null,
  };
}

export function findUserByUsername(username: string): UserRecord | null {
  if (!db) return null;
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  if (normalized.length === 0) return null;
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(normalized);
  return row ? toRecord(row as Record<string, unknown>) : null;
}
