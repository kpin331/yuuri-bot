import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, getDb, initDatabase } from "../src/lib/db.js";
import { exchangePoints, getWallet, purchaseQuota, transferBank } from "../src/lib/casino-storage.js";
import { getQuota, consumeQuota } from "../src/core/access.js";
import { tzDateKey } from "../src/core/time.js";
import { quotaPurchaseMessage } from "../src/lib/quota-economy.js";
import { formatCommandHelp } from "../src/lib/command-help.js";
import { bankMessage, exchangePointsMessage } from "../src/lib/economy.js";
import { findCommand } from "../src/platform/whatsapp/commands/index.js";
import { registerEconomy } from "../src/handlers/economy.js";
import { registerQuota } from "../src/handlers/quota.js";
import { createTestBot } from "./helpers.js";

describe("virtual wallet exchange and bank", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => closeDatabase());

  it("lists exchange choices up to 50 points and caps each conversion", () => {
    const menu = exchangePointsMessage("user", "", ".");
    assert.match(menu, /1 Point = Rp10\.000/);
    assert.match(menu, /50 Point = Rp500\.000/);

    getDb()?.prepare("UPDATE casino_wallets SET points=55 WHERE user_id=?").run("user");
    const result = exchangePoints("user", 50);
    assert.equal(result.ok, true);
    assert.deepEqual(getWallet("user"), { balance: 600_000, points: 5, bankBalance: 0 });
    const tooMany = exchangePoints("user", 51);
    assert.equal(tooMany.ok, false);
    if (!tooMany.ok) assert.equal(tooMany.reason, "invalid");
    const tooFew = exchangePoints("user", 6);
    assert.equal(tooFew.ok, false);
    if (!tooFew.ok) assert.equal(tooFew.reason, "insufficient");
  });

  it("moves funds between wallet and bank without creating or losing money", () => {
    assert.equal(transferBank("user", "deposit", 40_000).ok, true);
    assert.deepEqual(getWallet("user"), { balance: 60_000, points: 0, bankBalance: 40_000 });

    assert.equal(transferBank("user", "withdraw", 10_000).ok, true);
    assert.deepEqual(getWallet("user"), { balance: 70_000, points: 0, bankBalance: 30_000 });
    const overdraft = transferBank("user", "withdraw", 30_001);
    assert.equal(overdraft.ok, false);
    if (!overdraft.ok) assert.equal(overdraft.reason, "insufficient");
    const zero = transferBank("user", "deposit", 0);
    assert.equal(zero.ok, false);
    if (!zero.ok) assert.equal(zero.reason, "invalid");
  });

  it("shows bank balances and parses Indonesian thousands separators", () => {
    assert.match(bankMessage("user", "", "."), /\.bank deposit <jumlah>/);
    assert.match(bankMessage("user", "deposit 10.000", "."), /Rp10\.000/);
    assert.deepEqual(getWallet("user"), { balance: 90_000, points: 0, bankBalance: 10_000 });
  });

  it("registers both commands on WhatsApp", () => {
    assert.equal(findCommand("tukar")?.free, true);
    assert.equal(findCommand("bank")?.free, true);
    assert.equal(findCommand("quota")?.free, true);
  });

  it("registers the bank command on Telegram", async () => {
    const test = createTestBot();
    registerEconomy(test.bot);
    await test.bot.handleUpdate(test.textUpdate("/bank"));
    assert.match(test.replies()[0] ?? "", /Saldo bank: Rp0/);
  });

  it("registers /quota on Telegram and shows purchase options", async () => {
    const test = createTestBot();
    registerQuota(test.bot);
    await test.bot.handleUpdate(test.textUpdate("/quota"));
    assert.match(test.replies()[0] ?? "", /1 kuota = Rp5\.000/);
    assert.match(test.replies()[0] ?? "", /upgrade/);
  });

  it("adds a bank column to an existing wallet database", async () => {
    closeDatabase();
    const root = await mkdtemp(join(tmpdir(), "yuuri-bank-migration-"));
    const path = join(root, "bot.db");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`CREATE TABLE casino_wallets (
        user_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 100000 CHECK(balance >= 0),
        points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
        updated_at INTEGER NOT NULL
      )`);
      legacy.exec(`CREATE TABLE platform_quota (
        platform TEXT NOT NULL,
        user_id TEXT NOT NULL,
        quota_left INTEGER NOT NULL,
        last_reset TEXT NOT NULL,
        display_name TEXT,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (platform, user_id)
      )`);
      legacy.prepare("INSERT INTO casino_wallets(user_id,balance,points,updated_at) VALUES(?,?,?,?)")
        .run("existing", 250_000, 7, Date.now());
      legacy.close();

      initDatabase(path);
      assert.deepEqual(getWallet("existing"), { balance: 250_000, points: 7, bankBalance: 0 });
      const quotaColumns = getDb()?.prepare("PRAGMA table_info(platform_quota)").all() as Array<{ name: string }>;
      assert.ok(quotaColumns.some((column) => column.name === "quota_bonus_daily"));
      assert.ok(quotaColumns.some((column) => column.name === "quota_bonus_permanent"));
    } finally {
      closeDatabase();
      await rm(root, { recursive: true, force: true });
      initDatabase(":memory:");
    }
  });
});

