import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rollDice } from "../src/lib/roll.js";

describe("dice roll", () => {
  it("defaults to one six-sided die and totals the result", () => {
    const result = rollDice("d6");
    assert.ok(result);
    assert.equal(result.count, 1);
    assert.equal(result.sides, 6);
    assert.equal(result.total, result.values[0]);
    assert.ok(result.total >= 1 && result.total <= 6);
  });

  it("supports multiple dice and rejects invalid bounds", () => {
    const result = rollDice("10d1000");
    assert.ok(result);
    assert.equal(result.values.length, 10);
    assert.equal(result.total, result.values.reduce((sum, value) => sum + value, 0));
    assert.equal(rollDice("11d6"), null);
    assert.equal(rollDice("1d1"), null);
    assert.equal(rollDice("2d1001"), null);
  });
});
