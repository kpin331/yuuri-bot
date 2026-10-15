import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  applyCommandToggle,
  isProtectedCommand,
  parseToggleInput,
} from "../src/lib/commandcontrol.js";
import { closeDatabase, initDatabase, isCommandEnabled } from "../src/lib/db.js";
import { createBot } from "../src/bot.js";
import { registerCommandControl } from "../src/handlers/commandcontrol.js";
import { createTestBot } from "./helpers.js";

describe("parseToggleInput", () => {
  it("parses 'on' and 'off'", () => {
    assert.deepEqual(parseToggleInput("play off"), { ok: true, command: "play", state: false });
    assert.deepEqual(parseToggleInput("play on"), { ok: true, command: "play", state: true });
  });

  it("normalizes /, $ and ! prefixes and case", () => {
    assert.deepEqual(parseToggleInput("/Play OFF"), { ok: true, command: "play", state: false });
    assert.deepEqual(parseToggleInput("$sys on"), { ok: true, command: "sys", state: true });
    assert.deepEqual(parseToggleInput("!play on"), { ok: true, command: "play", state: true });
  });

  it("rejects missing or invalid states", () => {
    assert.equal(parseToggleInput("play").ok, false);
    assert.equal(parseToggleInput("play maybe").ok, false);
    assert.equal(parseToggleInput("").ok, false);
    assert.equal(parseToggleInput("play on extra").ok, false);
  });
});

describe("isProtectedCommand", () => {
  it("protects recovery commands only", () => {
    assert.equal(isProtectedCommand("start"), true);
    assert.equal(isProtectedCommand("menu"), true);
    assert.equal(isProtectedCommand("unban"), true);
    assert.equal(isProtectedCommand("play"), false);
    assert.equal(isProtectedCommand("/START"), true);
  });
});

describe("applyCommandToggle", () => {
  beforeEach(() => {
    // Populate the known-command registry the way startup does.
    createBot("123456:TEST");
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
  });

  it("disables and re-enables a known command", () => {
    const off = applyCommandToggle("play", false, 1);
    assert.equal(off.ok, true);
    assert.equal(isCommandEnabled("play"), false);

    const on = applyCommandToggle("play", true, 1);
    assert.equal(on.ok, true);
    assert.equal(isCommandEnabled("play"), true);
  });

  it("rejects unknown commands", () => {
    const result = applyCommandToggle("nope", true, 1);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.includes("Unknown command"));
  });

  it("refuses to disable protected commands but allows enabling", () => {
    const disable = applyCommandToggle("start", false, 1);
    assert.equal(disable.ok, false);
    assert.ok(!disable.ok && disable.error.includes("protected"));

    const enable = applyCommandToggle("start", true, 1);
    assert.equal(enable.ok, true);
  });

  it("fails safely when storage is unavailable", () => {
    closeDatabase();
    const result = applyCommandToggle("play", false, 1);
    assert.equal(result.ok, false);
  });
});

describe("registerCommandControl", () => {
  const originalOwner = process.env.OWNER_ID;

  beforeEach(() => {
    process.env.OWNER_ID = "222";
    process.env.EVERYONE = "true";
    createBot("123456:TEST");
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
    if (originalOwner === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = originalOwner;
  });

  it("lets the owner disable and enable a command", async () => {
    const t = createTestBot();
    registerCommandControl(t.bot);

    await t.bot.handleUpdate(t.textUpdate("!play off", { fromId: 222 }));
    assert.equal(isCommandEnabled("play"), false);
    assert.ok(t.replies().some((r) => r.includes("disabled")));

    await t.bot.handleUpdate(t.textUpdate("!play on", { fromId: 222 }));
    assert.equal(isCommandEnabled("play"), true);
    assert.ok(t.replies().some((r) => r.includes("enabled")));
  });

  it("denies non-admins", async () => {
    const t = createTestBot();
    registerCommandControl(t.bot);

    await t.bot.handleUpdate(t.textUpdate("!play off", { fromId: 999 }));
    assert.equal(isCommandEnabled("play"), true);
    assert.ok(t.replies().some((r) => r.includes("Only admins")));
  });

  it("ignores unknown or malformed toggles from non-admins", async () => {
    const t = createTestBot();
    registerCommandControl(t.bot);

    await t.bot.handleUpdate(t.textUpdate("!hello", { fromId: 999 }));
    assert.deepEqual(t.replies(), []);
  });

  it("refuses to disable a protected command", async () => {
    const t = createTestBot();
    registerCommandControl(t.bot);

    await t.bot.handleUpdate(t.textUpdate("!start off", { fromId: 222 }));
    assert.equal(isCommandEnabled("start"), true);
    assert.ok(t.replies().some((r) => r.includes("protected")));
  });
});