describe("quota purchases", () => {
  const quotaEnv = ["TIMEZONE", "OWNER_NUMBER", "OWNER_NUMBERS", "ADMIN_NUMBERS", "DEFAULT_QUOTA", "ADMIN_QUOTA"] as const;
  let previousEnv: Record<string, string | undefined>;

  beforeEach(() => {
    previousEnv = Object.fromEntries(quotaEnv.map((key) => [key, process.env[key]]));
    closeDatabase();
    initDatabase(":memory:");
    process.env.TIMEZONE = "UTC";
    delete process.env.OWNER_NUMBER;
    delete process.env.OWNER_NUMBERS;
    delete process.env.ADMIN_NUMBERS;
    delete process.env.DEFAULT_QUOTA;
    delete process.env.ADMIN_QUOTA;
  });

  afterEach(() => {
    closeDatabase();
    for (const key of quotaEnv) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("adds paid quota for today, keeps it platform-scoped, and resets it next day", () => {
    const day1 = Date.UTC(2026, 0, 1, 12);
    getQuota("telegram", "buyer", "member", "Buyer", day1);
    const today = tzDateKey(day1, "UTC");
    const bought = purchaseQuota("telegram", "buyer", { kind: "daily", amount: 2 }, today, day1);
    assert.equal(bought.ok, true);
    if (!bought.ok) return;
    assert.equal(bought.quotaLeft, 27);
    assert.equal(bought.wallet.balance, 90_000);
    assert.equal(getQuota("whatsapp", "buyer", "member", "Buyer", day1).total, 25);
    assert.equal(getQuota("telegram", "buyer", "member", "Buyer", day1).total, 27);
    consumeQuota("telegram", "buyer", 27);
    assert.equal(getQuota("telegram", "buyer", "member", "Buyer", day1).quotaLeft, 0);
    assert.equal(getQuota("telegram", "buyer", "member", "Buyer", day1 + 86_400_000).total, 25);
    assert.equal(getQuota("telegram", "buyer", "member", "Buyer", day1 + 86_400_000).quotaLeft, 25);
  });

  it("adds stackable permanent capacity and keeps it after daily reset", () => {
    const day1 = Date.UTC(2026, 0, 1, 12);
    getQuota("whatsapp", "buyer", "member", "Buyer", day1);
    getWallet("buyer");
    getDb()?.prepare("UPDATE casino_wallets SET balance=1100000 WHERE user_id=?").run("buyer");
    let today = tzDateKey(day1, "UTC");
    assert.equal(purchaseQuota("whatsapp", "buyer", { kind: "upgrade" }, today, day1).ok, true);
    assert.equal(purchaseQuota("whatsapp", "buyer", { kind: "upgrade" }, today, day1).ok, true);
    assert.equal(getQuota("whatsapp", "buyer", "member", "Buyer", day1).total, 45);
    const nextDay = day1 + 86_400_000;
    today = tzDateKey(nextDay, "UTC");
    assert.equal(getQuota("whatsapp", "buyer", "member", "Buyer", nextDay).total, 45);
    assert.equal(getWallet("buyer")?.balance, 100_000);
  });

  it("rejects invalid or unaffordable purchases without changing balances", () => {
    const today = tzDateKey(Date.now(), "UTC");
    getQuota("telegram", "buyer", "member", "Buyer");
    getWallet("buyer");
    getDb()?.prepare("UPDATE casino_wallets SET balance=1000 WHERE user_id=?").run("buyer");
    const invalid = purchaseQuota("telegram", "buyer", { kind: "daily", amount: 26 }, today);
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.reason, "invalid");
    const response = quotaPurchaseMessage("telegram", "buyer", "member", "Buyer", "1", "/");
    assert.match(response, /Saldo wallet tidak cukup/);
    assert.equal(getWallet("buyer")?.balance, 1_000);
    assert.equal(getQuota("telegram", "buyer", "member", "Buyer").quotaLeft, 25);
    assert.match(formatCommandHelp("quota", "telegram"), /upgrade/);
    assert.match(formatCommandHelp("quota", "whatsapp"), /jumlah 1-25/);
  });
});
