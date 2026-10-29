import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerCommandHelp } from "../src/handlers/commandhelp.js";
import { formatCommandHelp } from "../src/lib/command-help.js";
import { createTestBot } from "./helpers.js";

describe("command help", () => {
  it("explains full argument formats and command flow for multiple arguments", () => {
    const help = formatCommandHelp("coinflip", "whatsapp", ".");
    assert.match(help, /Cara pakai: \.coinflip <taruhan> cara\|angka/);
    assert.match(help, /Cara kerja: Memilih sisi koin/);
    assert.match(help, /Contoh: \.coinflip 1000 cara/);
  });

  it("uses Telegram syntax and reports platform-only commands", () => {
    assert.match(formatCommandHelp("pin", "telegram"), /Cara pakai: \/pin/);
    assert.match(formatCommandHelp("database", "whatsapp"), /hanya tersedia di Telegram/);
  });

  it("documents the owner-only media purge command", () => {
    assert.match(formatCommandHelp("purge", "telegram"), /\$purge[\s\S]*khusus pemilik/i);
    assert.match(formatCommandHelp("purge", "whatsapp"), /\$purge[\s\S]*khusus pemilik/i);
  });

  it("offers a command list for an empty query and handles unknown commands", () => {
    assert.match(formatCommandHelp("", "whatsapp"), /Command yang tersedia:.*pin/);
    assert.match(formatCommandHelp("does-not-exist", "telegram"), /belum tersedia/);
  });

  it("registers Telegram /cara_pakai and replies with the requested guide", async () => {
    const t = createTestBot();
    registerCommandHelp(t.bot);
    await t.bot.handleUpdate(t.textUpdate("/cara_pakai pin"));
    assert.match(t.replies()[0] ?? "", /Cara pakai: \/pin/);
    assert.match(t.replies()[0] ?? "", /album/);
  });
});
