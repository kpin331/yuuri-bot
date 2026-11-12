import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { registerAdminCommands } from "../src/platform/admincommands.js";
import { createTestBot } from "./helpers.js";

const previousOwner = process.env.OWNER_ID;

afterEach(() => {
  if (previousOwner === undefined) delete process.env.OWNER_ID;
  else process.env.OWNER_ID = previousOwner;
});

describe("Telegram admin group commands", () => {
  it("allows a group administrator to use !ping", async () => {
    const t = createTestBot({ getChatMember: { status: "administrator" } });
    registerAdminCommands(t.bot);

    await t.bot.handleUpdate(t.textUpdate("!ping", { chatType: "supergroup" }));

    assert.match(t.replies()[0] ?? "", /^Waktu respons: \d+ ms/);
    assert.equal(t.replies().length, 1);
    assert.match(t.replies()[0] ?? "", /^Waktu respons: \d+ ms$/);
    await t.bot.handleUpdate(t.textUpdate("!neoping", { chatType: "supergroup" }));
    assert.ok(t.replies().slice(1).some((reply) => reply.includes("Node.js memakai memori:")));
    assert.doesNotMatch(t.replies().join("\n"), /Task manager|PID \| proses/);
  });

  it("denies a non-admin and lets the owner ping privately", async () => {
    const t = createTestBot();
    registerAdminCommands(t.bot);

    await t.bot.handleUpdate(t.textUpdate("!ping", { chatType: "supergroup", fromId: 999 }));
    assert.match(t.replies()[0] ?? "", /admin grup dan pemilik/);

    process.env.OWNER_ID = "222";
    await t.bot.handleUpdate(t.textUpdate("!ping", { fromId: 222 }));
    assert.match(t.replies()[1] ?? "", /^Waktu respons: \d+ ms/);
  });

  it("returns group metadata only in a group", async () => {
    const t = createTestBot({
      getChatMember: { status: "creator" },
      getChat: { title: "Grup Uji", description: "Deskripsi" },
      getChatMemberCount: 9,
    });
    registerAdminCommands(t.bot);

    await t.bot.handleUpdate(t.textUpdate("!groupinfo", { chatType: "supergroup" }));
    assert.match(t.replies()[0] ?? "", /Info grup[\s\S]*ID: 111[\s\S]*Anggota: 9[\s\S]*Deskripsi: Deskripsi/);

    process.env.OWNER_ID = "222";
    await t.bot.handleUpdate(t.textUpdate("!groupinfo", { fromId: 222 }));
    assert.match(t.replies()[1] ?? "", /hanya dapat digunakan di grup/);
  });
});
