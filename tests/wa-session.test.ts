import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WaPlaySessionStore } from "../src/platform/whatsapp/session.js";

describe("whatsapp play session store", () => {
  it("creates and retrieves a session per chat+user", () => {
    const store = new WaPlaySessionStore();
    store.create({ chatId: "c1", userId: "u1", stage: "choose", results: [] });
    assert.equal(store.get("c1", "u1")?.stage, "choose");
    assert.equal(store.get("c1", "u2"), undefined);
  });

  it("expires sessions after the ttl", () => {
    let now = 1000;
    const store = new WaPlaySessionStore(2000, () => now);
    store.create({ chatId: "c1", userId: "u1", stage: "choose", results: [] });
    now = 2500;
    assert.notEqual(store.get("c1", "u1"), undefined);
    now = 4000;
    assert.equal(store.get("c1", "u1"), undefined);
  });

  it("deletes sessions", () => {
    const store = new WaPlaySessionStore();
    store.create({ chatId: "c1", userId: "u1", stage: "format", results: [] });
    store.delete("c1", "u1");
    assert.equal(store.get("c1", "u1"), undefined);
  });
});
