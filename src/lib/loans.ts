import { randomInt } from "node:crypto";
import { getDb } from "./db.js";
import { getWallet, isBalanceFrozen } from "./casino-storage.js";

export const MAX_LOAN_AMOUNT = 500_000;
export const MAX_ACTIVE_LOANS = 5;
export const LOAN_INTEREST_PERCENT = 10;

export interface Loan {
  id: number;
  platform: string;
  userId: string;
  principal: number;
  remaining: number;
  createdAt: number;
  dueAt: number;
  warnedAt: number | null;
}

export interface DueLoanReminder extends Loan {}

export type LoanResult =
  | { ok: true; loans: Loan[]; walletBalance: number; frozen: boolean; createdLoan?: Loan }
  | { ok: false; reason: "not-ready" | "invalid" | "insufficient" | "limit" | "frozen" };

function mapLoan(row: Record<string, unknown>): Loan {
  return {
    id: Number(row.loan_id),
    platform: String(row.platform),
    userId: String(row.user_id),
    principal: Number(row.principal),
    remaining: Number(row.remaining),
    createdAt: Number(row.created_at),
    dueAt: Number(row.due_at),
    warnedAt: row.warned_at === null ? null : Number(row.warned_at),
  };
}

export function getActiveLoans(platform: string, userId: string): Loan[] {
  const db = getDb();
  if (!db) return [];
  return db.prepare(`SELECT * FROM casino_loans WHERE platform=? AND user_id=? AND settled_at IS NULL AND remaining > 0
    ORDER BY due_at, loan_id`).all(platform, userId).map((row) => mapLoan(row as Record<string, unknown>));
}

export function reconcileBalanceFreeze(userId: string, at: number = Date.now()): boolean {
  const db = getDb();
  if (!db) return isBalanceFrozen(userId);
  db.prepare(`UPDATE casino_loans SET settled_at=?
    WHERE user_id=? AND settled_at IS NULL AND remaining <= 0`).run(at, userId);
  const overdue = Number(db.prepare(`SELECT COUNT(*) AS count FROM casino_loans
    WHERE user_id=? AND settled_at IS NULL AND remaining > 0 AND due_at<=?`).get(userId, at)?.count ?? 0) > 0;
  db.prepare("UPDATE casino_wallets SET balance_frozen=?, updated_at=? WHERE user_id=?")
    .run(overdue ? 1 : 0, at, userId);
  return overdue;
}

export function borrowLoan(
  platform: string,
  userId: string,
  amount: number,
  at: number = Date.now(),
  dueAt: number = at + randomInt(20, 41) * 60_000,
): LoanResult {
  const db = getDb();
  if (!db) return { ok: false, reason: "not-ready" };
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_LOAN_AMOUNT || !Number.isSafeInteger(dueAt) || dueAt <= at) {
    return { ok: false, reason: "invalid" };
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const wallet = getWallet(userId);
    if (!wallet) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not-ready" };
    }
    if (isBalanceFrozen(userId)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "frozen" };
    }
    const active = Number(db.prepare("SELECT COUNT(*) AS count FROM casino_loans WHERE platform=? AND user_id=? AND settled_at IS NULL AND remaining > 0")
      .get(platform, userId)?.count ?? 0);
    if (active >= MAX_ACTIVE_LOANS) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit" };
    }
    if (!Number.isSafeInteger(wallet.balance + amount)) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit" };
    }

    const due = amount + Math.ceil(amount * LOAN_INTEREST_PERCENT / 100);
    db.prepare("UPDATE casino_wallets SET balance=balance+?, updated_at=? WHERE user_id=?")
      .run(amount, at, userId);
    const inserted = db.prepare(`INSERT INTO casino_loans(platform,user_id,principal,remaining,created_at,due_at)
      VALUES(?,?,?,?,?,?)`).run(platform, userId, amount, due, at, dueAt);
    const createdRow = db.prepare("SELECT * FROM casino_loans WHERE loan_id=?").get(Number(inserted.lastInsertRowid));
    if (!createdRow) throw new Error("Pinjaman tidak tersedia setelah dibuat.");
    const createdLoan = mapLoan(createdRow as Record<string, unknown>);
    const loans = getActiveLoans(platform, userId);
    const updatedWallet = getWallet(userId);
    if (!updatedWallet) throw new Error("Wallet tidak tersedia setelah pinjaman.");
    db.exec("COMMIT");
    return { ok: true, loans, walletBalance: updatedWallet.balance, frozen: false, createdLoan };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function repay(platform: string, userId: string, amount: number | null, at: number): LoanResult {
  const db = getDb();
  if (!db) return { ok: false, reason: "not-ready" };
  if (amount !== null && (!Number.isSafeInteger(amount) || amount < 1)) return { ok: false, reason: "invalid" };
  db.exec("BEGIN IMMEDIATE");
  try {
    const wallet = getWallet(userId);
    const loans = getActiveLoans(platform, userId);
    const debt = loans.reduce((sum, loan) => sum + loan.remaining, 0);
    const payment = amount ?? debt;
    if (!wallet) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not-ready" };
    }
    if (debt === 0 || payment === 0 || payment > debt) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }
    if (wallet.balance < payment) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient" };
    }

    let left = payment;
    for (const loan of loans) {
      if (left === 0) break;
      const payment = Math.min(left, loan.remaining);
      const remaining = loan.remaining - payment;
      db.prepare("UPDATE casino_loans SET remaining=?, settled_at=? WHERE loan_id=?")
        .run(remaining, remaining === 0 ? at : null, loan.id);
      left -= payment;
    }
    db.prepare("UPDATE casino_wallets SET balance=balance-?, updated_at=? WHERE user_id=? AND balance>=?")
      .run(payment, at, userId, payment);
    const overdue = reconcileBalanceFreeze(userId, at);
    const updatedWallet = getWallet(userId);
    if (!updatedWallet) throw new Error("Wallet tidak tersedia setelah pelunasan.");
    db.exec("COMMIT");
    return { ok: true, loans: getActiveLoans(platform, userId), walletBalance: updatedWallet.balance, frozen: overdue };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function repayLoan(platform: string, userId: string, amount: number, at: number = Date.now()): LoanResult {
  return repay(platform, userId, amount, at);
}

