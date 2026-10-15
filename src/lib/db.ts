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

export interface BanRecord {
  userId: number;
  bannedBy: number | null;
  createdAt: number;
  expiresAt: number;
  reason: string | null;
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

    CREATE TABLE IF NOT EXISTS command_states (
      command     TEXT PRIMARY KEY,
      enabled     INTEGER NOT NULL DEFAULT 1,
      updated_at  INTEGER NOT NULL,
      updated_by  INTEGER
    );

    CREATE TABLE IF NOT EXISTS bans (
      user_id     INTEGER PRIMARY KEY,
      banned_by   INTEGER,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      reason      TEXT
    );
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

// === Command enable/disable state ===

export function isCommandEnabled(command: string): boolean {
  if (!db) return true;
  const row = db
    .prepare("SELECT enabled FROM command_states WHERE command = ?")
    .get(command.trim().toLowerCase());
  if (!row) return true;
  return Number(row.enabled) !== 0;
}

export function setCommandState(
  command: string,
  enabled: boolean,
  updatedBy: number | null,
  at: number = Date.now(),
): void {
  if (!db) throw new Error("Storage is not available.");
  db.prepare(
    `INSERT INTO command_states (command, enabled, updated_at, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(command) DO UPDATE SET
       enabled = excluded.enabled,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(command.trim().toLowerCase(), enabled ? 1 : 0, at, updatedBy);
}

// === Bans ===

function toBan(row: Record<string, unknown>): BanRecord {
  return {
    userId: Number(row.user_id),
    bannedBy: row.banned_by === null || row.banned_by === undefined ? null : Number(row.banned_by),
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    reason: (row.reason as string | null) ?? null,
  };
}

// Returns the active ban for a user, or null. Expired bans are deleted lazily
// so that they stop blocking users even after a restart.
export function getBan(userId: number, at: number = Date.now()): BanRecord | null {
  if (!db) return null;
  const row = db.prepare("SELECT * FROM bans WHERE user_id = ?").get(userId);
  if (!row) return null;

  const ban = toBan(row as Record<string, unknown>);
  if (ban.expiresAt <= at) {
    db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
    return null;
  }
  return ban;
}

export function isBanned(userId: number, at: number = Date.now()): boolean {
  return getBan(userId, at) !== null;
}

export function addBan(record: Omit<BanRecord, "reason"> & { reason?: string | null }): void {
  if (!db) throw new Error("Storage is not available.");
  const reason = record.reason ?? null;
  db.prepare(
    `INSERT INTO bans (user_id, banned_by, created_at, expires_at, reason)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       banned_by = excluded.banned_by,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at,
       reason = excluded.reason`,
  ).run(record.userId, record.bannedBy, record.createdAt, record.expiresAt, reason);
}

export function removeBan(userId: number): boolean {
  if (!db) return false;
  const result = db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
  return Number(result.changes) > 0;
}
