import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../src/lib/db.js";
import { getWallet } from "../src/lib/casino-storage.js";
import { handleRpg } from "../src/lib/rpg-storage.js";
import { actRpg, createCharacter, type Character } from "../src/lib/rpg.js";
import { prepareRpgPurchase } from "../src/lib/rpg-shop.js";
import { rpgCommand } from "../src/platform/whatsapp/commands/rpg.js";
import { registerRpg } from "../src/handlers/rpg.js";
import { createTestBot } from "./helpers.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";

describe("RPG casino shopping", () => {
  let sequence = 0;
  const run = (input: string, id = String(++sequence)) => handleRpg("telegram", "1", input, "/", id);
  const state = (): Character => JSON.parse((getDb()!.prepare("SELECT state FROM rpg_characters WHERE platform='telegram' AND user_id='1'").get() as { state: string }).state);
  const save = (c: Character) => getDb()!.prepare("UPDATE rpg_characters SET state=? WHERE platform='telegram' AND user_id='1'").run(JSON.stringify(c));
  beforeEach(() => {
    sequence = 0; closeDatabase(); initDatabase(":memory:");
    run("buat warrior"); getWallet("1");
    getDb()!.prepare("UPDATE casino_wallets SET balance=100000 WHERE user_id='1'").run();
  });
  afterEach(() => closeDatabase());

  it("charges casino money for a potion and never charges a replay, even after receipt pruning", () => {
    const reply = run("beli potion", "purchase");
    assert.equal(getWallet("1")!.balance, 97500); assert.equal(state().storedPotions, 1);
    assert.equal(state().gold, 0);
    for (let i = 0; i < 105; i++) run("tas");
    assert.equal(run("beli potion", "purchase"), reply);
    assert.equal(getWallet("1")!.balance, 97500); assert.equal(state().storedPotions, 1);
  });
  it("charges equipment with materials, preserves gold and scales the next price", () => {
    const c = state(); c.materials = 20; c.gold = 123; save(c);
    run("beli senjata"); run("beli senjata"); run("beli armor");
    assert.equal(getWallet("1")!.balance, 60000);
    assert.equal(state().weapon, 2); assert.equal(state().armor, 1);
    assert.equal(state().materials, 12); assert.equal(state().gold, 123);
    assert.match(run("toko"), /Rp30\.000/);
  });
  it("rejects frozen, insufficient, malformed and in-combat purchases without consuming anything", () => {
    const original = state();
    for (const input of ["beli", "beli potion 2", "beli unknown", "beli senjata"]) {
      run(input); assert.deepEqual(state(), original); assert.equal(getWallet("1")!.balance, 100000);
    }
    getDb()!.prepare("UPDATE casino_wallets SET balance_frozen=1 WHERE user_id='1'").run();
    assert.match(run("beli potion"), /dibekukan/); assert.deepEqual(state(), original);
    getDb()!.prepare("UPDATE casino_wallets SET balance_frozen=0, balance=2499 WHERE user_id='1'").run();
    assert.match(run("beli potion"), /tidak cukup/); assert.deepEqual(state(), original);
    getDb()!.prepare("UPDATE casino_wallets SET balance=100000 WHERE user_id='1'").run();
    run("mulai"); const active = state();
    assert.match(run("beli potion"), /hanya tersedia di kota/);
    assert.deepEqual(state(), active); assert.equal(getWallet("1")!.balance, 100000);
  });
  it("rolls back the debit, inventory and receipt when saving fails", () => {
    const original = state();
    getDb()!.exec("CREATE TRIGGER fail_rpg_save BEFORE UPDATE ON rpg_characters BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => run("beli potion", "retry"), /test failure/);
    assert.equal(getWallet("1")!.balance, 100000); assert.deepEqual(state(), original);
    assert.equal(getDb()!.prepare("SELECT COUNT(*) AS n FROM rpg_purchases").get()!.n, 0);
    getDb()!.exec("DROP TRIGGER fail_rpg_save");
    run("beli potion", "retry"); assert.equal(getWallet("1")!.balance, 97500);
  });
  it("caps inventory and upgrades without charging and accepts old characters without storedPotions", () => {
    const c = state(); delete c.storedPotions; save(c); run("beli potion");
    assert.equal(state().storedPotions, 1);
    const full = state(); full.storedPotions = 10; full.weapon = 10; full.armor = 10; save(full);
    for (const input of ["beli potion", "beli senjata", "beli armor"]) run(input);
    assert.deepEqual(state(), full); assert.equal(getWallet("1")!.balance, 97500);
  });
  it("uses free potions before purchased reserves and retains unused reserves on escape", () => {
    const c = createCharacter("warrior"); c.storedPotions = 2; actRpg(c, "mulai");
    c.adventure!.hp = 10; actRpg(c, "potion");
    assert.equal(c.adventure!.potions, 2); assert.equal(c.storedPotions, 2);
    c.adventure!.potions = 0; c.adventure!.hp = 10; actRpg(c, "potion");
    assert.equal(c.storedPotions, 1);
    actRpg(c, "kabur"); assert.equal(c.storedPotions, 1);
  });
  it("never converts adventure or quest rewards to casino balance and keeps gold upgrades usable", () => {
    const c = state(); actRpg(c, "mulai");
    Object.assign(c.adventure!, { gold: 100, xp: 20, materials: 8 }); save(c);
    run("kabur"); assert.equal(state().gold, 50);
    const winner = state(); winner.wins = 1; save(winner); run("quest");
    assert.equal(state().gold, 150);
    run("upgrade senjata"); assert.equal(state().gold, 110); assert.equal(state().weapon, 1);
    assert.equal(getWallet("1")!.balance, 100000);
    assert.equal(prepareRpgPurchase(state(), "gold").ok, false);
  });
  it("purchases through both platform handlers and retains beta labels in both menus", async () => {
    const { bot, calls, textUpdate } = createTestBot(); registerRpg(bot);
    await bot.handleUpdate(textUpdate("/rpg beli potion", { fromId: 1 }));
    assert.ok(calls.some(call => String(call.body.text).includes("Potion dibeli")));
    const sent: string[] = [];
    const message = {
      userId: "2", chatId: "chat", message: { key: { id: "create" } },
      sock: { sendMessage: async (_chat: string, payload: { text?: string }) => { if (payload.text) sent.push(payload.text); return {}; } },
    } as unknown as IncomingMessage;
    await rpgCommand.run({ message, args: "buat mage", role: "member" });
    getWallet("2"); getDb()!.prepare("UPDATE casino_wallets SET balance=2500 WHERE user_id='2'").run();
    message.message.key.id = "buy";
    await rpgCommand.run({ message, args: "beli potion", role: "member" });
    assert.ok(sent.some(text => text.includes("Potion dibeli"))); assert.equal(getWallet("2")!.balance, 0);
    for (const file of ["src/handlers/commands.ts", "src/platform/whatsapp/commands/menu.ts"]) {
      assert.match(readFileSync(file, "utf8"), /rpg.*Petualangan taktis \(beta\)/);
    }
  });
});
