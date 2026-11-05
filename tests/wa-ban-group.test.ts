import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { addWaBan, closeDatabase, initDatabase, isWaBanned } from "../src/lib/db.js";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";

const previous = {
  everyone: process.env.EVERYONE,
  owner: process.env.OWNER_NUMBER,
  admins: process.env.ADMIN_NUMBERS,
};

before(() => {
  process.env.EVERYONE = "true";
  delete process.env.OWNER_NUMBER;
  delete process.env.ADMIN_NUMBERS;
  initDatabase(":memory:");
});

after(() => {
  closeDatabase();
  if (previous.everyone === undefined) delete process.env.EVERYONE;
  else process.env.EVERYONE = previous.everyone;
  if (previous.owner === undefined) delete process.env.OWNER_NUMBER;
  else process.env.OWNER_NUMBER = previous.owner;
  if (previous.admins === undefined) delete process.env.ADMIN_NUMBERS;
  else process.env.ADMIN_NUMBERS = previous.admins;
});

describe("WhatsApp group bans", () => {
  it("lets a group admin use .bangroup", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const sock = {
      groupMetadata: async () => ({
        id: "123@g.us",
        subject: "Grup Uji",
        desc: "",
        participants: [{ id: "628123@s.whatsapp.net", phoneNumber: "628123", admin: "admin" }],
      }),
      sendMessage: async (_jid: string, content: Record<string, unknown>) => {
        sent.push(content);
        return {};
      },
    };
    const message = {
      sock,
      chatId: "123@g.us",
      isGroup: true,
      senderJid: "628123@s.whatsapp.net",
      senderAlt: null,
      userId: "628123",
      phone: "628123",
      name: "Admin",
      text: ".bangroup 628999 -h1",
      message: { key: { id: "admin-message", remoteJid: "123@g.us" }, messageTimestamp: Math.floor(Date.now() / 1000) },
      quoted: null,
    } as unknown as IncomingMessage;

    await handleIncoming(message);

    assert.equal(isWaBanned("628999"), true);
    assert.match(String(sent[0]?.text ?? ""), /628999.*diblokir/);
  });

  it("deletes messages from banned members in groups and stays silent", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const sock = {
      sendMessage: async (_jid: string, content: Record<string, unknown>) => {
        sent.push(content);
        return {};
      },
    };
    addWaBan({ userId: "628555", bannedBy: "628123", createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
    const message = {
      sock,
      chatId: "123@g.us",
      isGroup: true,
      senderJid: "628555@s.whatsapp.net",
      senderAlt: null,
      userId: "628555",
      phone: "628555",
      name: "Banned",
      text: "pesan baru",
      message: { key: { id: "banned-message", remoteJid: "123@g.us" }, messageTimestamp: Math.floor(Date.now() / 1000) },
      quoted: null,
    } as unknown as IncomingMessage;

    await handleIncoming(message);

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]?.delete, {
      id: "banned-message",
      remoteJid: "123@g.us",
      participant: "628555@s.whatsapp.net",
      fromMe: false,
    });
  });
});
