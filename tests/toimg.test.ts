import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { createTestBot } from "./helpers.js";
import { registerToimg } from "../src/handlers/toimg.js";

function stickerMessage(id: number, isAnimated: boolean, isVideo = false) {
  return {
    message_id: id,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 111, type: "private" },
    from: { id: 333, is_bot: false, first_name: "Sender" },
    sticker: {
      file_id: "sticker-file",
      file_unique_id: "sticker-unique",
      type: "sticker",
      is_animated: isAnimated,
      is_video: isVideo,
      width: 512,
      height: 512,
    },
  };
}

describe("toimg", () => {
  let ctx: ReturnType<typeof createTestBot>;

  beforeEach(() => {
    ctx = createTestBot();
    registerToimg(ctx.bot);
  });

  it("explains that animated stickers cannot be converted", async () => {
    const update = ctx.textUpdate("/toimg", { replyTo: stickerMessage(50, true) as never });
    await ctx.bot.handleUpdate(update);

    const text = ctx.replies().join("\n");
    assert.ok(text.includes("Animated"));
    assert.ok(text.includes(".tgs"));
    assert.equal(ctx.calls.some((call) => call.method === "sendDocument"), false);
  });

  it("asks the user to reply to a sticker when none is present", async () => {
    await ctx.bot.handleUpdate(ctx.textUpdate("/toimg"));

    const text = ctx.replies().join("\n");
    assert.ok(text.includes("Reply to a sticker"));
    assert.equal(ctx.calls.some((call) => call.method === "sendDocument"), false);
  });
});
