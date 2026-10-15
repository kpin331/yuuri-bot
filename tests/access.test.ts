import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  checkRateLimit,
  consumeQuota,
  getQuota,
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
});
