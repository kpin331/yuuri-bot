import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatWait, secondsUntilNextMidnight, tzDateKey } from "../src/core/time.js";

describe("time helpers", () => {
  it("keys a date in the given timezone", () => {
    assert.equal(tzDateKey(Date.UTC(2026, 0, 1, 12, 0, 0), "UTC"), "2026-01-01");
    // 20:00 UTC on Dec 31 is already Jan 1 in Jakarta (+7).
    assert.equal(tzDateKey(Date.UTC(2025, 11, 31, 20, 0, 0), "Asia/Jakarta"), "2026-01-01");
  });

  it("computes seconds until the next midnight", () => {
    assert.equal(secondsUntilNextMidnight(Date.UTC(2026, 0, 1, 23, 0, 0), "UTC"), 3600);
    assert.equal(secondsUntilNextMidnight(Date.UTC(2026, 0, 1, 0, 0, 0), "UTC"), 86_400);
  });

  it("renders human-friendly wait times", () => {
    assert.equal(formatWait(3661), "1h 1m");
    assert.equal(formatWait(90), "1m 30s");
    assert.equal(formatWait(30), "30s");
    assert.equal(formatWait(0), "0s");
  });
});
