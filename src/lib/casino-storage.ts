import { getDb, getQuotaRow, setQuotaRow } from "./db.js";
import { roleLimit, type Role } from "../core/access.js";
import { isQuotaPackage, quoteQuotaRefill, type QuotaPackage } from "./quota-packages.js";

export interface Wallet { balance: number; points: number; bankBalance: number }
export interface BlackjackState { bet: number; hand: number[]; dealer: number[] }

// Batas transaksi ekonomi per aksi (transfer, setor/tarik bank, add money).
export const MIN_TRANSACTION = 1_000;
export const MAX_TRANSACTION = 3_000_000;

export type WalletOperationResult =
  | { ok: true; wallet: Wallet }
  | { ok: false; reason: "not-ready" | "invalid" | "insufficient" | "limit" | "frozen" };

export type QuotaPurchaseResult =
  | { ok: true; wallet: Wallet; quotaLeft: number; amount: number; cost: number }
  | { ok: false; reason: "not-ready" | "invalid" | "insufficient" | "limit" | "frozen" | "full" };

export function isBalanceFrozen(userId: string): boolean {
  const row = getDb()?.prepare("SELECT balance_frozen FROM casino_wallets WHERE user_id=?").get(userId);
  return row ? Number(row.balance_frozen) !== 0 : false;
}

export function purchaseQuota(
  platform: string,
  userId: string,
  purchase: QuotaPackage,
  role: Role,
  today: string,
  at: number = Date.now(),
): QuotaPurchaseResult {
  const db = getDb();
  if (!db) return { ok: false, reason: "not-ready" };
  if (!isQuotaPackage(purchase) || role === "owner") {
    return { ok: false, reason: "invalid" };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const wallet = getWallet(userId);
    const quota = getQuotaRow(platform, userId);
    if (!wallet || !quota || quota.lastReset !== today) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not-ready" };
    }
    if (isBalanceFrozen(userId)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "frozen" };
    }
    const limit = roleLimit(role) + quota.dailyBonus + quota.permanentBonus;
    const quote = quoteQuotaRefill(purchase, limit, quota.quotaLeft);
    if (!quote) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit" };
    }
    const { amount, cost } = quote;
    if (amount === 0) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "full" };
    }
    if (wallet.balance < cost) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }

    const quotaLeft = quota.quotaLeft + amount;

    db.prepare("UPDATE casino_wallets SET balance=balance-?, updated_at=? WHERE user_id=? AND balance>=?")
      .run(cost, at, userId, cost);
    setQuotaRow({
      platform,
      userId,
      quotaLeft,
      dailyBonus: quota.dailyBonus,
      permanentBonus: quota.permanentBonus,
      lastReset: quota.lastReset,
      displayName: quota.displayName,
      at,
    });
    const updatedWallet = getWallet(userId);
    if (!updatedWallet) throw new Error("Wallet tidak tersedia setelah pembelian kuota.");
    db.exec("COMMIT");
    return { ok: true, wallet: updatedWallet, quotaLeft, amount, cost };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getWallet(userId: string): Wallet | null {
  const db = getDb();
  if (!db) return null;
  db.prepare("INSERT INTO casino_wallets(user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING")
    .run(userId, Date.now());
  const row = db.prepare("SELECT balance, points, bank_balance FROM casino_wallets WHERE user_id = ?").get(userId);
  return row
    ? { balance: Number(row.balance), points: Number(row.points), bankBalance: Number(row.bank_balance) }
    : null;
}

