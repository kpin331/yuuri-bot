import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { describe, it } from "node:test";
import { registerBrat } from "../src/handlers/brat.js";
import {
  BRAT_PROMPT,
  BRAT_SESSION_TTL_MS,
  BratSessionStore,
  normalizeBratText,
  parseBratChoice,
  renderBrat,
} from "../src/lib/brat.js";
import { findCommand } from "../src/platform/whatsapp/commands/index.js";
import { bratStore } from "../src/platform/whatsapp/commands/brat.js";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";
import { isToolAvailable } from "../src/lib/tools.js";
import { makeTempDir, removeDir } from "../src/lib/temp.js";
import { createTestBot } from "./helpers.js";

process.env.EVERYONE = "true";

const ffmpegAvailable = await isToolAvailable("ffmpeg");

function waMessage(text: string, userId: string, sent: Array<Record<string, unknown>>): IncomingMessage {
  return {
    sock: {
      user: { id: "bot" },
      profilePictureUrl: async () => undefined,
      sendMessage: async (_jid: string, content: Record<string, unknown>) => {
        sent.push(content);
        return { key: { id: `msg-${sent.length}` } };
      },
    },
    chatId: `${userId}@s.whatsapp.net`,
    isGroup: false,
    senderJid: `${userId}@s.whatsapp.net`,
    senderAlt: null,
    userId,
    phone: userId,
    name: "Tester",
    text,
    message: {},
    quoted: null,
  } as unknown as IncomingMessage;
}

describe("brat helpers", () => {
  it("normalizes text to lowercase brat styling", () => {
    assert.equal(normalizeBratText("  Halo   DUNIA  "), "halo dunia");
    assert.equal(normalizeBratText(""), null);
    assert.equal(normalizeBratText("a".repeat(15)), null);
    assert.equal(normalizeBratText("a b c d e"), "a b c d e");
    assert.equal(normalizeBratText(Array.from({ length: 10 }, () => "abcdefg").join(" ")), null);
  });

  it("parses both word and numbered choices", () => {
    assert.equal(parseBratChoice("static"), "static");
    assert.equal(parseBratChoice("1"), "static");
    assert.equal(parseBratChoice(" ANIMATED "), "animated");
    assert.equal(parseBratChoice("2"), "animated");
    assert.equal(parseBratChoice("gif"), null);
    assert.equal(parseBratChoice(""), null);
  });

  it("keeps sessions separate, overwrites, and expires them", () => {
    let now = 1_000;
    const store = new BratSessionStore(BRAT_SESSION_TTL_MS, () => now);
    store.create({ chatId: "chat-1", userId: "user-1", text: "halo" });
    store.create({ chatId: "chat-1", userId: "user-2", text: "dunia" });
    assert.equal(store.get("chat-1", "user-1")?.text, "halo");
    assert.equal(store.get("chat-1", "user-2")?.text, "dunia");
    assert.equal(store.get("chat-2", "user-1"), null);

    store.create({ chatId: "chat-1", userId: "user-1", text: "baru" });
    assert.equal(store.get("chat-1", "user-1")?.text, "baru");

    now += BRAT_SESSION_TTL_MS;
    assert.equal(store.get("chat-1", "user-1"), null);
  });

  it("registers the command on both platforms", () => {
    const t = createTestBot();
    registerBrat(t.bot);
    assert.equal(findCommand("brat")?.name, "brat");
  });
});

describe("brat Telegram flow", () => {
  it("replies with the exact prompt and two options", async () => {
    const t = createTestBot();
    registerBrat(t.bot);
    await t.bot.handleUpdate(t.textUpdate("/brat Halo DUNIA"));

    const prompt = t.messages().find((call) => call.body.text === BRAT_PROMPT);
    assert.ok(prompt);
    const markup = prompt.body.reply_markup as {
      inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
    assert.deepEqual(
      markup.inline_keyboard[0]?.map((button) => [button.text, button.callback_data]),
      [["static", "brat:static"], ["animated", "brat:animated"]],
    );
  });

  it("sends a PNG when the user replies with 1", { skip: !ffmpegAvailable }, async () => {
    const t = createTestBot();
    registerBrat(t.bot);
    await t.bot.handleUpdate(t.textUpdate("/brat halo"));
    await t.bot.handleUpdate(t.textUpdate("1", { fromId: 222, chatId: 111 }));

    assert.ok(t.calls.some((call) => call.method === "sendPhoto"));
  });

  it("sends an animation when the inline button is used", { skip: !ffmpegAvailable }, async () => {
    const t = createTestBot();
    registerBrat(t.bot);
    await t.bot.handleUpdate(t.textUpdate("/brat halo"));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "brat:animated", fromId: 222, chatId: 111 }));

    assert.ok(t.calls.some((call) => call.method === "sendAnimation"));
  });
});

describe("brat WhatsApp flow", () => {
  it("offers both formats and keeps the exact prompt", async () => {
    const sent: Array<Record<string, unknown>> = [];
    await handleIncoming(waMessage(".brat halo dunia", "628111", sent));

    assert.ok(sent.some((entry) => entry.text === BRAT_PROMPT));
    assert.ok(sent.some((entry) => entry.text === "1. static\n2. animated"));
  });

  it("sends a static image on 1", { skip: !ffmpegAvailable }, async () => {
    const sent: Array<Record<string, unknown>> = [];
    await handleIncoming(waMessage(".brat halo", "628222", sent));
    await handleIncoming(waMessage("1", "628222", sent));

    assert.ok(sent.some((entry) => Buffer.isBuffer(entry.image)));
  });

  it("sends a looping MP4 on 2", { skip: !ffmpegAvailable }, async () => {
    const sent: Array<Record<string, unknown>> = [];
    await handleIncoming(waMessage(".brat halo", "628333", sent));
    await handleIncoming(waMessage("2", "628333", sent));

    assert.ok(sent.some((entry) => Buffer.isBuffer(entry.video) && entry.gifPlayback === true));
  });
});

describe("brat render", () => {
  it("writes a PNG and an MP4", { skip: !ffmpegAvailable }, async () => {
    const dir = await makeTempDir("brat-test");
    try {
      const png = await renderBrat({ text: "halo dunia", format: "static", workDir: dir });
      const mp4 = await renderBrat({ text: "halo dunia", format: "animated", workDir: dir });
      assert.ok((await stat(png)).size > 0);
      assert.ok((await stat(mp4)).size > 0);
    } finally {
      await removeDir(dir);
    }
  });
});
