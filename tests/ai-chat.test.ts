import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resetRateLimits } from "../src/core/access.js";
import { registerAiChat } from "../src/handlers/ai-chat.js";
import { closeDatabase, getQuotaRow, initDatabase, saveStickerCatalogEntry } from "../src/lib/db.js";
import { whatsappStickerId } from "../src/lib/sticker-catalog.js";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";
import { createTestBot } from "./helpers.js";

const ENV = ["EVERYONE", "GEMINI_API", "GEMINI_MODEL", "DEFAULT_QUOTA", "RATE_LIMIT", "RATE_WINDOW_SECONDS"] as const;
const previousEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;
const sentPrompts: string[] = [];

function waMessage(text: string, isGroup = false, replies: string[] = [], mentionBot = false): IncomingMessage {
  const chatId = isGroup ? "120363000@g.us" : "62855@s.whatsapp.net";
  const sock = {
    user: { id: "99999:3@s.whatsapp.net", lid: "99999@lid" },
    sendMessage: async (_jid: string, payload: { text?: string }) => {
      if (payload.text) replies.push(payload.text);
      return {};
    },
    groupMetadata: async () => ({ participants: [] }),
  } as unknown as IncomingMessage["sock"];
  return {
    sock,
    chatId,
    isGroup,
    senderJid: "62855@s.whatsapp.net",
    senderAlt: null,
    userId: "62855",
    phone: "62855",
    name: "Tester",
    text,
    message: {
      key: { id: "ai-chat-test" },
      message: mentionBot
        ? { extendedTextMessage: { text, contextInfo: { mentionedJid: ["99999@s.whatsapp.net"] } } }
        : { conversation: text },
    } as IncomingMessage["message"],
    quoted: null,
  };
}

function waStickerMessage(replies: string[], hash = "known-wa-sticker"): IncomingMessage {
  const sock = {
    user: { id: "99999:3@s.whatsapp.net", lid: "99999@lid" },
    sendMessage: async (_jid: string, payload: { text?: string }) => {
      if (payload.text) replies.push(payload.text);
      return {};
    },
    groupMetadata: async () => ({ participants: [] }),
  } as unknown as IncomingMessage["sock"];
  return {
    sock,
    chatId: "62855@s.whatsapp.net",
    isGroup: false,
    senderJid: "62855@s.whatsapp.net",
    senderAlt: null,
    userId: "62855",
    phone: "62855",
    name: "Tester",
    text: "",
    message: {
      key: { id: "ai-sticker-test" },
      message: { stickerMessage: { fileSha256: Buffer.from(hash), mimetype: "image/webp" } },
    } as IncomingMessage["message"],
    quoted: null,
  };
}

