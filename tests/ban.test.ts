import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { formatDuration, parseBanArgs } from "../src/lib/ban.js";
import { addBan, closeDatabase, initDatabase, isBanned } from "../src/lib/db.js";
import { registerBan, registerBanGuard } from "../src/handlers/ban.js";
import { registerFallback } from "../src/handlers/fallback.js";
import { createTestBot } from "./helpers.js";

describe("parseBanArgs", () => {
  it("uses the 3-day default when no duration is given", () => {
    const parsed = parseBanArgs("@someone");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.target, "@someone");
    assert.equal(parsed.ok && parsed.seconds, 3 * 86_400);
  });

  it("accepts a bare numeric id with no duration", () => {
    const parsed = parseBanArgs("12345");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.target, "12345");
    assert.equal(parsed.ok && parsed.seconds, 3 * 86_400);
  });

  it("parses -d and -h durations", () => {
    const days = parseBanArgs("@a -d2");
    assert.equal(days.ok && days.seconds, 2 * 86_400);

    const hours = parseBanArgs("@a -h5");
    assert.equal(hours.ok && hours.seconds, 5 * 3_600);
  });

  it("parses a plain number of seconds", () => {
    const parsed = parseBanArgs("@a 90");
    assert.equal(parsed.ok && parsed.seconds, 90);
  });

  it("supports a duration with no target (reply usage)", () => {
    const parsed = parseBanArgs("-h1");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.target, null);
    assert.equal(parsed.ok && parsed.seconds, 3_600);
  });

  it("rejects invalid or multiple durations", () => {
    assert.equal(parseBanArgs("@a -d").ok, false);
    assert.equal(parseBanArgs("@a -x3").ok, false);
    assert.equal(parseBanArgs("@a 10 20").ok, false);
    assert.equal(parseBanArgs("@a -d1 -h1").ok, false);
  });

  it("rejects non-positive durations", () => {
    assert.equal(parseBanArgs("@a 0").ok, false);
  });

  it("rejects durations beyond the maximum", () => {
    assert.equal(parseBanArgs("@a -d400").ok, false);
  });
});

describe("formatDuration", () => {
  it("renders days, hours, minutes and seconds with pluralization", () => {
    assert.equal(formatDuration(86_400), "1 hari");
    assert.equal(formatDuration(2 * 86_400), "2 hari");
    assert.equal(formatDuration(3_600), "1 jam");
    assert.equal(formatDuration(7_200), "2 jam");
    assert.equal(formatDuration(60), "1 menit");
    assert.equal(formatDuration(45), "45 detik");
    assert.equal(formatDuration(1), "1 detik");
  });
});

describe("ban guard", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
  });

  it("silently drops updates from an actively banned non-admin", async () => {
    const t = createTestBot();
    addBan({ userId: 222, bannedBy: 1, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });

    registerBanGuard(t.bot);
    registerFallback(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/nope"));
    assert.deepEqual(t.replies(), []);
  });

  it("lets unbanned users through", async () => {
    const t = createTestBot();
    registerBanGuard(t.bot);
    registerFallback(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/nope"));
    assert.deepEqual(t.replies(), ["Perintah tidak dikenal."]);
  });
});

describe("bangroup command", () => {
  const previousOwner = process.env.OWNER_ID;

  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
    process.env.OWNER_ID = "111";
  });

  afterEach(() => {
    closeDatabase();
    if (previousOwner === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = previousOwner;
  });

  it("registers the Telegram command and stores its target ban", async () => {
    const t = createTestBot();
    registerBan(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/bangroup 333 -h1", { fromId: 111 }));

    assert.equal(isBanned(333), true);
    assert.match(t.replies()[0] ?? "", /diblokir selama 1 jam/);
  });
});
