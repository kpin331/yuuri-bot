import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { configureRuntime, runtimeOptions } from "../src/lib/runtime.js";
import { menuCommand, startCommand } from "../src/platform/whatsapp/commands/menu.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";

interface Sent {
  jid: string;
  content: { text?: string; image?: Buffer; caption?: string };
}

function makeMessage(sock: object): IncomingMessage {
  return {
    sock,
    chatId: "111@s.whatsapp.net",
    isGroup: false,
    senderJid: "222@s.whatsapp.net",
    senderAlt: null,
    userId: "222",
    phone: "222",
    name: "Tester",
    text: ".menu",
    message: {},
    quoted: null,
  } as unknown as IncomingMessage;
}

const originalFetch = globalThis.fetch;
const originalRuntime = runtimeOptions();
const originalAllowedGroups = process.env.ALLOWED_GROUPS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureRuntime(originalRuntime);
  if (originalAllowedGroups === undefined) delete process.env.ALLOWED_GROUPS;
  else process.env.ALLOWED_GROUPS = originalAllowedGroups;
});

describe("whatsapp menu", () => {
  it("keeps the bot photo on start and replaces the menu with a greeting", async () => {
    const sent: Sent[] = [];
    const sock = {
      user: { id: "bot@s.whatsapp.net" },
      profilePictureUrl: async (id: string) => {
        assert.equal(id, "bot@s.whatsapp.net");
        return "https://example.test/pp.jpg";
      },
      sendMessage: async (jid: string, content: Sent["content"]) => {
        sent.push({ jid, content });
        return {};
      },
    };
    globalThis.fetch = (async () => new Response(Buffer.from([1, 2, 3]))) as typeof fetch;
    await startCommand.run({ message: makeMessage(sock), args: "", role: "member" });
    assert.equal(sent.length, 1);
    assert.ok(Buffer.isBuffer(sent[0]?.content.image));
    assert.match(sent[0]?.content.caption ?? "", /Selamat .*Tester\.[\s\S]*Jumlah command tersedia: \d+[\s\S]*Level kamu: 1[\s\S]*Ketik help/);
    assert.doesNotMatch(sent[0]?.content.caption ?? "", /Daftar perintah/);
  });
  it("sends the bot's profile picture with the menu as its caption", async () => {
    const sent: Sent[] = [];
    const sock = {
      user: { id: "6285297384286:15@s.whatsapp.net" },
      profilePictureUrl: async () => "https://example.test/pp.jpg",
      sendMessage: async (jid: string, content: Sent["content"]) => {
        sent.push({ jid, content });
        return {};
      },
    };
    globalThis.fetch = (async () =>
      new Response(Buffer.from([1, 2, 3]), { status: 200 })) as unknown as typeof fetch;

    await menuCommand.run({ message: makeMessage(sock), args: "", role: "member" });

    assert.equal(sent.length, 1);
    assert.ok(Buffer.isBuffer(sent[0]?.content.image), "expected an image message");
    assert.ok(sent[0]?.content.caption?.includes("Yuuri Bot V1.0"));
    const menu = sent[0]?.content.caption ?? "";
    assert.ok(menu.includes("POWERSHELL:"));
    assert.ok(menu.includes("$purge"));
    assert.ok(menu.includes(".tukar [jumlah Point 1-50]"));
    assert.ok(menu.includes(".bank [deposit|tarik jumlah]"));
    assert.ok(menu.includes(".quota — Lihat kuota dan paket isi ulang minimum, basic, max"));
    assert.ok(menu.includes(".wordle - Tebak kata 5 huruf"));
    assert.doesNotMatch(menu, /\.wordle .*COMING SOON/i);
    assert.ok(menu.includes(".tt — Unduh dari TikTok"));
    const financeStart = menu.indexOf("<Keuangan virtual>");
    const financeEnd = menu.indexOf("<Pengunduh>", financeStart);
    const financeMenu = menu.slice(financeStart, financeEnd);
    assert.match(financeMenu, /\.tf <target> <jumlah> .*Transfer saldo wallet/);
    assert.match(financeMenu, /\.pinjam <jumlah> .*Pinjaman virtual, bunga 10%/);
    assert.ok(financeMenu.includes(".lunas - Lunasi semua pinjaman aktif"));
    assert.doesNotMatch(menu.slice(0, financeStart), /\.tf |\.pinjam |\.lunas/);
    assert.ok(menu.includes("$addmoney <target> <jumlah>"));
    assert.ok(menu.includes("$bc <pesan>"));
    assert.ok(menu.includes("#git"));
    assert.ok(menu.includes("<Umum>"));
    assert.ok(menu.includes("================"));
    assert.ok(menu.split("\n").some((line) => line.startsWith("- .menu")));
  });

  it("falls back to a text menu when no profile picture is available", async () => {
    const sent: Sent[] = [];
    const sock = {
      user: { id: "6285297384286:15@s.whatsapp.net" },
      profilePictureUrl: async () => undefined,
      sendMessage: async (jid: string, content: Sent["content"]) => {
        sent.push({ jid, content });
        return {};
      },
    };

    await menuCommand.run({ message: makeMessage(sock), args: "", role: "member" });

    assert.equal(sent.length, 1);
    assert.ok(sent[0]?.content.text?.includes("Yuuri Bot V1.0"));
    assert.equal(sent[0]?.content.image, undefined);
  });

  it("sends CHANGELOG.txt to allowlisted WhatsApp groups when the owner opens the menu with the flag", async () => {
    process.env.ALLOWED_GROUPS = "12345@g.us, -100987654321";
    configureRuntime({ ...originalRuntime, changelog: true });
    const sent: Sent[] = [];
    const sock = {
      user: { id: "6285297384286:15@s.whatsapp.net" },
      profilePictureUrl: async () => undefined,
      sendMessage: async (jid: string, content: Sent["content"]) => {
        sent.push({ jid, content });
        return {};
      },
    };

    await menuCommand.run({ message: makeMessage(sock), args: "", role: "owner" });

    const changelog = sent.find((item) => item.jid === "12345@g.us");
    assert.match(changelog?.content.text ?? "", /^changelog\r?\nubah:/i);
    assert.equal(sent.some((item) => item.jid === "-100987654321@g.us"), false);
    assert.ok(sent.some((item) => item.jid === "111@s.whatsapp.net"), "the owner still receives the menu");
  });

  it("does not broadcast the changelog when a non-owner opens the menu", async () => {
    process.env.ALLOWED_GROUPS = "12345@g.us";
    configureRuntime({ ...originalRuntime, changelog: true });
    const sent: Sent[] = [];
    const sock = {
      user: { id: "6285297384286:15@s.whatsapp.net" },
      profilePictureUrl: async () => undefined,
      sendMessage: async (jid: string, content: Sent["content"]) => {
        sent.push({ jid, content });
        return {};
      },
    };

    await menuCommand.run({ message: makeMessage(sock), args: "", role: "member" });

    assert.equal(sent.some((item) => item.jid === "12345@g.us"), false);
  });
});