describe("AI chat platform routing", () => {
  beforeEach(() => {
    for (const key of ENV) previousEnv[key] = process.env[key];
    process.env.EVERYONE = "true";
    process.env.GEMINI_API = "test-secret";
    process.env.DEFAULT_QUOTA = "25";
    process.env.RATE_LIMIT = "3";
    process.env.RATE_WINDOW_SECONDS = "60";
    closeDatabase();
    initDatabase(":memory:");
    resetRateLimits();
    sentPrompts.length = 0;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      };
      sentPrompts.push(body.contents.at(-1)?.parts[0]?.text ?? "");
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "balasan AI", stickerName: "" }) }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });

  afterEach(() => {
    closeDatabase();
    resetRateLimits();
    for (const key of ENV) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key]!;
    }
    globalThis.fetch = originalFetch;
  });

  it("answers Telegram private messages and only answers groups when the bot is mentioned", async () => {
    const t = createTestBot();
    registerAiChat(t.bot);
    await t.bot.handleUpdate(t.textUpdate("Hai AI", { fromId: 780 }));
    assert.deepEqual(t.replies(), ["balasan AI"]);
    assert.equal(getQuotaRow("telegram", "780")?.quotaLeft, 24);

    await t.bot.handleUpdate(t.textUpdate("pesan grup", { fromId: 781, chatType: "supergroup" }));
    assert.deepEqual(t.replies(), ["balasan AI"]);
    assert.equal(getQuotaRow("telegram", "781"), null);

    const mention = t.textUpdate("@test_bot jawab ya", { fromId: 782, chatType: "supergroup" });
    if (!("message" in mention) || !mention.message) throw new Error("Missing test message");
    mention.message.entities = [{ type: "mention", offset: 0, length: 9 }];
    await t.bot.handleUpdate(mention);
    assert.deepEqual(t.replies(), ["balasan AI", "balasan AI"]);
    assert.equal(getQuotaRow("telegram", "782")?.quotaLeft, 24);
    assert.equal(sentPrompts.at(-1), "jawab ya");
  });

  it("answers WhatsApp private messages and only answers groups when the bot is mentioned", async () => {
    const replies: string[] = [];
    await handleIncoming(waMessage("Hai AI", false, replies));
    assert.deepEqual(replies, ["balasan AI"]);
    assert.equal(getQuotaRow("whatsapp", "62855")?.quotaLeft, 24);

    await handleIncoming(waMessage("pesan grup", true, replies));
    assert.deepEqual(replies, ["balasan AI"]);

    await handleIncoming(waMessage("@99999 halo", true, replies, true));
    assert.deepEqual(replies, ["balasan AI", "balasan AI"]);
    assert.equal(getQuotaRow("whatsapp", "62855")?.quotaLeft, 23);
    assert.equal(sentPrompts.at(-1), "halo");
  });

  it("asks about an unknown private sticker and uses the next text only once", async () => {
    const t = createTestBot();
    registerAiChat(t.bot);
    const unknownSticker = {
      update_id: 2001,
      message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 790, type: "private", first_name: "User" },
        from: { id: 790, is_bot: false, first_name: "User" },
        sticker: {
          file_id: "unknown-file",
          file_unique_id: "unknown-sticker-id",
          type: "regular",
          width: 512,
          height: 512,
          is_animated: false,
          is_video: false,
        },
      },
    } as never;
    await t.bot.handleUpdate(unknownSticker);
    assert.match(t.replies()[0] ?? "", /belum Mommy kenal/);

    await t.bot.handleUpdate(t.textUpdate("Dia lagi malu", { fromId: 790, chatId: 790 }));
    assert.equal(sentPrompts.at(-1), "Konteks: pengguna baru saja menjelaskan arti stiker yang belum dikenal. Gunakan penjelasan ini sekali saja.\nPenjelasan pengguna: Dia lagi malu");
    await t.bot.handleUpdate(t.textUpdate("Masih ingat?", { fromId: 790, chatId: 790 }));
    assert.equal(sentPrompts.at(-1), "Masih ingat?");
  });

  it("sends a registered Telegram sticker when Gemini chooses it", async () => {
    const t = createTestBot();
    registerAiChat(t.bot);
    saveStickerCatalogEntry({
      platform: "telegram",
      stickerId: "catalog-sticker-id",
      name: "malu",
      description: "Yuuri tersipu dan pura-pura kesal",
      telegramFileId: "catalog-file-id",
      stickerData: null,
    });
    globalThis.fetch = (async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: "Ih, jangan godain Mommy!", stickerName: "malu" }) }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

    await t.bot.handleUpdate(t.textUpdate("Kamu lucu", { fromId: 791 }));
    assert.ok(t.replies().includes("Ih, jangan godain Mommy!"));
    assert.ok(t.calls.some((call) => call.method === "sendSticker" && call.body.sticker === "catalog-file-id"));
  });

  it("passes known WhatsApp sticker labels as text context and ignores stickers in groups", async () => {
    const replies: string[] = [];
    const sticker = waStickerMessage(replies);
    const stickerId = whatsappStickerId(sticker.message);
    assert.ok(stickerId);
    saveStickerCatalogEntry({
      platform: "whatsapp",
      stickerId,
      name: "malu",
      description: "Yuuri tersipu dan pura-pura kesal",
      telegramFileId: null,
      stickerData: new Uint8Array([1, 2, 3]),
    });
    await handleIncoming(sticker);
    assert.deepEqual(replies, ["balasan AI"]);
    assert.match(sentPrompts.at(-1) ?? "", /stiker bernama “malu”\. Deskripsi: Yuuri tersipu dan pura-pura kesal/);

    const groupSticker = { ...waStickerMessage(replies), isGroup: true, chatId: "120363000@g.us" };
    await handleIncoming(groupSticker);
    assert.deepEqual(replies, ["balasan AI"]);
  });
});
