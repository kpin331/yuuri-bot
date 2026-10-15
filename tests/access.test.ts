import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  checkRateLimit,
  consumeQuota,
  getQuota,
  resetAllQuotas,
  resetRateLimits,
  resolveRole,
  roleLimit,
} from "../src/core/access.js";
import { closeDatabase, initDatabase } from "../src/lib/db.js";

const ENV_KEYS = [
  "OWNER_NUMBER",
  "OWNER_NUMBERS",
  "ADMIN_NUMBERS",
  "DEFAULT_QUOTA",
  "ADMIN_QUOTA",
  "RATE_LIMIT",
  "RATE_WINDOW_SECONDS",
  "TIMEZONE",
] as const;

let saved: Record<string, string | undefined> = {};

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("whatsapp access control", () => {
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    resetRateLimits();
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    for (const key of ENV_KEYS) setEnv(key, saved[key]);
    closeDatabase();
    resetRateLimits();
  });

  it("resolves roles from numbers and group admin status", () => {
    setEnv("OWNER_NUMBER", "+62 811-000");
    setEnv("ADMIN_NUMBERS", "62822000,62833000");

    assert.equal(resolveRole("62811000", false), "owner");
    assert.equal(resolveRole("62822000", false), "admin");
    assert.equal(resolveRole("62999000", true), "admin");
    assert.equal(resolveRole("62999000", false), "member");
    assert.equal(resolveRole(null, false), "member");
  });

  it("gives the owner unlimited quota", () => {
    assert.equal(roleLimit("owner"), Number.POSITIVE_INFINITY);
    const quota = getQuota("whatsapp", "62811000", "owner", null);
    assert.equal(quota.unlimited, true);
  });

  it("tracks quota and resets it on a new day", () => {
    setEnv("DEFAULT_QUOTA", "2");
    setEnv("TIMEZONE", "UTC");

    const day1 = Date.UTC(2026, 0, 1, 12, 0, 0);
    assert.equal(getQuota("whatsapp", "u1", "member", null, day1).quotaLeft, 2);

    consumeQuota("whatsapp", "u1");
    assert.equal(getQuota("whatsapp", "u1", "member", null, day1).quotaLeft, 1);

    // Never drops below zero.
    consumeQuota("whatsapp", "u1");
    consumeQuota("whatsapp", "u1");
    assert.equal(getQuota("whatsapp", "u1", "member", null, day1).quotaLeft, 0);

    // Next day: fully reset.
    const day2 = day1 + 86_400_000;
    assert.equal(getQuota("whatsapp", "u1", "member", null, day2).quotaLeft, 2);
  });

  it("limits requests within the window", () => {
    setEnv("RATE_LIMIT", "2");
    setEnv("RATE_WINDOW_SECONDS", "60");

    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    assert.equal(checkRateLimit("whatsapp", "u1", now).allowed, true);
    assert.equal(checkRateLimit("whatsapp", "u1", now).allowed, true);

    const blocked = checkRateLimit("whatsapp", "u1", now);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0);

    // After the window passes, allowed again.
    assert.equal(checkRateLimit("whatsapp", "u1", now + 61_000).allowed, true);
  });

  it("allows RATE_LIMIT requests per window and blocks the next", () => {
    setEnv("RATE_LIMIT", "3");
    setEnv("RATE_WINDOW_SECONDS", "60");

    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    // Arrivals 20s apart; the window is anchored at the first request, so all
    // three count towards it even though they are spread over 40 seconds.
    assert.equal(checkRateLimit("whatsapp", "slow", now).allowed, true);
    assert.equal(checkRateLimit("whatsapp", "slow", now + 20_000).allowed, true);
    assert.equal(checkRateLimit("whatsapp", "slow", now + 40_000).allowed, true);

    const blocked = checkRateLimit("whatsapp", "slow", now + 55_000);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0);

    // The window ends 60s after the first request.
    assert.equal(checkRateLimit("whatsapp", "slow", now + 60_000).allowed, true);
  });

  it("resets every stored quota and reports the restored amount", () => {
    setEnv("DEFAULT_QUOTA", "25");
    setEnv("TIMEZONE", "UTC");

    const day = Date.UTC(2026, 0, 1, 12, 0, 0);
    getQuota("whatsapp", "u1", "member", "Alice", day);
    consumeQuota("whatsapp", "u1");
    consumeQuota("whatsapp", "u1");
    getQuota("whatsapp", "u2", "member", "Bob", day);
    consumeQuota("whatsapp", "u2");

    const entries = resetAllQuotas(day);
    const byUser = new Map(entries.map((entry) => [entry.userId, entry]));

    assert.equal(byUser.get("u1")?.before, 23);
    assert.equal(byUser.get("u1")?.after, 25);
    assert.equal(byUser.get("u1")?.restored, 2);
    assert.equal(byUser.get("u2")?.restored, 1);

    // The rows are actually restored in the database.
    assert.equal(getQuota("whatsapp", "u1", "member", null, day).quotaLeft, 25);
    assert.equal(getQuota("whatsapp", "u2", "member", null, day).quotaLeft, 25);
  });
});
