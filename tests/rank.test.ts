import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { registerRank } from "../src/handlers/rank.js";
import { createTestBot } from "./helpers.js";

const previousOwner = process.env.OWNER_ID;
const previousEveryone = process.env.EVERYONE;

describe("Telegram group-only rank override", () => {
  beforeEach(() => {
    process.env.OWNER_ID = "222";
    process.env.EVERYONE = "true";
  });

  afterEach(() => {
    if (previousOwner === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = previousOwner;
    if (previousEveryone === undefined) delete process.env.EVERYONE;
    else process.env.EVERYONE = previousEveryone;
  });

  it("lets the owner use group-only commands with $ in a private chat", async () => {
    for (const name of ["rank", "leaderboard"]) {
      const t = createTestBot();
      registerRank(t.bot);

      await t.bot.handleUpdate(t.textUpdate(`$${name}`, { fromId: 222 }));

      assert.ok(!t.replies().some((reply) => reply.includes("Fitur ini hanya untuk grup")), name);
    }
  });

  it("keeps the regular rank command group-only in private chats", async () => {
    const t = createTestBot();
    registerRank(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/rank", { fromId: 333 }));

    assert.ok(t.replies().some((reply) => reply.includes("Fitur ini hanya untuk grup")));
  });
});
