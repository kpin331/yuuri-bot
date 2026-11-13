import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, getDb, getQuotaRow, initDatabase, setQuotaRow } from "../src/lib/db.js";
import { getWallet, purchaseQuota } from "../src/lib/casino-storage.js";
import { quoteQuotaRefill, QUOTA_PACKAGES, type QuotaPackage } from "../src/lib/quota-packages.js";
import { quotaPurchaseMessage } from "../src/lib/quota-economy.js";
import { getQuota, resetAllQuotas } from "../src/core/access.js";
import { tzDateKey } from "../src/core/time.js";
import { registerQuota } from "../src/handlers/quota.js";
import { quotaCommand } from "../src/platform/whatsapp/commands/quota.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";
import { createTestBot } from "./helpers.js";

const envKeys = ["DEFAULT_QUOTA", "ADMIN_QUOTA", "TIMEZONE", "OWNER_ID", "ADMIN_IDS", "EVERYONE"];
let saved: Array<string | undefined>;
beforeEach(() => {
  saved = envKeys.map((key) => process.env[key]);
  envKeys.forEach((key) => delete process.env[key]);
  process.env.TIMEZONE = "Asia/Jakarta";
  closeDatabase();
  initDatabase(":memory:");
});
afterEach(() => {
  closeDatabase();
  envKeys.forEach((key, index) => {
    if (saved[index] === undefined) delete process.env[key];
    else process.env[key] = saved[index];
  });
});

function seed(platform = "telegram", userId = "buyer", remaining = 0, dailyBonus = 0, permanentBonus = 0) {
  const now = Date.now();
  const today = tzDateKey(now, "Asia/Jakarta");
  setQuotaRow({ platform, userId, quotaLeft: remaining, dailyBonus, permanentBonus, lastReset: today, displayName: "Buyer", at: now });
  getWallet(userId);
  return { now, today };
}

