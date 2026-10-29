import { getDb } from "./db.js";

export interface Wallet { balance: number; points: number }
export interface BlackjackState { bet: number; hand: number[]; dealer: number[] }

export function getWallet(userId: string): Wallet | null {
  const db = getDb();
  if (!db) return null;
  db.prepare("INSERT INTO casino_wallets(user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING")
    .run(userId, Date.now());
  const row = db.prepare("SELECT balance, points FROM casino_wallets WHERE user_id = ?").get(userId);
  return row ? { balance: Number(row.balance), points: Number(row.points) } : null;
}

export function changeBalance(userId: string, delta: number): Wallet | null {
  const db = getDb();
  if (!db || !Number.isSafeInteger(delta)) return null;
  const wallet = getWallet(userId);
  if (!wallet || wallet.balance + delta < 0) return null;
  db.prepare("UPDATE casino_wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
    .run(delta, Date.now(), userId);
  return getWallet(userId);
}

export function getBlackjack(userId: string): BlackjackState | null {
  const db = getDb();
  if (!db) return null;
  const row = db.prepare("SELECT bet, hand, dealer FROM casino_blackjack WHERE user_id = ?").get(userId);
  if (!row) return null;
  try {
    return { bet: Number(row.bet), hand: JSON.parse(String(row.hand)) as number[], dealer: JSON.parse(String(row.dealer)) as number[] };
  } catch { return null; }
}

export function saveBlackjack(userId: string, state: BlackjackState): void {
  getDb()?.prepare(`INSERT INTO casino_blackjack(user_id, bet, hand, dealer, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET bet=excluded.bet, hand=excluded.hand, dealer=excluded.dealer, updated_at=excluded.updated_at`)
    .run(userId, state.bet, JSON.stringify(state.hand), JSON.stringify(state.dealer), Date.now());
}

export function clearBlackjack(userId: string): void {
  getDb()?.prepare("DELETE FROM casino_blackjack WHERE user_id = ?").run(userId);
}

export function getAwardedLevel(platform: string, chatId: string, userId: string): number {
  const row = getDb()?.prepare("SELECT awarded_level FROM level_points WHERE platform=? AND chat_id=? AND user_id=?")
    .get(platform, chatId, userId);
  return row ? Number(row.awarded_level) : 1;
}

export function awardLevels(
  platform: string,
  chatId: string,
  userId: string,
  level: number,
  previousLevel: number = 1,
): number {
  const db = getDb();
  if (!db) return 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT awarded_level FROM level_points WHERE platform=? AND chat_id=? AND user_id=?")
      .get(platform, chatId, userId);
    const current = row ? Number(row.awarded_level) : Math.max(1, previousLevel);
    if (!row) {
      db.prepare("INSERT INTO level_points(platform,chat_id,user_id,awarded_level) VALUES(?,?,?,?)")
        .run(platform, chatId, userId, current);
    }
    if (level <= current) { db.exec("COMMIT"); return 0; }
    getWallet(userId);
    db.prepare("UPDATE casino_wallets SET points=points+?, updated_at=? WHERE user_id=?")
      .run(level - current, Date.now(), userId);
    db.prepare(`INSERT INTO level_points(platform,chat_id,user_id,awarded_level) VALUES(?,?,?,?)
      ON CONFLICT(platform,chat_id,user_id) DO UPDATE SET awarded_level=excluded.awarded_level`)
      .run(platform, chatId, userId, level);
    db.exec("COMMIT");
    return level - current;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