export function repayAllLoans(platform: string, userId: string, at: number = Date.now()): LoanResult {
  return repay(platform, userId, null, at);
}

export function getDueLoanReminders(now: number = Date.now()): DueLoanReminder[] {
  const db = getDb();
  if (!db) return [];
  const rows = db.prepare(`SELECT * FROM casino_loans
    WHERE settled_at IS NULL AND remaining > 0 AND warned_at IS NULL AND due_at<=? ORDER BY due_at, loan_id`).all(now);
  return rows.map((row) => mapLoan(row as Record<string, unknown>));
}

export function freezeDueLoan(loan: Loan, at: number = Date.now()): boolean {
  const db = getDb();
  if (!db) return false;
  db.exec("BEGIN IMMEDIATE");
  try {
    const exists = db.prepare(`SELECT 1 AS found FROM casino_loans
      WHERE loan_id=? AND settled_at IS NULL AND remaining > 0 AND due_at<=?`).get(loan.id, at);
    if (!exists) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("UPDATE casino_wallets SET balance_frozen=1, updated_at=? WHERE user_id=?").run(at, loan.userId);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markLoanWarned(loanId: number, at: number = Date.now()): void {
  getDb()?.prepare("UPDATE casino_loans SET warned_at=? WHERE loan_id=? AND warned_at IS NULL AND settled_at IS NULL")
    .run(at, loanId);
}

export function totalDebt(platform: string, userId: string): number {
  return getActiveLoans(platform, userId).reduce((sum, loan) => sum + loan.remaining, 0);
}

export interface LoanReminderSenders {
  telegram: (userId: string, text: string) => Promise<void>;
  whatsapp: (userId: string, text: string) => Promise<void>;
}

export function startLoanReminderScheduler(senders: LoanReminderSenders, intervalMs: number = 15_000): () => void {
  let stopped = false;
  let running = false;
  const processDue = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      for (const loan of getDueLoanReminders()) {
        if (!freezeDueLoan(loan)) continue;
        const message = `Peringatan: pinjaman Rp${loan.principal.toLocaleString("id-ID")} sudah jatuh tempo. Saldo wallet dibekukan. Lunasi sisa Rp${loan.remaining.toLocaleString("id-ID")} dengan pinjam bayar <jumlah>.`;
        try {
          const sender = loan.platform === "telegram" ? senders.telegram : loan.platform === "whatsapp" ? senders.whatsapp : null;
          if (!sender) continue;
          await sender(loan.userId, message);
          markLoanWarned(loan.id);
        } catch {
          // Leave it pending so the next scheduler pass retries the reminder.
        }
      }
    } finally {
      running = false;
    }
  };
  void processDue();
  const timer = setInterval(() => { void processDue(); }, intervalMs);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
