import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, getDb, initDatabase } from "../src/lib/db.js";
import { changeBalance, getWallet, isBalanceFrozen, transferBank } from "../src/lib/casino-storage.js";
import { borrowLoan, freezeDueLoan, getActiveLoans, getDueLoanReminders, markLoanWarned, repayAllLoans, repayLoan } from "../src/lib/loans.js";
import { payOffAllLoansMessage } from "../src/lib/economy.js";

describe("virtual loans", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => closeDatabase());

  it("adds 10 percent flat interest, caps each loan, and allows at most five active loans", () => {
    const start = Date.UTC(2026, 0, 1);
    const first = borrowLoan("telegram", "borrower", 500_000, start, start + 20 * 60_000);
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.loans[0]?.remaining, 550_000);
    assert.equal(first.ok && first.walletBalance, 600_000);

    for (let index = 0; index < 4; index += 1) {
      assert.equal(borrowLoan("telegram", "borrower", 1, start, start + (21 + index) * 60_000).ok, true);
    }
    const sixth = borrowLoan("telegram", "borrower", 1, start, start + 30 * 60_000);
    assert.equal(sixth.ok, false);
    if (!sixth.ok) assert.equal(sixth.reason, "limit");
    assert.equal(getActiveLoans("telegram", "borrower").length, 5);

    const tooLarge = borrowLoan("telegram", "other", 500_001, start, start + 20 * 60_000);
    assert.equal(tooLarge.ok, false);
    if (!tooLarge.ok) assert.equal(tooLarge.reason, "invalid");
  });

  it("warns after the due time, freezes spending, and unfreezes after repayment", () => {
    const start = Date.UTC(2026, 0, 1);
    const dueAt = start + 20 * 60_000;
    const borrowed = borrowLoan("whatsapp", "payer", 10_000, start, dueAt);
    assert.equal(borrowed.ok, true);
    const due = getDueLoanReminders(dueAt);
    assert.equal(due.length, 1);
    assert.equal(freezeDueLoan(due[0]!, dueAt), true);
    assert.equal(isBalanceFrozen("payer"), true);
    assert.equal(changeBalance("payer", -1), null);
    const bankTransfer = transferBank("payer", "withdraw", 1_000);
    assert.equal(bankTransfer.ok, false);
    if (!bankTransfer.ok) assert.equal(bankTransfer.reason, "frozen");

    markLoanWarned(due[0]!.id, dueAt);
    assert.equal(getDueLoanReminders(dueAt).length, 0);
    const repaid = repayLoan("whatsapp", "payer", 11_000, dueAt + 1);
    assert.equal(repaid.ok, true);
    assert.equal(getActiveLoans("whatsapp", "payer").length, 0);
    assert.equal(isBalanceFrozen("payer"), false);
    assert.equal(getWallet("payer")?.balance, 99_000);
  });

  it("keeps the debt and freezes again until all overdue debt is paid", () => {
    const start = Date.UTC(2026, 0, 1);
    const dueAt = start + 20 * 60_000;
    borrowLoan("telegram", "partial", 10_000, start, dueAt);
    const [loan] = getDueLoanReminders(dueAt);
    assert.ok(loan);
    freezeDueLoan(loan, dueAt);
    const partial = repayLoan("telegram", "partial", 5_000, dueAt + 1);
    assert.equal(partial.ok && partial.frozen, true);
    assert.equal(partial.ok && partial.loans[0]?.remaining, 6_000);
    assert.equal(isBalanceFrozen("partial"), true);
  });

  it("pays every active loan atomically and reports insufficient funds without changing debt", () => {
    const start = Date.UTC(2026, 0, 1);
    borrowLoan("telegram", "lunas-user", 10_000, start, start + 20 * 60_000);
    borrowLoan("telegram", "lunas-user", 5_000, start, start + 21 * 60_000);
    const paid = repayAllLoans("telegram", "lunas-user", start + 1);
    assert.equal(paid.ok, true);
    assert.equal(paid.ok && paid.walletBalance, 98_500);
    assert.equal(getActiveLoans("telegram", "lunas-user").length, 0);

    borrowLoan("telegram", "short-user", 10_000, start, start + 20 * 60_000);
    changeBalance("short-user", -100_000);
    const insufficient = repayAllLoans("telegram", "short-user", start + 1);
    assert.equal(insufficient.ok, false);
    if (!insufficient.ok) assert.equal(insufficient.reason, "insufficient");
    assert.equal(getActiveLoans("telegram", "short-user")[0]?.remaining, 11_000);
  });

  it("ignores zero-balance unsettled rows and clears a stale freeze on /lunas", () => {
    const start = Date.UTC(2026, 0, 1);
    const dueAt = start + 20 * 60_000;
    const loan = borrowLoan("telegram", "zero-balance", 10_000, start, dueAt);
    assert.equal(loan.ok, true);
    if (!loan.ok || !loan.createdLoan) return;
    assert.equal(freezeDueLoan(loan.createdLoan, dueAt), true);
    getDb()?.prepare("UPDATE casino_loans SET remaining=0, settled_at=NULL WHERE loan_id=?").run(loan.createdLoan.id);

    assert.equal(getActiveLoans("telegram", "zero-balance").length, 0);
    assert.equal(getDueLoanReminders(dueAt).length, 0);
    assert.equal(isBalanceFrozen("zero-balance"), true);
    assert.match(payOffAllLoansMessage("telegram", "zero-balance", dueAt + 1), /Status beku wallet sudah dipulihkan/);
    assert.equal(isBalanceFrozen("zero-balance"), false);
    assert.notEqual(getDb()?.prepare("SELECT settled_at FROM casino_loans WHERE loan_id=?").get(loan.createdLoan.id)?.settled_at, null);
  });

  it("does not claim all loans are paid when another overdue platform loan remains", () => {
    const start = Date.UTC(2026, 0, 1);
    const dueAt = start + 20 * 60_000;
    const telegramLoan = borrowLoan("telegram", "cross-platform", 10_000, start, dueAt);
    const whatsappLoan = borrowLoan("whatsapp", "cross-platform", 10_000, start, dueAt);
    assert.equal(telegramLoan.ok, true);
    assert.equal(whatsappLoan.ok, true);
    if (!telegramLoan.ok || !telegramLoan.createdLoan || !whatsappLoan.ok || !whatsappLoan.createdLoan) return;
    freezeDueLoan(telegramLoan.createdLoan, dueAt);
    freezeDueLoan(whatsappLoan.createdLoan, dueAt);

    const message = payOffAllLoansMessage("telegram", "cross-platform", dueAt + 1);

    assert.match(message, /Pinjaman di platform ini sudah dilunasi/);
    assert.match(message, /Saldo masih dibekukan karena ada pinjaman jatuh tempo lainnya/);
    assert.doesNotMatch(message, /Semua pinjaman di platform ini lunas/);
    assert.equal(isBalanceFrozen("cross-platform"), true);
    assert.equal(getActiveLoans("whatsapp", "cross-platform").length, 1);
  });
});
