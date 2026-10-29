import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, initDatabase } from "../src/lib/db.js";
import { addXp } from "../src/lib/xp-storage.js";
import { awardLevels, changeBalance, clearBlackjack, getBlackjack, getWallet } from "../src/lib/casino-storage.js";
import { playCasino, validateCasino } from "../src/lib/casino.js";
import { checkRateLimit, resetRateLimits } from "../src/core/access.js";

describe("virtual casino and points", () => {
  beforeEach(() => { closeDatabase(); initDatabase(":memory:"); resetRateLimits(); });
  afterEach(() => closeDatabase());

  it("creates one shared virtual wallet with separate points", () => {
    assert.deepEqual(getWallet("user-1"), { balance: 100_000, points: 0, bankBalance: 0 });
    assert.equal(getWallet("user-1")?.balance, 100_000);
  });

  it("awards exactly one point per newly reached level and survives repeats", async () => {
    await addXp({ platform: "telegram", chatId: "g", userId: "u", displayName: null, amount: 299 });
    assert.equal(getWallet("u")?.points, 1);
    await addXp({ platform: "telegram", chatId: "g", userId: "u", displayName: null, amount: 1 });
    assert.equal(getWallet("u")?.points, 2);
    assert.equal(awardLevels("telegram", "g", "u", 3), 0);
    assert.equal(getWallet("u")?.points, 2);
  });

  it("does not grant retroactive points for levels already reached before tracking", async () => {
    const db = (await import("../src/lib/db.js")).getDb();
    db?.prepare("INSERT INTO xp(platform, chat_id, user_id, display_name, xp, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("telegram", "g", "legacy", null, 500, 1);
    await addXp({ platform: "telegram", chatId: "g", userId: "legacy", displayName: null, amount: 1 });
    assert.equal(getWallet("legacy")?.points, 0);
  });

  it("validates stakes before playing and settles slot, coin and roulette", () => {
    assert.ok(validateCasino("slot", "0", "u"));
    assert.ok(validateCasino("coin", "50 maybe", "u"));
    assert.ok(validateCasino("roulette", "50 red", "u"));
    for (const [game, args] of [["slot", "100"], ["coin", "100 cara"], ["roulette", "100 merah"]] as const) {
      assert.equal(validateCasino(game, args, "u"), null);
      playCasino(game, args, "u");
      assert.ok((getWallet("u")?.balance ?? 0) >= 99_000);
    }
  });

  it("credits slot wins, debits losses, and accepts stakes above the old cap", () => {
    const original = Math.random;
    try {
      const starting = getWallet("slot-user")?.balance ?? 0;
      Math.random = () => 0;
      playCasino("slot", "100", "slot-user");
      assert.equal(getWallet("slot-user")?.balance, starting + 400);

      Math.random = (() => {
        const reels = [0, 0.4, 0.8];
        let index = 0;
        return () => reels[index++] ?? 0.8;
      })();
      const beforeLoss = getWallet("slot-user")?.balance ?? 0;
      playCasino("slot", "100", "slot-user");
      assert.equal(getWallet("slot-user")?.balance, beforeLoss - 100);

      changeBalance("slot-user", 1_000_000_000);
      assert.equal(validateCasino("slot", "100000000", "slot-user"), null);
    } finally {
      Math.random = original;
    }
  });

  it("persists blackjack between actions and clears a finished hand", () => {
    const original = Math.random;
    Math.random = () => 0.4;
    try {
      playCasino("blackjack", "100", "u");
      assert.ok(getBlackjack("u"));
      assert.equal(validateCasino("blackjack", "hit", "u"), null);
      playCasino("blackjack", "hit", "u");
      assert.ok(getBlackjack("u"));
      playCasino("blackjack", "stand", "u");
      assert.equal(getBlackjack("u"), null);
    } finally { Math.random = original; clearBlackjack("u"); }
  });

  it("enforces three requests per fixed window", () => {
    process.env.RATE_LIMIT = "3";
    assert.equal(checkRateLimit("telegram", "u", 0).allowed, true);
    assert.equal(checkRateLimit("telegram", "u", 1).allowed, true);
    assert.equal(checkRateLimit("telegram", "u", 2).allowed, true);
    assert.equal(checkRateLimit("telegram", "u", 3).allowed, false);
  });
});
