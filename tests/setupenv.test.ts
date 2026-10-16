import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEnvFile,
  normalizePhoneNumber,
  parseEnvFile,
  validateBotToken,
  validateNumericId,
  validatePhoneNumber,
} from "../src/lib/envfile.js";

const TEMPLATE = [
  "# Copy this file to .env",
  "BOT_TOKEN=123456789:replace_me_with_your_token",
  "",
  "# Your Telegram user ID (owner).",
  "OWNER_ID=",
  "",
  "# Optional: extra admins.",
  "# ADMIN_IDS=111111111,222222222",
  "",
  "# OWNER_NUMBER=6281234567890",
].join("\n");

describe("parseEnvFile", () => {
  it("reads active keys and ignores comments and blanks", () => {
    const values = parseEnvFile("A=1\n# B=2\n\nC = 3 \nD=hello world\n");
    assert.equal(values.get("A"), "1");
    assert.equal(values.has("B"), false);
    assert.equal(values.get("C"), "3");
    assert.equal(values.get("D"), "hello world");
  });

  it("strips surrounding quotes", () => {
    const values = parseEnvFile('A="a b"\nB=\'c d\'\n');
    assert.equal(values.get("A"), "a b");
    assert.equal(values.get("B"), "c d");
  });
});

describe("buildEnvFile", () => {
  it("fills template keys in place and keeps comments", () => {
    const out = buildEnvFile({
      template: TEMPLATE,
      updates: { BOT_TOKEN: "111:secret", OWNER_ID: "42" },
    });
    assert.ok(out.includes("BOT_TOKEN=111:secret"));
    assert.ok(out.includes("OWNER_ID=42"));
    assert.ok(out.includes("# Copy this file to .env"));
    assert.ok(out.includes("# OWNER_NUMBER=6281234567890"), "untouched optional key stays commented");
  });

  it("uncomments a template key when an update targets it", () => {
    const out = buildEnvFile({ template: TEMPLATE, updates: { ADMIN_IDS: "1,2" } });
    assert.ok(out.includes("ADMIN_IDS=1,2"));
    assert.ok(!out.includes("# ADMIN_IDS=1,2"));
  });

  it("writes an empty value to clear a key", () => {
    const out = buildEnvFile({ template: TEMPLATE, updates: { OWNER_NUMBER: "" } });
    assert.ok(out.includes("OWNER_NUMBER="));
    assert.ok(!out.includes("# OWNER_NUMBER="), "cleared key is active and empty, not commented");
  });

  it("preserves existing values that are not updated", () => {
    const out = buildEnvFile({
      template: TEMPLATE,
      existing: "BOT_TOKEN=keep:me\nADMIN_IDS=9,8\n",
      updates: { OWNER_ID: "7" },
    });
    assert.ok(out.includes("BOT_TOKEN=keep:me"));
    assert.ok(out.includes("ADMIN_IDS=9,8"));
    assert.ok(out.includes("OWNER_ID=7"));
  });

  it("appends keys that only exist in the old .env", () => {
    const out = buildEnvFile({
      template: TEMPLATE,
      existing: "CUSTOM_FLAG=yes\n",
      updates: { OWNER_ID: "1" },
    });
    assert.ok(out.includes("# Extra values kept from the previous .env"));
    assert.ok(out.includes("CUSTOM_FLAG=yes"));
  });

  it("does not mistake comment prose for a key", () => {
    const template = "# true = anyone can use the bot\nEVERYONE=true";
    const out = buildEnvFile({ template, updates: { EVERYONE: "false" } });
    assert.ok(out.includes("# true = anyone can use the bot"));
    assert.ok(out.includes("EVERYONE=false"));
  });

  it("round-trips through parseEnvFile", () => {
    const out = buildEnvFile({ template: TEMPLATE, updates: { OWNER_ID: "5" } });
    assert.equal(parseEnvFile(out).get("OWNER_ID"), "5");
    assert.equal(parseEnvFile(out).get("BOT_TOKEN"), "123456789:replace_me_with_your_token");
  });
});

describe("validateBotToken", () => {
  it("accepts a well-formed token", () => {
    assert.equal(validateBotToken("123456789:ABCdef_-0123456789ABCDEFGHIJ"), null);
  });

  it("rejects empty, malformed and too-short values", () => {
    assert.ok(validateBotToken(""));
    assert.ok(validateBotToken("not-a-token"));
    assert.ok(validateBotToken("123:short"));
  });
});

describe("validateNumericId", () => {
  it("accepts digits only", () => {
    assert.equal(validateNumericId("222"), null);
  });

  it("rejects usernames, empty and negative values", () => {
    assert.ok(validateNumericId("@user"));
    assert.ok(validateNumericId(""));
    assert.ok(validateNumericId("-5"));
  });
});

describe("phone validation", () => {
  it("normalizes any phone-like input to digits", () => {
    assert.equal(normalizePhoneNumber("+62 812-3456"), "628123456");
  });

  it("rejects too short and too long numbers", () => {
    assert.ok(validatePhoneNumber("123"));
    assert.ok(validatePhoneNumber("1234567890123456"));
  });

  it("accepts a normal international number", () => {
    assert.equal(validatePhoneNumber("+62 812 3456 7890"), null);
  });
});
