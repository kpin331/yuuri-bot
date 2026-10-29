import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { registerPurge } from "../src/handlers/purge.js";
import { createTestBot } from "./helpers.js";

const previous = {
  ownerId: process.env.OWNER_ID,
};

afterEach(() => {
  if (previous.ownerId === undefined) delete process.env.OWNER_ID;
  else process.env.OWNER_ID = previous.ownerId;
});

describe("Telegram media purge command", () => {
  it("rejects users who are not the configured owner", async () => {
    process.env.OWNER_ID = "222";
    const t = createTestBot();
    registerPurge(t.bot);

    await t.bot.handleUpdate(t.textUpdate("$purge", { fromId: 333, hasCommand: false }));

    assert.match(t.replies()[0] ?? "", /hanya untuk pemilik bot/i);
  });
});
