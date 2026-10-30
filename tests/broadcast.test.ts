import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, initDatabase, recordIncoming } from "../src/lib/db.js";
import { registerBroadcast } from "../src/handlers/broadcast.js";
import { findCommand } from "../src/platform/whatsapp/commands/index.js";
import { createTestBot } from "./helpers.js";

describe("owner broadcast", () => {
  const savedOwner = process.env.OWNER_ID;
  const savedEveryone = process.env.EVERYONE;

  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
    process.env.OWNER_ID = "222";
    process.env.EVERYONE = "true";
    recordIncoming({ user: { id: 333, firstName: "Recipient" } });
  });

  afterEach(() => {
    closeDatabase();
    if (savedOwner === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = savedOwner;
    if (savedEveryone === undefined) delete process.env.EVERYONE;
    else process.env.EVERYONE = savedEveryone;
  });

  it("broadcasts text to users on Telegram and keeps the command private-only", async () => {
    const test = createTestBot();
    registerBroadcast(test.bot);
    await test.bot.handleUpdate(test.textUpdate("$bc Halo semua", { fromId: 222 }));
    const recipientMessage = test.calls.find((call) => call.method === "sendMessage" && call.body.chat_id === 333);
    assert.equal(recipientMessage?.body.text, "Halo semua");
    assert.match(test.replies().at(-1) ?? "", /terkirim: 1; gagal: 0/i);

    const group = createTestBot();
    registerBroadcast(group.bot);
    await group.bot.handleUpdate(group.textUpdate("$bc jangan kirim", { fromId: 222, chatType: "group" }));
    assert.match(group.replies()[0] ?? "", /chat pribadi/i);
    assert.equal(group.calls.some((call) => call.body.chat_id === 333), false);
  });

  it("forwards an owner message and registers the WhatsApp alias", async () => {
    const test = createTestBot();
    registerBroadcast(test.bot);
    const replyTo = {
      message_id: 88,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 111, type: "private" },
      from: { id: 222, is_bot: false, first_name: "Owner" },
      text: "Pengumuman asli",
    } as never;
    await test.bot.handleUpdate(test.textUpdate("$broadcast", { fromId: 222, replyTo }));
    const forwarded = test.calls.find((call) => call.method === "forwardMessage");
    assert.equal(forwarded?.body.chat_id, 333);
    assert.equal(forwarded?.body.message_id, 88);
    assert.equal(findCommand("bc")?.ownerOnly, true);
    assert.equal(findCommand("broadcast")?.name, "bc");
  });
});
