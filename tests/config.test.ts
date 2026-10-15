import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  getAdminNumbers,
  getAdminQuota,
  getCommandPrefix,
  getDefaultQuota,
  getOwnerNumbers,
  getPairingNumber,
  getRateLimit,
  getTimezone,
  isEveryoneAllowed,
  normalizeNumber,
} from "../src/lib/config.js";

const KEYS = [
  "OWNER_NUMBER",
  "OWNER_NUMBERS",
  "ADMIN_NUMBERS",
  "PAIRING_NUMBER",
  "COMMAND_PREFIX",
  "DEFAULT_QUOTA",
  "ADMIN_QUOTA",
  "RATE_LIMIT",
  "TIMEZONE",
  "EVERYONE",
] as const;

let saved: Record<string, string | undefined> = {};

describe("whatsapp config", () => {
  beforeEach(() => {
    saved = {};
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
  });

  it("normalizes phone-like input to plain digits", () => {
    assert.equal(normalizeNumber("+62 812-345"), "62812345");
    assert.equal(normalizeNumber("   "), null);
    assert.equal(normalizeNumber(undefined), null);
  });

  it("collects owner numbers from both variables, deduped", () => {
    process.env.OWNER_NUMBER = "+62 811";
    process.env.OWNER_NUMBERS = "62811, 62822, 62811";
    assert.deepEqual(getOwnerNumbers(), ["62811", "62822"]);
  });

  it("splits admin numbers on commas, keeping spaces inside a number", () => {
    process.env.ADMIN_NUMBERS = "+62 812 111, 62822333";
    assert.deepEqual(getAdminNumbers(), ["62812111", "62822333"]);
  });

  it("reads the pairing number and prefix with validation", () => {
    process.env.PAIRING_NUMBER = "+62 899";
    assert.equal(getPairingNumber(), "62899");

    assert.equal(getCommandPrefix(), ".");
    process.env.COMMAND_PREFIX = "/";
    assert.equal(getCommandPrefix(), "/");
    // Multi-character prefixes are rejected to keep $ and ! working.
    process.env.COMMAND_PREFIX = "!!";
    assert.equal(getCommandPrefix(), ".");
  });

  it("falls back for invalid quota and rate values", () => {
    assert.equal(getDefaultQuota(), 15);
    assert.equal(getAdminQuota(), 30);
    assert.equal(getRateLimit(), 3);

    process.env.DEFAULT_QUOTA = "5";
    process.env.ADMIN_QUOTA = "0";
    process.env.RATE_LIMIT = "abc";
    assert.equal(getDefaultQuota(), 5);
    assert.equal(getAdminQuota(), 30);
    assert.equal(getRateLimit(), 3);
  });

  it("defaults the timezone and reads the EVERYONE switch", () => {
    assert.equal(getTimezone(), "Asia/Jakarta");
    process.env.TIMEZONE = "UTC";
    assert.equal(getTimezone(), "UTC");

    assert.equal(isEveryoneAllowed(), false);
    process.env.EVERYONE = "on";
    assert.equal(isEveryoneAllowed(), true);
  });
});
