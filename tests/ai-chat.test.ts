import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resetRateLimits } from "../src/core/access.js";
import { registerAiChat } from "../src/handlers/ai-chat.js";
import { closeDatabase, getQuotaRow, initDatabase } from "../src/lib/db.js";
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
        candidates: [{ content: { parts: [{ text: "balasan AI" }] } }],
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
});
