import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { isKnownCommand } from "../src/lib/command.js";
import { closeDatabase, initDatabase, isCommandEnabled, setCommandState } from "../src/lib/db.js";
import { allCommands, findCommand } from "../src/platform/whatsapp/commands/index.js";

describe("whatsapp command registry", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
  });

  it("resolves commands by name and alias", () => {
    assert.equal(findCommand("menu")?.name, "menu");
    assert.equal(findCommand("START")?.name, "menu");
    assert.equal(findCommand("s")?.name, "s");
    assert.equal(findCommand("dl")?.name, "dl");
    assert.equal(findCommand("tt")?.name, "tt");
    assert.equal(findCommand("tovid")?.name, "tovid");
    assert.equal(findCommand("qr")?.name, "qr");
    assert.equal(findCommand("tf")?.name, "tf");
    assert.equal(findCommand("transfer")?.name, "tf");
    assert.equal(findCommand("addmoney")?.ownerOnly, true);
    assert.equal(findCommand("pinjam")?.name, "pinjam");
    assert.equal(findCommand("lunas")?.name, "lunas");
    assert.equal(findCommand("bc")?.ownerOnly, true);
    assert.equal(findCommand("broadcast")?.name, "bc");
    assert.equal(findCommand("nope"), undefined);
  });

  it("registers its names in the shared known-command set", () => {
    for (const command of allCommands()) {
      assert.equal(isKnownCommand(command.name), true, `${command.name} should be known`);
    }
    // WhatsApp-only command, needed so "!quota off" is accepted.
    assert.equal(isKnownCommand("quota"), true);
  });

  it("honors the shared enable/disable state", () => {
    assert.equal(isCommandEnabled("quota"), true);
    setCommandState("quota", false, null);
    assert.equal(isCommandEnabled("quota"), false);
  });
});