export function changeBalance(userId: string, delta: number): Wallet | null {
  const db = getDb();
  if (!db || !Number.isSafeInteger(delta)) return null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const wallet = getWallet(userId);
    if (delta < 0 && isBalanceFrozen(userId)) {
      db.exec("ROLLBACK");
      return null;
    }
    const nextBalance = wallet ? wallet.balance + delta : NaN;
    if (!wallet || !Number.isSafeInteger(nextBalance) || nextBalance < 0) {
      db.exec("ROLLBACK");
      return null;
    }
    db.prepare("UPDATE casino_wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
      .run(delta, Date.now(), userId);
    const updated = getWallet(userId);
    if (!updated) throw new Error("Wallet tidak tersedia setelah perubahan saldo.");
    db.exec("COMMIT");
    return updated;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function exchangePoints(userId: string, points: number): WalletOperationResult {
  const db = getDb();
  if (!db) return { ok: false, reason: "not-ready" };
  if (!Number.isSafeInteger(points) || points < 1 || points > 50) return { ok: false, reason: "invalid" };

  const cash = points * 10_000;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (isBalanceFrozen(userId)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "frozen" };
    }
    const wallet = getWallet(userId);
    if (!wallet) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not-ready" };
    }
    if (wallet.points < points) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }
    if (!Number.isSafeInteger(wallet.balance + cash)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit" };
    }

    db.prepare("UPDATE casino_wallets SET points=points-?, balance=balance+?, updated_at=? WHERE user_id=? AND points>=?")
      .run(points, cash, Date.now(), userId, points);
    const updated = getWallet(userId);
    if (!updated) throw new Error("Wallet tidak tersedia setelah penukaran Point.");
    db.exec("COMMIT");
    return { ok: true, wallet: updated };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function transferBank(userId: string, action: "deposit" | "withdraw", amount: number): WalletOperationResult {
  const db = getDb();
  if (!db) return { ok: false, reason: "not-ready" };
  if (!Number.isSafeInteger(amount) || amount < MIN_TRANSACTION || amount > MAX_TRANSACTION) return { ok: false, reason: "invalid" };

  db.exec("BEGIN IMMEDIATE");
  try {
    if (isBalanceFrozen(userId)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "frozen" };
    }
    const wallet = getWallet(userId);
    if (!wallet) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not-ready" };
    }
    if (action === "deposit" && wallet.balance < amount) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }
    if (action === "withdraw" && wallet.bankBalance < amount) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }

    const balance = action === "deposit" ? wallet.balance - amount : wallet.balance + amount;
    const bankBalance = action === "deposit" ? wallet.bankBalance + amount : wallet.bankBalance - amount;
    if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(bankBalance)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit" };
    }
    db.prepare("UPDATE casino_wallets SET balance=?, bank_balance=?, updated_at=? WHERE user_id=?")
      .run(balance, bankBalance, Date.now(), userId);
    const updated = getWallet(userId);
    if (!updated) throw new Error("Wallet tidak tersedia setelah transaksi bank.");
    db.exec("COMMIT");
    return { ok: true, wallet: updated };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export type TransferResult =
  | { ok: true; sender: Wallet; recipient: Wallet }
  | { ok: false; reason: "not-ready" | "invalid" | "insufficient" | "limit" | "frozen" };

export function transferWallet(senderId: string, recipientId: string, amount: number): TransferResult {
  const db = getDb();
  if (!db) return { ok: false, reason: "not-ready" };
  if (!Number.isSafeInteger(amount) || amount < MIN_TRANSACTION || amount > MAX_TRANSACTION || senderId === recipientId) {
    return { ok: false, reason: "invalid" };
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const sender = getWallet(senderId);
    const recipient = getWallet(recipientId);
    if (!sender || !recipient) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not-ready" };
    }
    if (isBalanceFrozen(senderId)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "frozen" };
    }
    if (sender.balance < amount) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }
    if (!Number.isSafeInteger(recipient.balance + amount)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit" };
    }
    const at = Date.now();
    db.prepare("UPDATE casino_wallets SET balance=balance-?, updated_at=? WHERE user_id=? AND balance>=?")
      .run(amount, at, senderId, amount);
    db.prepare("UPDATE casino_wallets SET balance=balance+?, updated_at=? WHERE user_id=?")
      .run(amount, at, recipientId);
    const updatedSender = getWallet(senderId);
    const updatedRecipient = getWallet(recipientId);
    if (!updatedSender || !updatedRecipient) throw new Error("Wallet tidak tersedia setelah transfer.");
    db.exec("COMMIT");
    return { ok: true, sender: updatedSender, recipient: updatedRecipient };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function addWalletMoney(userId: string, amount: number): WalletOperationResult {
  const db = getDb();
  if (!db) return { ok: false, reason: "not-ready" };
  if (!Number.isSafeInteger(amount) || amount < MIN_TRANSACTION || amount > MAX_TRANSACTION) return { ok: false, reason: "invalid" };
  db.exec("BEGIN IMMEDIATE");
  try {
    const wallet = getWallet(userId);
    if (!wallet) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not-ready" };
    }
    if (!Number.isSafeInteger(wallet.balance + amount)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit" };
    }
    db.prepare("UPDATE casino_wallets SET balance=balance+?, updated_at=? WHERE user_id=?")
      .run(amount, Date.now(), userId);
    const updated = getWallet(userId);
    if (!updated) throw new Error("Wallet tidak tersedia setelah penambahan saldo.");
    db.exec("COMMIT");
    return { ok: true, wallet: updated };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
