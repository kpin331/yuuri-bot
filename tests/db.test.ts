import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  closeDatabase,
  findUserByUsername,
  getStats,
  initDatabase,
  isDatabaseReady,
  recordIncoming,
  dateKeyUTC,
} from "../src/lib/db.js";

describe("db storage", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
  });

  it("reports readiness", () => {
    assert.equal(isDatabaseReady(), true);
  });

  it("no-ops and returns null when the database is not ready", () => {
    closeDatabase();
    assert.equal(isDatabaseReady(), false);
    assert.doesNotThrow(() => recordIncoming({ user: { id: 1 }, command: "s" }));
    assert.equal(getStats(1), null);
  });

  it("aggregates message, command and active-day totals", () => {
    recordIncoming({ user: { id: 7, firstName: "Alice", username: "Alice" }, command: "play" });
    recordIncoming({ user: { id: 7, firstName: "Alice", username: "Alice" }, command: "play" });
    recordIncoming({ user: { id: 7, firstName: "Alice", username: "Alice" }, command: "s" });
    recordIncoming({ user: { id: 7, firstName: "Alice", username: "Alice" } });

    const stats = getStats(7);
    assert.notEqual(stats, null);
    assert.equal(stats?.messages, 4);
    assert.equal(stats?.commandCount, 3);
    assert.equal(stats?.activeDays, 1);
    assert.equal(stats?.topCommand, "play");
    assert.equal(stats?.firstName, "Alice");
  });

  it("counts distinct active days", () => {
    const base = Date.UTC(2026, 0, 1);
    recordIncoming({ user: { id: 8 }, at: base });
    recordIncoming({ user: { id: 8 }, at: base + 86_400_000 });
    assert.equal(getStats(8)?.activeDays, 2);
  });

  it("separates users", () => {
    recordIncoming({ user: { id: 10 }, command: "s" });
    recordIncoming({ user: { id: 11 } });

    assert.equal(getStats(10)?.messages, 1);
    assert.equal(getStats(11)?.messages, 1);
    assert.equal(getStats(11)?.commandCount, 0);
  });

  it("returns null for an unknown user rather than a zero record", () => {
    recordIncoming({ user: { id: 12 } });
    assert.equal(getStats(9999), null);
    assert.notEqual(getStats(12), null);
  });

  it("looks up users by username case-insensitively", () => {
    recordIncoming({ user: { id: 20, firstName: "Bob", username: "BobUser" } });
    assert.equal(findUserByUsername("bobuser")?.userId, 20);
    assert.equal(findUserByUsername("@BobUser")?.userId, 20);
    assert.equal(findUserByUsername("nobody"), null);
    assert.equal(findUserByUsername("   "), null);
  });

  it("normalizes command names (strips / and $ and mentions)", () => {
    recordIncoming({ user: { id: 30 }, command: "/play@Test_bot" });
    assert.equal(getStats(30)?.topCommand, "play");
  });

  it("formats a UTC day key", () => {
    assert.equal(dateKeyUTC(Date.UTC(2026, 9, 5)), "2026-10-05");
  });
});
