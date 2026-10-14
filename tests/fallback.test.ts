import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { createTestBot } from "./helpers.js";
import { registerFallback } from "../src/handlers/fallback.js";

describe("fallback (echo fix)", () => {
  let ctx: ReturnType<typeof createTestBot>;

  beforeEach(() => {
    ctx = createTestBot();
    registerFallback(ctx.bot);
  });

  it("does not echo normal text", async () => {
    await ctx.bot.handleUpdate(ctx.textUpdate("hello world"));
    assert.deepEqual(ctx.replies(), []);
  });

  it("does not reply to non-text messages", async () => {
    const photo = {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 111, type: "private" },
      from: { id: 222, is_bot: false, first_name: "User" },
      photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }],
    };
    await ctx.bot.handleUpdate({ update_id: 5, message: photo } as never);
    assert.deepEqual(ctx.replies(), []);
  });

  it("replies 'Unknown command.' to an unrecognised command", async () => {
    await ctx.bot.handleUpdate(ctx.textUpdate("/nope"));
    assert.deepEqual(ctx.replies(), ["Unknown command."]);
  });

  it("replies 'Unknown command.' to a command with an argument", async () => {
    await ctx.bot.handleUpdate(ctx.textUpdate("/nope@somebot thing"));
    assert.deepEqual(ctx.replies(), ["Unknown command."]);
  });
});
