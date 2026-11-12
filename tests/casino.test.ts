import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, initDatabase } from "../src/lib/db.js";
import { addXp } from "../src/lib/xp-storage.js";
import { awardLevels, changeBalance, clearBlackjack, getBlackjack, getWallet, saveBlackjack } from "../src/lib/casino-storage.js";
import { playCasino, validateCasino, rollCasinoWin, type CasinoGame } from "../src/lib/casino.js";
import { checkRateLimit, resetRateLimits } from "../src/core/access.js";
import { formatCommandHelp } from "../src/lib/command-help.js";

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

  it("credits slot wins, debits losses, and rejects stakes above the cap", () => {
    const original = Math.random;
    try {
      const starting = getWallet("slot-user")?.balance ?? 0;
      Math.random = () => 0;
      playCasino("slot", "100", "slot-user");
      assert.equal(getWallet("slot-user")?.balance, starting + 400);

      Math.random = (() => {
        const reels = [0.65, 0.4, 0.8];
        let index = 0;
        return () => reels[index++] ?? 0.8;
      })();
      const beforeLoss = getWallet("slot-user")?.balance ?? 0;
      playCasino("slot", "100", "slot-user");
      assert.equal(getWallet("slot-user")?.balance, beforeLoss - 100);

      changeBalance("slot-user", 1_000_000_000);
      assert.match(validateCasino("slot", "100000000", "slot-user") ?? "", /Rp50\.000\.000/);
    } finally {
      Math.random = original;
    }
  });

  it("enforces inclusive bet bounds on every game without changing balances", () => {
    for (const game of ["slot", "coin", "roulette", "blackjack"] as const) {
      const suffix = game === "coin" ? " cara" : game === "roulette" ? " 0" : "";
      changeBalance(game, 100_000_000);
      for (const bet of [100, 50_000_000]) assert.equal(validateCasino(game, `${bet}${suffix}`, game), null);
      for (const bet of [99, 50_000_001]) {
        const before = getWallet(game);
        assert.match(playCasino(game, `${bet}${suffix}`, game), /Rp100.*Rp50\.000\.000/);
        assert.deepEqual(getWallet(game), before);
        assert.equal(getBlackjack(game), null);
      }
    }
  });

  it("uses a strict 65 percent threshold and pays exactly 65 of 100 sampled outcomes per game", () => {
    const original = Math.random;
    try {
      Math.random = () => 0.649999;
      assert.equal(rollCasinoWin(), true);
      Math.random = () => 0.65;
      assert.equal(rollCasinoWin(), false);
      const cases: Array<[CasinoGame, string]> = [["slot", "100"], ["coin", "100 cara"], ["coin", "100 angka"], ["roulette", "100 merah"], ["roulette", "100 hitam"], ["roulette", "100 0"], ["roulette", "100 36"], ["blackjack", "100"]];
      for (const [game, args] of cases) {
        let wins = 0;
        for (let sample = 0; sample < 100; sample++) {
          const user = `${game}-${args}-${sample}`;
          const before = getWallet(user)!.balance;
          if (game === "blackjack") {
            Math.random = () => 0.4;
            playCasino(game, args, user);
            assert.ok(getBlackjack(user));
          }
          let rolls = 0;
          Math.random = () => rolls++ === 0 ? sample / 100 : 0;
          const reply = playCasino(game, game === "blackjack" ? "stand" : args, user);
          const after = getWallet(user)!.balance;
          if (sample < 65) {
            wins++;
            assert.ok(after > before, `${game}: ${reply}`);
            assert.match(reply, /menang/i);
          } else {
            assert.equal(after, before - 100, `${game}: ${reply}`);
          }
          if (game === "blackjack") {
            assert.equal(rolls, 1);
            assert.equal(getBlackjack(user), null);
            playCasino(game, "stand", user);
            assert.equal(getWallet(user)!.balance, after);
          }
        }
        assert.equal(wins, 65);
      }
    } finally { Math.random = original; }
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

  it("uses the same draw for blackjack natural, 21 and bust endings", () => {
    const original = Math.random;
    try {
      for (const win of [true, false]) {
        const naturalUser = `natural-${win}`;
        const values = [0, 0.75, 0.4, 0.4, win ? 0.64 : 0.65];
        Math.random = () => values.shift() ?? 0.99;
        playCasino("blackjack", "100", naturalUser);
        assert.equal(getWallet(naturalUser)!.balance, win ? 100_150 : 99_900);
        assert.equal(getBlackjack(naturalUser), null);
        for (const hand of [[10, 10], [10, 5]]) {
          const user = `${hand}-${win}`;
          changeBalance(user, -100);
          saveBlackjack(user, { bet: 100, hand, dealer: [10, 10] });
          const draws = [0.4, win ? 0.64 : 0.65];
          Math.random = () => draws.shift() ?? 0.99;
          playCasino("blackjack", "hit", user);
          assert.equal(getWallet(user)!.balance, win ? 100_100 : 99_900);
          assert.equal(getBlackjack(user), null);
          assert.equal(draws.length, 0);
        }
      }
    } finally { Math.random = original; }
  });

  it("settles the maximum roulette bet and documents limits without probability labels", () => {
    const original = Math.random;
    try {
      changeBalance("max", 50_000_000);
      Math.random = () => 0;
      playCasino("roulette", "50000000 0", "max");
      assert.equal(getWallet("max")!.balance, 1_800_100_000);
      for (const platform of ["telegram", "whatsapp"] as const) {
        for (const game of ["slot", "coin", "roulette", "blackjack"]) {
          assert.match(formatCommandHelp(game, platform), /Rp100[\s\S]*Rp50\.000\.000/);
          assert.doesNotMatch(formatCommandHelp(game, platform), /common|65%/i);
        }
      }
    } finally { Math.random = original; }
  });

  it("enforces three requests per fixed window", () => {
    process.env.RATE_LIMIT = "3";
    assert.equal(checkRateLimit("telegram", "u", 0).allowed, true);
    assert.equal(checkRateLimit("telegram", "u", 1).allowed, true);
    assert.equal(checkRateLimit("telegram", "u", 2).allowed, true);
    assert.equal(checkRateLimit("telegram", "u", 3).allowed, false);
  });
});
