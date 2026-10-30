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

  it("documents Point exchange packages and bank deposit/withdraw usage", () => {
    assert.match(formatCommandHelp("tukar", "whatsapp"), /maksimal 50 Point/);
    assert.match(formatCommandHelp("bank", "telegram"), /deposit <jumlah>/);
    assert.match(formatCommandHelp("bank", "telegram"), /tarik <jumlah>/);
  });

  it("documents quota purchases on Telegram and WhatsApp", () => {
    assert.match(formatCommandHelp("quota", "telegram"), /Rp5\.000[\s\S]*Rp500\.000/);
    assert.match(formatCommandHelp("quota", "whatsapp"), /jumlah 1-25/);
  });

  it("documents the TikTok downloader on both platforms", () => {
    assert.match(formatCommandHelp("tt", "telegram"), /\/tt <tautan TikTok>/);
    assert.match(formatCommandHelp("tt", "whatsapp"), /\.tt <tautan TikTok>/);
  });

  it("documents transfers, loans, owner grants, broadcasts, and #git", () => {
    assert.match(formatCommandHelp("tf", "whatsapp"), /@mention\|nama\|ID/);
    assert.match(formatCommandHelp("transfer", "telegram"), /balas pesan target/);
    assert.match(formatCommandHelp("pinjam", "telegram"), /bunga flat 10%/);
    assert.match(formatCommandHelp("lunas", "telegram"), /Cara pakai: \/lunas/);
    assert.match(formatCommandHelp("lunas", "whatsapp"), /Cara pakai: \.lunas/);
    assert.match(formatCommandHelp("addmoney", "whatsapp"), /khusus pemilik/i);
    assert.match(formatCommandHelp("broadcast", "telegram"), /hanya di chat pribadi/);
    assert.match(formatCommandHelp("#git", "whatsapp"), /chat mana pun/);
    assert.doesNotMatch(formatCommandHelp("$SHELL", "telegram"), /SHELL -E git/);
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
