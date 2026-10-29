import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";

function createMessage(text: string, phone = "628123", isGroup = true) {
  const sent: Array<{ text?: string }> = [];
  const sock = {
    groupMetadata: async () => ({
      id: "123@g.us",
      subject: "Grup Uji",
      desc: "Deskripsi grup",
      participants: [{ id: "628123@s.whatsapp.net", phoneNumber: "628123", admin: "admin" }],
    }),
    sendMessage: async (_jid: string, content: { text?: string }) => {
      sent.push(content);
      return {};
    },
  };
  const message = {
    sock,
    chatId: isGroup ? "123@g.us" : "628123@s.whatsapp.net",
    isGroup,
    senderJid: `${phone}@s.whatsapp.net`,
    senderAlt: null,
    userId: phone,
    phone,
    name: "Tester",
    text,
    message: { messageTimestamp: Math.floor(Date.now() / 1000) },
    quoted: null,
  } as unknown as IncomingMessage;
  return { message, sent };
}

const previous = {
  everyone: process.env.EVERYONE,
  owner: process.env.OWNER_NUMBER,
  admins: process.env.ADMIN_NUMBERS,
};

beforeEach(() => {
  process.env.EVERYONE = "true";
  delete process.env.OWNER_NUMBER;
  delete process.env.ADMIN_NUMBERS;
});

afterEach(() => {
  if (previous.everyone === undefined) delete process.env.EVERYONE;
  else process.env.EVERYONE = previous.everyone;
  if (previous.owner === undefined) delete process.env.OWNER_NUMBER;
  else process.env.OWNER_NUMBER = previous.owner;
  if (previous.admins === undefined) delete process.env.ADMIN_NUMBERS;
  else process.env.ADMIN_NUMBERS = previous.admins;
});

describe("WhatsApp admin group commands", () => {
  it("allows a group admin to use !ping and groupinfo", async () => {
    const ping = createMessage("!ping");
    await handleIncoming(ping.message);
    assert.match(ping.sent[0]?.text ?? "", /^Waktu respons: \d+ ms/);
    assert.ok(ping.sent.some((message) => message.text?.includes("Node.js memakai memori:")));
    assert.doesNotMatch(ping.sent.map((message) => message.text).join("\n"), /Task manager|PID \| proses/);

    const groupinfo = createMessage("!groupinfo");
    await handleIncoming(groupinfo.message);
    assert.match(groupinfo.sent[0]?.text ?? "", /Grup Uji[\s\S]*123@g\.us[\s\S]*Anggota: 1[\s\S]*Deskripsi grup/);
  });

  it("denies a non-admin and preserves command toggles", async () => {
    const member = createMessage("!ping", "628999");
    await handleIncoming(member.message);
    assert.match(member.sent[0]?.text ?? "", /admin grup dan pemilik/);

    const toggle = createMessage("!ping off");
    await handleIncoming(toggle.message);
    assert.ok(toggle.sent.length > 0);
  });
});
