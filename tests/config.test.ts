import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  getAdminNumbers,
  getAdminQuota,
  getCommandPrefix,
  getDefaultQuota,
  getImpersonateTarget,
  getMaxDurationMinutes,
  getOwnerNumbers,
  getPairingNumber,
  getRateLimit,
  getSpotifyClientId,
  getSpotifyClientSecret,
  getTimezone,
  getAllowedGroups,
  isEveryoneAllowed,
  isGroupAllowed,
  isGroupOnly,
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

const PLAY_KEYS = [
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "MAX_DURATION_MINUTES",
] as const;

describe("play link config", () => {
  beforeEach(() => {
    saved = {};
    for (const key of PLAY_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PLAY_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
  });

  it("returns null for missing Spotify credentials", () => {
    assert.equal(getSpotifyClientId(), null);
    assert.equal(getSpotifyClientSecret(), null);
    process.env.SPOTIFY_CLIENT_ID = "  ";
    assert.equal(getSpotifyClientId(), null);
  });

  it("reads Spotify credentials when set", () => {
    process.env.SPOTIFY_CLIENT_ID = "id123";
    process.env.SPOTIFY_CLIENT_SECRET = "secret456";
    assert.equal(getSpotifyClientId(), "id123");
    assert.equal(getSpotifyClientSecret(), "secret456");
  });

  it("defaults the max duration and validates overrides", () => {
    assert.equal(getMaxDurationMinutes(), 10);
    process.env.MAX_DURATION_MINUTES = "5";
    assert.equal(getMaxDurationMinutes(), 5);
    process.env.MAX_DURATION_MINUTES = "abc";
    assert.equal(getMaxDurationMinutes(), 10);
    process.env.MAX_DURATION_MINUTES = "-3";
    assert.equal(getMaxDurationMinutes(), 10);
  });
});

describe("group access config", () => {
  const GROUP_KEYS = ["GROUP_ONLY", "ALLOWED_GROUPS"] as const;

  beforeEach(() => {
    saved = {};
    for (const key of GROUP_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of GROUP_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
  });

  it("defaults to allowing every group", () => {
    assert.equal(isGroupOnly(), false);
    assert.equal(isGroupAllowed("1203630@g.us"), true);
  });

  it("reads the GROUP_ONLY switch", () => {
    for (const on of ["true", "1", "YES", "on"]) {
      process.env.GROUP_ONLY = on;
      assert.equal(isGroupOnly(), true, on);
    }
    process.env.GROUP_ONLY = "false";
    assert.equal(isGroupOnly(), false);
  });

  it("normalizes allowed groups and drops duplicates", () => {
    process.env.ALLOWED_GROUPS = "1203630@g.us, 98765 ,1203630@g.us";
    assert.deepEqual(getAllowedGroups(), ["1203630@g.us", "98765@g.us"]);
  });

  it("only allows listed groups when restricted (bare id matches JID)", () => {
    process.env.GROUP_ONLY = "true";
    process.env.ALLOWED_GROUPS = "1203630@g.us";
    assert.equal(isGroupAllowed("1203630@g.us"), true);
    assert.equal(isGroupAllowed("1203630"), true);
    assert.equal(isGroupAllowed("9999999@g.us"), false);
  });

  it("allows no group when restricted with an empty list", () => {
    process.env.GROUP_ONLY = "true";
    assert.deepEqual(getAllowedGroups(), []);
    assert.equal(isGroupAllowed("1203630@g.us"), false);
    assert.equal(isGroupAllowed(null), false);
  });
});

describe("downloader config", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.YTDLP_IMPERSONATE;
    delete process.env.YTDLP_IMPERSONATE;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.YTDLP_IMPERSONATE;
    else process.env.YTDLP_IMPERSONATE = previous;
  });

  it("defaults to chrome when unset or blank", () => {
    assert.equal(getImpersonateTarget(), "chrome");
    process.env.YTDLP_IMPERSONATE = "   ";
    assert.equal(getImpersonateTarget(), "chrome");
  });

  it("reads a custom target, keeping the os suffix", () => {
    process.env.YTDLP_IMPERSONATE = "chrome:windows-10";
    assert.equal(getImpersonateTarget(), "chrome:windows-10");
    process.env.YTDLP_IMPERSONATE = "Safari-26.0";
    assert.equal(getImpersonateTarget(), "Safari-26.0");
  });

  it("disables impersonation with none/off style values", () => {
    for (const value of ["none", "off", "false", "no", "0", "DISABLED"]) {
      process.env.YTDLP_IMPERSONATE = value;
      assert.equal(getImpersonateTarget(), null, value);
    }
  });
});
