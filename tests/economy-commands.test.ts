import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, initDatabase, recordIncoming } from "../src/lib/db.js";
import { getWallet } from "../src/lib/casino-storage.js";
import { registerEconomy } from "../src/handlers/economy.js";
import { createTestBot } from "./helpers.js";

describe("Telegram wallet transfer commands", () => {
  const savedOwner = process.env.OWNER_ID;
  const savedEveryone = process.env.EVERYONE;

  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
    process.env.OWNER_ID = "222";
    process.env.EVERYONE = "true";
    recordIncoming({ user: { id: 222, firstName: "Sender" } });
    recordIncoming({ user: { id: 333, firstName: "Receiver", username: "receiver" } });
  });

  afterEach(() => {
    closeDatabase();
    if (savedOwner === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = savedOwner;
    if (savedEveryone === undefined) delete process.env.EVERYONE;
    else process.env.EVERYONE = savedEveryone;
  });

  it("transfers from wallet using an @username target", async () => {
    const test = createTestBot();
    registerEconomy(test.bot);
    await test.bot.handleUpdate(test.textUpdate("/tf @receiver 25.000", { fromId: 222 }));
    assert.equal(getWallet("222")?.balance, 75_000);
    assert.equal(getWallet("333")?.balance, 125_000);
    assert.match(test.replies()[0] ?? "", /Transfer Rp25\.000 berhasil/);
  });

  it("allows only the owner to grant money to a reply target", async () => {
    const test = createTestBot();
    registerEconomy(test.bot);
    const replyTo = {
      message_id: 88,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 111, type: "private" },
      from: { id: 333, is_bot: false, first_name: "Receiver" },
      text: "hello",
    } as never;
    await test.bot.handleUpdate(test.textUpdate("$addmoney 10.000", { fromId: 222, replyTo }));
    assert.equal(getWallet("333")?.balance, 110_000);

    await test.bot.handleUpdate(test.textUpdate("$addmoney 333 10.000", { fromId: 444 }));
    assert.match(test.replies().at(-1) ?? "", /hanya untuk pemilik/i);
    assert.equal(getWallet("333")?.balance, 110_000);
  });
});
