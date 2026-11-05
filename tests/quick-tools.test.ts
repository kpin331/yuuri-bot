import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculate, chooseOption, flipCoin } from "../src/lib/quick-tools.js";

describe("quick tools", () => {
  it("evaluates arithmetic with precedence, powers and parentheses", () => {
    assert.equal(calculate("(12 + 8) * 3 "), 60);
    assert.equal(calculate("2^3^2"), 512);
    assert.equal(calculate("-2^2"), -4);
  });

  it("rejects invalid expressions, division by zero and oversized results", () => {
    assert.equal(calculate("1 / 0"), null);
    assert.equal(calculate("2 + process.exit()"), null);
    assert.equal(calculate("10^100"), null);
  });

  it("chooses only from valid option lists", () => {
    const result = chooseOption("teh | kopi");
    assert.ok(result);
    assert.ok(result.options.includes(result.choice));
    assert.equal(chooseOption("satu opsi"), null);
    assert.equal(chooseOption("a |  | b"), null);
  });

  it("returns one of the two coin sides", () => {
    assert.ok(["angka", "gambar"].includes(flipCoin()));
  });
});
