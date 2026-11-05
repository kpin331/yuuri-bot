import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convertBase64, createUuid, currentTime, sha256, splitModeInput } from "../src/lib/text-tools.js";

describe("text tools", () => {
  it("formats time for a valid timezone and rejects invalid zones", () => {
    assert.match(currentTime("Asia/Jakarta") ?? "", /\d{4}/);
    assert.equal(currentTime("Not/A_Timezone"), null);
  });

  it("creates UUIDs and computes SHA-256", () => {
    assert.match(createUuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(sha256("  "), null);
  });

  it("encodes and decodes UTF-8 Base64 while rejecting malformed data", () => {
    const encoded = convertBase64("encode", "halo 👋");
    assert.equal(encoded, "aGFsbyDwn5GL");
    assert.equal(convertBase64("decode", encoded ?? ""), "halo 👋");
    assert.equal(convertBase64("decode", "%%%"), null);
    assert.equal(convertBase64("decode", "/w=="), null);
  });

  it("splits the mode from the payload without trimming payload spaces", () => {
    assert.deepEqual(splitModeInput("encode  hello "), { mode: "encode", text: " hello " });
    assert.equal(splitModeInput("encode"), null);
  });
});
