import { getDb } from "./db.js";
import { levelForXp } from "./xp.js";
import { awardLevels } from "./casino-storage.js";

export interface XpRow {
  platform: string;
  chatId: string;
  userId: string;
  displayName: string | null;
  xp: number;
}

export function isXpStorageReady(): boolean {
  return getDb() !== null;
}

export async function addXp(input: {
  platform: string;
  chatId: string;
  userId: string;
  displayName: string | null;
  amount: number;
  at?: number;
}): Promise<number | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const previous = db.prepare(
      "SELECT xp FROM xp WHERE platform = ? AND chat_id = ? AND user_id = ?",
    ).get(input.platform, input.chatId, input.userId);
    const row = db.prepare(
      `INSERT INTO xp (platform, chat_id, user_id, display_name, xp, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, chat_id, user_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, xp.display_name),
         xp           = xp.xp + excluded.xp,
         updated_at   = excluded.updated_at
       RETURNING xp`,
    ).get(input.platform, input.chatId, input.userId, input.displayName, input.amount, input.at ?? Date.now());
    if (row?.xp === undefined) return null;
    const xp = Number(row.xp);
    const previousLevel = previous ? levelForXp(Number(previous.xp)) : 1;
    awardLevels(input.platform, input.chatId, input.userId, levelForXp(xp), previousLevel);
    return xp;
  } catch (error) {
    console.error("Gagal menambahkan XP:", error);
    return null;
  }
}

export async function getXp(platform: string, chatId: string, userId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  try {
    const row = db.prepare(
      "SELECT xp FROM xp WHERE platform = ? AND chat_id = ? AND user_id = ?",
    ).get(platform, chatId, userId);
    return row?.xp === undefined ? 0 : Number(row.xp);
  } catch (error) {
    console.error("Gagal membaca XP:", error);
    return 0;
  }
}

export async function getLeaderboard(
  platform: string,
  chatId: string,
  limit: number = 10,
): Promise<XpRow[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = db.prepare(
      `SELECT platform, chat_id, user_id, display_name, xp
       FROM xp
       WHERE platform = ? AND chat_id = ?
       ORDER BY xp DESC, updated_at DESC
       LIMIT ?`,
    ).all(platform, chatId, Math.max(0, Math.floor(limit)));
    return rows.map((row) => ({
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
