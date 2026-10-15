import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalUserId,
  isLidId,
  isLidJid,
  isPnJid,
  jidDigits,
  resolvePhone,
} from "../src/platform/whatsapp/identity.js";

describe("whatsapp identity", () => {
  it("extracts digits from a jid and drops the device suffix", () => {
    assert.equal(jidDigits("6281234567890@s.whatsapp.net"), "6281234567890");
    assert.equal(jidDigits("6281234567890:5@s.whatsapp.net"), "6281234567890");
    assert.equal(jidDigits("123456789012345@lid"), "123456789012345");
    assert.equal(jidDigits(null), null);
    assert.equal(jidDigits("@@@"), null);
  });

  it("detects jid kinds", () => {
    assert.equal(isPnJid("628@s.whatsapp.net"), true);
    assert.equal(isLidJid("123@lid"), true);
    assert.equal(isPnJid("123@lid"), false);
  });

  it("resolves a phone number from the primary or alternate jid", () => {
    assert.equal(resolvePhone("628111@s.whatsapp.net", null), "628111");
    assert.equal(resolvePhone("999@lid", "628222@s.whatsapp.net"), "628222");
    assert.equal(resolvePhone("999@lid", "888@lid"), null);
  });

  it("keeps a stable canonical id, tagging lid-only users", () => {
    assert.equal(canonicalUserId("628111@s.whatsapp.net", null), "628111");
    assert.equal(canonicalUserId("999@lid", "628222@s.whatsapp.net"), "628222");
    assert.equal(canonicalUserId("999@lid", null), "lid:999");
    assert.equal(canonicalUserId(null, null), null);
  });

  it("identifies lid ids", () => {
    assert.equal(isLidId("lid:999"), true);
    assert.equal(isLidId("628111"), false);
  });
});
