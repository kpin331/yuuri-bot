import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";

interface SockMock {
  sent: number;
  sendMessage: () => Promise<object>;
  groupMetadata: () => Promise<{ participants: never[] }>;
}

function makeMessage(chatId: string, phone: string | null, userId: string): [IncomingMessage, SockMock] {
  const sock: SockMock = {
    sent: 0,
    sendMessage: async () => {
      sock.sent += 1;
      return {};
    },
    groupMetadata: async () => ({ participants: [] }),
  };
  const message = {
    sock,
    chatId,
    isGroup: true,
    senderJid: `${userId}@s.whatsapp.net`,
    senderAlt: null,
    userId,
    phone,
    name: "Tester",
    text: ".menu",
    message: {},
    quoted: null,
  } as unknown as IncomingMessage;
  return [message, sock];
}

const KEYS = ["GROUP_ONLY", "ALLOWED_GROUPS", "EVERYONE", "OWNER_NUMBER", "ADMIN_NUMBERS"] as const;
let saved: Record<string, string | undefined> = {};

describe("whatsapp group allowlist", () => {
  beforeEach(() => {
    saved = {};
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.EVERYONE = "true";
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key]!;
    }
  });

  it("ignores a member's message in a non-listed group when GROUP_ONLY is on", async () => {
    process.env.GROUP_ONLY = "true";
    process.env.ALLOWED_GROUPS = "allowed@g.us";
    const [message, sock] = makeMessage("other@g.us", "628999", "wa-group-blocked");
    await handleIncoming(message);
    assert.equal(sock.sent, 0);
  });

  it("runs a member's command in a listed group when GROUP_ONLY is on", async () => {
    process.env.GROUP_ONLY = "true";
    process.env.ALLOWED_GROUPS = "allowed@g.us";
    const [message, sock] = makeMessage("allowed@g.us", "628998", "wa-group-allowed");
    await handleIncoming(message);
    assert.ok(sock.sent > 0);
  });

  it("lets the owner through in a non-listed group", async () => {
    process.env.GROUP_ONLY = "true";
    process.env.ALLOWED_GROUPS = "allowed@g.us";
    process.env.OWNER_NUMBER = "628111";
    const [message, sock] = makeMessage("other@g.us", "628111", "wa-group-owner");
    await handleIncoming(message);
    assert.ok(sock.sent > 0);
  });

  it("allows any group when GROUP_ONLY is off", async () => {
    const [message, sock] = makeMessage("whatever@g.us", "628997", "wa-group-open");
    await handleIncoming(message);
    assert.ok(sock.sent > 0);
  });
});