describe("quota refill packages", () => {
  it("rounds percentages up and prices actual units with both price bounds", () => {
    assert.deepEqual(quoteQuotaRefill("minimum", 50, 0), { amount: 13, cost: 1_300 });
    assert.deepEqual(quoteQuotaRefill("basic", 50, 0), { amount: 25, cost: 2_500 });
    assert.deepEqual(quoteQuotaRefill("max", 50, 0), { amount: 50, cost: 5_000 });
    assert.deepEqual(quoteQuotaRefill("minimum", 59, 0), { amount: 15, cost: 1_500 });
    assert.deepEqual(quoteQuotaRefill("basic", 59, 0), { amount: 30, cost: 3_000 });
    assert.deepEqual(quoteQuotaRefill("minimum", 1, 0), { amount: 1, cost: 500 });
    assert.deepEqual(quoteQuotaRefill("max", 500, 0), { amount: 500, cost: 50_000 });
    assert.deepEqual(quoteQuotaRefill("max", 2_000, 0), { amount: 2_000, cost: 50_000 });
    for (const name of QUOTA_PACKAGES) {
      assert.deepEqual(quoteQuotaRefill(name, 50, 49), { amount: 1, cost: 500 });
      assert.deepEqual(quoteQuotaRefill(name, 50, 50), { amount: 0, cost: 0 });
      assert.deepEqual(quoteQuotaRefill(name, 50, 60), { amount: 0, cost: 0 });
    }
    assert.equal(quoteQuotaRefill("max", Infinity, 0), null);
    assert.equal(quoteQuotaRefill("max", 50, -1), null);
    assert.equal(quoteQuotaRefill("basic", 1.5, 0), null);
    assert.equal(quoteQuotaRefill("unknown" as QuotaPackage, 50, 0), null);
  });

  it("stops repeated refills at the existing limit without charging a full user", () => {
    const { now, today } = seed();
    for (let i = 1; i <= 2; i++) {
      const result = purchaseQuota("telegram", "buyer", "basic", "member", today, now);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.quotaLeft, i * 25);
      assert.equal(result.cost, 2_500);
    }
    const before = getWallet("buyer");
    const row = getQuotaRow("telegram", "buyer");
    assert.deepEqual(purchaseQuota("telegram", "buyer", "max", "member", today, now), { ok: false, reason: "full" });
    assert.deepEqual(getWallet("buyer"), before);
    assert.deepEqual(getQuotaRow("telegram", "buyer"), row);
    assert.match(quotaPurchaseMessage("telegram", "buyer", "member", "Buyer", "max", "/"), /sudah penuh.*tidak dipotong/);
  });

  it("charges only the remaining space and honors the lower price bound", () => {
    const { now, today } = seed("telegram", "buyer", 48);
    const result = purchaseQuota("telegram", "buyer", "minimum", "member", today, now);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.amount, 2);
    assert.equal(result.cost, 500);
    assert.equal(result.quotaLeft, 50);
    assert.equal(result.wallet.balance, 99_500);
  });

  it("uses role limits and old bonuses, preserving them after manual reset", () => {
    process.env.ADMIN_QUOTA = "100";
    process.env.ADMIN_IDS = "333";
    const { now, today } = seed("telegram", "333", 0, 9, 10);
    const result = purchaseQuota("telegram", "333", "basic", "admin", today, now);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.amount, 60);
    assert.equal(result.cost, 6_000);
    assert.equal(getQuota("telegram", "333", "admin", "Buyer", now).total, 119);
    resetAllQuotas(now);
    assert.equal(getQuotaRow("telegram", "333")?.quotaLeft, 119);
    assert.equal(getQuotaRow("telegram", "333")?.dailyBonus, 9);
    assert.equal(getQuotaRow("telegram", "333")?.permanentBonus, 10);
  });

  it("caps the debit at Rp50000 for a large refill", () => {
    process.env.DEFAULT_QUOTA = "2000";
    const { now, today } = seed();
    const result = purchaseQuota("telegram", "buyer", "max", "member", today, now);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.quotaLeft, 2_000);
    assert.equal(result.cost, 50_000);
    assert.equal(result.wallet.balance, 50_000);
  });

  it("rejects frozen, invalid and stale requests without changing wallet or quota", () => {
    const { now, today } = seed();
    const before = getWallet("buyer");
    const row = getQuotaRow("telegram", "buyer");
    assert.deepEqual(purchaseQuota("telegram", "buyer", "upgrade" as QuotaPackage, "member", today, now), { ok: false, reason: "invalid" });
    assert.deepEqual(purchaseQuota("telegram", "buyer", "max", "member", "2000-01-01", now), { ok: false, reason: "not-ready" });
    getDb()!.prepare("UPDATE casino_wallets SET balance_frozen=1 WHERE user_id=?").run("buyer");
    assert.deepEqual(purchaseQuota("telegram", "buyer", "max", "member", today, now), { ok: false, reason: "frozen" });
    assert.deepEqual(getWallet("buyer"), before);
    assert.deepEqual(getQuotaRow("telegram", "buyer"), row);
  });

  it("rolls back wallet debits when saving quota fails", () => {
    const { now, today } = seed();
    const before = getWallet("buyer");
    const row = getQuotaRow("telegram", "buyer");
    getDb()!.exec("CREATE TRIGGER fail_quota BEFORE UPDATE ON platform_quota BEGIN SELECT RAISE(ABORT, 'quota write failed'); END");
    assert.throws(() => purchaseQuota("telegram", "buyer", "max", "member", today, now), /quota write failed/);
    assert.deepEqual(getWallet("buyer"), before);
    assert.deepEqual(getQuotaRow("telegram", "buyer"), row);
  });

  it("shows current quotes and uses the same prices on Telegram and WhatsApp", async () => {
    seed("telegram", "222");
    const t = createTestBot();
    registerQuota(t.bot);
    await t.bot.handleUpdate(t.textUpdate("/quota"));
    assert.match(t.replies()[0] ?? "", /minimum.*\+13.*Rp1\.300[\s\S]*basic.*\+25.*Rp2\.500[\s\S]*max.*\+50.*Rp5\.000/);
    await t.bot.handleUpdate(t.textUpdate("/quota BASIC"));
    assert.equal(getQuotaRow("telegram", "222")?.quotaLeft, 25);
    assert.equal(getWallet("222")?.balance, 97_500);
    seed("whatsapp", "628111");
    const replies: string[] = [];
    const message = { userId: "628111", name: "Buyer", chatId: "chat", message: {}, sock: {
      sendMessage: async (_jid: string, content: { text?: string }) => { replies.push(content.text ?? ""); return {}; },
    } } as unknown as IncomingMessage;
    await quotaCommand.run({ message, args: "basic", role: "member" });
    assert.equal(getQuotaRow("whatsapp", "628111")?.quotaLeft, 25);
    assert.equal(getWallet("628111")?.balance, 97_500);
    assert.match(replies[0] ?? "", /\+25 kuota seharga Rp2\.500/);
  });

  it("applies daily reset before quoting purchases and never charges unlimited users", () => {
    seed();
    getDb()!.prepare("UPDATE platform_quota SET last_reset=? WHERE user_id=?").run("2000-01-01", "buyer");
    assert.match(quotaPurchaseMessage("telegram", "buyer", "member", "Buyer", "max", "/"), /sudah penuh/);
    assert.equal(getWallet("buyer")?.balance, 100_000);
    assert.equal(getQuotaRow("telegram", "buyer")?.quotaLeft, 50);
    assert.equal(quotaPurchaseMessage("telegram", "owner", "owner", "Owner", "max", "/"), "Kuota kamu tidak terbatas.");
    assert.equal(getDb()!.prepare("SELECT * FROM casino_wallets WHERE user_id=?").get("owner"), undefined);
  });
});
