import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, getDb, initDatabase } from "../src/lib/db.js";
import { exchangePoints, getWallet, transferBank } from "../src/lib/casino-storage.js";
import { bankMessage, exchangePointsMessage } from "../src/lib/economy.js";
import { findCommand } from "../src/platform/whatsapp/commands/index.js";
import { registerEconomy } from "../src/handlers/economy.js";
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
  });

  it("registers the bank command on Telegram", async () => {
    const test = createTestBot();
    registerEconomy(test.bot);
    await test.bot.handleUpdate(test.textUpdate("/bank"));
    assert.match(test.replies()[0] ?? "", /Saldo bank: Rp0/);
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
      legacy.prepare("INSERT INTO casino_wallets(user_id,balance,points,updated_at) VALUES(?,?,?,?)")
        .run("existing", 250_000, 7, Date.now());
      legacy.close();

      initDatabase(path);
      assert.deepEqual(getWallet("existing"), { balance: 250_000, points: 7, bankBalance: 0 });
    } finally {
      closeDatabase();
      await rm(root, { recursive: true, force: true });
      initDatabase(":memory:");
    }
  });
});
