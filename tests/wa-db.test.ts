import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  addWaBan,
  closeDatabase,
  getWaStats,
  initDatabase,
  isDatabaseReady,
  isWaBanned,
  recordWaIncoming,
  removeWaBan,
} from "../src/lib/db.js";

describe("whatsapp storage", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
  });

  it("aggregates message, command and active-day totals", () => {
    recordWaIncoming({ userId: "6281", displayName: "Alice", command: "play" });
    recordWaIncoming({ userId: "6281", displayName: "Alice", command: "play" });
    recordWaIncoming({ userId: "6281", displayName: "Alice", command: "s" });
    recordWaIncoming({ userId: "6281", displayName: "Alice" });

    const stats = getWaStats("6281");
    assert.notEqual(stats, null);
    assert.equal(stats?.messages, 4);
    assert.equal(stats?.commandCount, 3);
    assert.equal(stats?.activeDays, 1);
    assert.equal(stats?.topCommand, "play");
    assert.equal(stats?.displayName, "Alice");
  });

  it("keeps phone users and lid users separate", () => {
    recordWaIncoming({ userId: "6281" });
    recordWaIncoming({ userId: "lid:999" });
    assert.equal(getWaStats("6281")?.messages, 1);
    assert.equal(getWaStats("lid:999")?.messages, 1);
    assert.equal(getWaStats("999"), null);
  });

  it("returns null for an unknown user", () => {
    recordWaIncoming({ userId: "6281" });
    assert.equal(getWaStats("nobody"), null);
  });

  it("stores, checks and removes bans, honoring expiry", () => {
    const now = Date.UTC(2026, 0, 1);
    addWaBan({ userId: "6281", bannedBy: "6280", createdAt: now, expiresAt: now + 1000 });

    assert.equal(isWaBanned("6281", now), true);
    // Expired bans stop blocking even before cleanup.
    assert.equal(isWaBanned("6281", now + 2000), false);
    assert.equal(isWaBanned("6281", now), false);

    addWaBan({ userId: "6282", bannedBy: "6280", createdAt: now, expiresAt: now + 1000 });
    assert.equal(removeWaBan("6282"), true);
    assert.equal(removeWaBan("6282"), false);
  });

  it("no-ops and returns null when the database is not ready", () => {
    closeDatabase();
    assert.equal(isDatabaseReady(), false);
    assert.doesNotThrow(() => recordWaIncoming({ userId: "6281" }));
    assert.equal(getWaStats("6281"), null);
    assert.equal(isWaBanned("6281"), false);
  });
});
