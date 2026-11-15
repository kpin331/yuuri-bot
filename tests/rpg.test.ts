import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actRpg, CLASSES, createCharacter, type Role } from "../src/lib/rpg.js";
import { handleRpg } from "../src/lib/rpg-storage.js";
import { closeDatabase, getDb, initDatabase } from "../src/lib/db.js";
import { registerRpg } from "../src/handlers/rpg.js";
import { createTestBot } from "./helpers.js";
import { findCommand } from "../src/platform/whatsapp/commands/index.js";
import { formatCommandHelp } from "../src/lib/command-help.js";

describe("RPG tactical rules", () => {
  it("creates every class and locks normal difficulty while a run is active", () => {
    for (const role of Object.keys(CLASSES) as Role[]) {
      const c = createCharacter(role);
      actRpg(c, "mulai");
      assert.equal(c.adventure!.difficulty, "normal");
      assert.equal(c.adventure!.hp, CLASSES[role].hp);
      const before = structuredClone(c);
      actRpg(c, "mulai hard"); actRpg(c, "buat mage");
      assert.deepEqual(c, before);
    }
  });
  it("rejects invalid targets, difficulties and insufficient resources without a turn", () => {
    const c = createCharacter("mage");
    actRpg(c, "mulai impossible"); assert.equal(c.adventure, null);
    actRpg(c, "mulai"); c.adventure!.mana = 0;
    const before = structuredClone(c);
    for (const action of ["serang 0", "serang -1", "skill", "potion", "bertahan extra", "serang 1 extra", "serang 1.5"]) {
      actRpg(c, action); assert.deepEqual(c, before, action);
    }
  });
  it("telegraphs a heavy attack and defending reduces damage while restoring mana", () => {
    const c = createCharacter("mage"); actRpg(c, "mulai");
    c.adventure!.enemies = [{ kind: 1, hp: 99, maxHp: 99, turn: 1 }];
    c.adventure!.mana = 0;
    const other = structuredClone(c);
    actRpg(c, "bertahan"); actRpg(other, "serang");
    assert.ok(c.adventure!.hp > other.adventure!.hp);
    assert.equal(c.adventure!.mana, 4);
  });
  it("skills interrupt, hit multiple targets, pierce shields and heal", () => {
    for (const role of Object.keys(CLASSES) as Role[]) {
      const c = createCharacter(role); actRpg(c, "mulai");
      c.adventure!.hp = 50;
      c.adventure!.enemies = [{ kind: 2, hp: 200, maxHp: 200, turn: 0 }, { kind: 1, hp: 200, maxHp: 200, turn: 0 }];
      const result = actRpg(c, "skill 1");
      assert.equal(c.adventure!.mana, CLASSES[role].mana - 8);
      if (role === "warrior" || role === "ranger") assert.match(result, /terganggu/);
      if (role === "mage") assert.ok(c.adventure!.enemies[1]!.hp < 200);
      if (role === "rogue") assert.equal(c.adventure!.enemies[0]!.hp, 137);
      if (role === "cleric") assert.equal(c.adventure!.hp, 80);
    }
  });
  it("settles all four encounters once and claims the boss quest once", () => {
    const c = createCharacter("mage"); actRpg(c, "mulai");
    for (let stage = 0; stage < 4; stage++) {
      assert.equal(c.adventure!.stage, stage);
      c.adventure!.enemies.forEach(e => e.hp = 1);
      actRpg(c, "skill");
    }
    assert.equal(c.adventure, null); assert.equal(c.wins, 1);
    assert.equal(c.gold, 150); assert.equal(c.xp, 105);
    actRpg(c, "quest"); const before = structuredClone(c);
    actRpg(c, "quest"); actRpg(c, "serang"); assert.deepEqual(c, before);
    actRpg(c, "upgrade senjata"); assert.equal(c.weapon, 1);
    assert.equal(c.gold, 210);
  });
  it("keeps old equipment and half of current loot on death or escape", () => {
    for (const action of ["kabur", "serang"]) {
      const c = createCharacter("warrior"); c.gold = 100; c.weapon = 1;
      actRpg(c, "mulai"); Object.assign(c.adventure!, { hp: 1, gold: 21, xp: 11, materials: 3 });
      c.adventure!.enemies = [{ kind: 4, hp: 999, maxHp: 999, turn: 1 }];
      actRpg(c, action);
      assert.equal(c.adventure, null); assert.equal(c.gold, 110); assert.equal(c.xp, 5);
      assert.equal(c.materials, 1); assert.equal(c.weapon, 1);
    }
  });
  it("does not give loot for summoned enemies", () => {
    const c = createCharacter("rogue"); actRpg(c, "mulai");
    c.adventure!.enemies = [{ kind: 2, hp: 1, maxHp: 1, turn: 0, summoned: true }, { kind: 4, hp: 99, maxHp: 99, turn: 0 }];
    actRpg(c, "serang"); assert.equal(c.adventure!.gold, 0);
  });
});

describe("RPG persistence and integration", () => {
  beforeEach(() => { closeDatabase(); initDatabase(":memory:"); });
  afterEach(() => closeDatabase());
  it("isolates users and platforms, deduplicates messages and uses the requested prefix", () => {
    handleRpg("telegram", "1", "buat warrior", "/", "a");
    handleRpg("telegram", "1", "mulai", "/", "b");
    const reply = handleRpg("telegram", "1", "serang", "/", "c");
    const state = getDb()!.prepare("SELECT state FROM rpg_characters").get();
    assert.equal(handleRpg("telegram", "1", "serang", "/", "c"), reply);
    assert.deepEqual(getDb()!.prepare("SELECT state FROM rpg_characters").get(), state);
    assert.match(handleRpg("whatsapp", "1", "", "!", "a"), /!rpg buat/);
    assert.match(handleRpg("telegram", "2", "", "/", "a"), /Pilih class/);
    assert.match(formatCommandHelp("rpg", "whatsapp", "!"), /!rpg/);
    assert.equal(findCommand("rpg")?.awardXp, false);
    assert.equal(findCommand("rpg")?.free, true);
  });
  it("restores a run after reopening the database", () => {
    closeDatabase(); const dir = mkdtempSync(join(tmpdir(), "bot-rpg-"));
    try {
      const path = join(dir, "test.db"); initDatabase(path);
      handleRpg("telegram", "1", "buat mage", "/", "a");
      handleRpg("telegram", "1", "mulai hard", "/", "b");
      closeDatabase(); initDatabase(path);
      assert.match(handleRpg("telegram", "1", "", "/", "c"), /hard · Encounter 1\/4/);
    } finally { closeDatabase(); rmSync(dir, { recursive: true, force: true }); }
  });
  it("routes Telegram commands through the registered handler", async () => {
    const { bot, calls, textUpdate } = createTestBot(); registerRpg(bot);
    await bot.handleUpdate(textUpdate("/rpg buat ranger"));
    assert.ok(calls.some(call => String(call.body.text).includes("RANGER")));
  });
});
