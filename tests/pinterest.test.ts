import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { topPins } from "../src/lib/pinterest.js";

describe("Pinterest search results", () => {
  it("selects at most the first four results that have images", () => {
    const pins = [
      { id: "missing" },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: String(index),
        images: { orig: { url: `https://images.example/${index}.jpg` } },
      })),
    ];
    assert.deepEqual(topPins(pins).map((pin) => pin.id), ["0", "1", "2", "3"]);
  });
});
