import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { checkRateLimit, resetRateLimits } from "../src/core/access.js";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";
import { closeDatabase, getQuotaRow, initDatabase } from "../src/lib/db.js";
import { createTestBot } from "./helpers.js";
import { registerCasino } from "../src/handlers/casino.js";

const ENV = ["EVERYONE", "DEFAULT_QUOTA", "RATE_LIMIT", "RATE_WINDOW_SECONDS"] as const;
let previous: Record<string, string | undefined> = {};

function waMessage(text: string, sent: string[] = []): IncomingMessage {
  const sock = {
    sendMessage: async (_chatId: string, payload: { text?: string }) => {
      if (payload.text) sent.push(payload.text);
      return {};
    },
    groupMetadata: async () => ({ participants: [] }),
  } as unknown as IncomingMessage["sock"];
  return {
    sock, chatId: "62855@s.whatsapp.net", isGroup: false, senderJid: "62855@s.whatsapp.net",
    senderAlt: null, userId: "62855", phone: "62855", name: "Tester", text,
    message: { key: { id: "casino-test" } } as IncomingMessage["message"], quoted: null,
  };
}

describe("casino routing and charges", () => {
  beforeEach(() => {
    previous = {};
    for (const key of ENV) { previous[key] = process.env[key]; }
    process.env.EVERYONE = "true";
    process.env.DEFAULT_QUOTA = "25";
    process.env.RATE_LIMIT = "3";
    process.env.RATE_WINDOW_SECONDS = "60";
    closeDatabase(); initDatabase(":memory:"); resetRateLimits();
  });
  afterEach(() => {
    closeDatabase(); resetRateLimits();
    for (const key of ENV) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]!;
    }
  });

  it("does not charge invalid WhatsApp input; valid actions spend three quota and are rate limited", async () => {
    await handleIncoming(waMessage(".slot nope"));
    assert.equal(getQuotaRow("whatsapp", "62855"), null);
    for (let n = 0; n < 3; n += 1) await handleIncoming(waMessage(".slot 10"));
    const beforeBlocked = getQuotaRow("whatsapp", "62855")?.quotaLeft;
    await handleIncoming(waMessage(".slot 10"));
    assert.equal(beforeBlocked, 16);
    assert.equal(getQuotaRow("whatsapp", "62855")?.quotaLeft, 16);
    assert.equal(checkRateLimit("whatsapp", "62855").allowed, false);
  });

  it("charges Telegram casino actions three quota each and leaves invalid input free", async () => {
    const t = createTestBot();
    registerCasino(t.bot);
    await t.bot.handleUpdate(t.textUpdate("/slot nope", { fromId: 778 }));
    assert.equal(getQuotaRow("telegram", "778"), null);
    for (let n = 0; n < 3; n += 1) await t.bot.handleUpdate(t.textUpdate("/slot 10", { fromId: 778 }));
    assert.equal(getQuotaRow("telegram", "778")?.quotaLeft, 16);
    await t.bot.handleUpdate(t.textUpdate("/slot 10", { fromId: 778 }));
    assert.equal(getQuotaRow("telegram", "778")?.quotaLeft, 16);
  });

  it("rejects both platforms before rate limiting when fewer than three quota remain", async () => {
    process.env.DEFAULT_QUOTA = "2";
    const whatsappReplies: string[] = [];
    await handleIncoming(waMessage(".slot 10", whatsappReplies));
    assert.ok(whatsappReplies.some((reply) => reply.startsWith("⚠️ Kuota harian tidak cukup")));
    assert.equal(getQuotaRow("whatsapp", "62855")?.quotaLeft, 2);
    assert.equal(checkRateLimit("whatsapp", "62855").allowed, true);

    const t = createTestBot();
    registerCasino(t.bot);
    await t.bot.handleUpdate(t.textUpdate("/slot 10", { fromId: 778 }));
    assert.ok(t.replies().some((reply) => reply.startsWith("⚠️ Kuota harian tidak cukup")));
    assert.equal(getQuotaRow("telegram", "778")?.quotaLeft, 2);
    assert.equal(checkRateLimit("telegram", "778").allowed, true);
  });
});
