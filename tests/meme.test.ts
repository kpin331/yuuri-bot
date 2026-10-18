import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { registerSmeme } from "../src/handlers/smeme.js";
import { fitMemeFont, parseMemeText } from "../src/lib/meme.js";
import { smemeCommand } from "../src/platform/whatsapp/commands/smeme.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";
import { createTestBot } from "./helpers.js";

describe("parseMemeText", () => {
  it("returns null for empty input", () => {
    assert.equal(parseMemeText(""), null);
    assert.equal(parseMemeText("   "), null);
    assert.equal(parseMemeText(" | "), null);
  });

  it("sends a single line to the bottom", () => {
    assert.deepEqual(parseMemeText("hello"), { top: null, bottom: "hello" });
  });

  it("splits on the first pipe and trims both sides", () => {
    assert.deepEqual(parseMemeText("  top  |  bottom  "), { top: "top", bottom: "bottom" });
    assert.deepEqual(parseMemeText("a|b|c"), { top: "a", bottom: "b|c" });
  });

  it("keeps whichever side is present", () => {
    assert.deepEqual(parseMemeText("only top |"), { top: "only top", bottom: null });
    assert.deepEqual(parseMemeText("|bottom"), { top: null, bottom: "bottom" });
  });
});

describe("fitMemeFont", () => {
  it("scales the font with the image width", () => {
    const metrics = fitMemeFont(512, ["hi"]);
    assert.deepEqual(metrics, { fontSize: 51, borderW: 4 });
    assert.deepEqual(fitMemeFont(1000, [null, null]), { fontSize: 100, borderW: 8 });
  });

  it("shrinks long captions so they fit the width", () => {
    const metrics = fitMemeFont(512, ["x".repeat(200)]);
    assert.equal(metrics.fontSize, 12);
    assert.equal(metrics.borderW, 2);
  });

  it("uses one shared size for both lines", () => {
    const metrics = fitMemeFont(512, ["short", "x".repeat(50)]);
    assert.equal(metrics.fontSize, Math.floor((512 * 0.94) / (50 * 0.58)));
  });

  it("keeps the outline proportionate but modest", () => {
    for (const width of [200, 512, 1920]) {
      const { fontSize, borderW } = fitMemeFont(width, ["meme"]);
      const ratio = borderW / fontSize;
      assert.ok(ratio >= 0.04 && ratio <= 0.1, `ratio ${ratio} out of range at width ${width}`);
    }
  });
});

function stickerMessage(id: number) {
  return {
    message_id: id,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 111, type: "private" },
    from: { id: 333, is_bot: false, first_name: "Sender" },
    sticker: {
      file_id: "sticker-file",
      file_unique_id: "sticker-unique",
      type: "sticker",
      is_animated: false,
      is_video: false,
      width: 512,
      height: 512,
    },
  };
}

describe("telegram smeme", () => {
  let ctx: ReturnType<typeof createTestBot>;

  beforeEach(() => {
    ctx = createTestBot();
    registerSmeme(ctx.bot);
  });

  it("asks for media when the command has none", async () => {
    await ctx.bot.handleUpdate(ctx.textUpdate("/smeme top | bottom"));

    const text = ctx.replies().join("\n");
    assert.ok(text.includes("Reply to an image or video with /smeme"));
    assert.equal(ctx.calls.some((call) => call.method === "sendSticker"), false);
  });

  it("asks for text when the reply has no caption text", async () => {
    const update = ctx.textUpdate("/smeme", { replyTo: stickerMessage(50) as never });
    await ctx.bot.handleUpdate(update);

    const text = ctx.replies().join("\n");
    assert.ok(text.includes("top | bottom"));
    assert.equal(ctx.calls.some((call) => call.method === "sendSticker"), false);
  });
});

function makeWaMessage(sock: object, message: object): IncomingMessage {
  return {
    sock,
    chatId: "111@s.whatsapp.net",
    isGroup: false,
    senderJid: "222@s.whatsapp.net",
    senderAlt: null,
    userId: "222",
    phone: "222",
    name: "Tester",
    text: ".smeme",
    message,
    quoted: null,
  } as unknown as IncomingMessage;
}

describe("whatsapp smeme", () => {
  function fakeSock(sent: { text?: string }[]) {
    return {
      sendMessage: async (_jid: string, content: { text?: string }) => {
        sent.push(content);
        return {};
      },
    };
  }

  it("asks for media when the command has none", async () => {
    const sent: { text?: string }[] = [];
    await smemeCommand.run({
      message: makeWaMessage(fakeSock(sent), {}),
      args: "top | bottom",
      role: "member",
    });

    assert.ok(sent[0]?.text?.includes("Reply to an image or video with .smeme"));
  });

  it("asks for text when the quoted message has no text", async () => {
    const sent: { text?: string }[] = [];
    await smemeCommand.run({
      message: makeWaMessage(fakeSock(sent), { message: { imageMessage: {} } }),
      args: "",
      role: "member",
    });

    assert.ok(sent[0]?.text?.includes("top | bottom"));
  });
});
