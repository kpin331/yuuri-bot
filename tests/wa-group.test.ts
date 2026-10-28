import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";

interface SockMock {
  sent: number;
  contents: Array<{ text?: string; caption?: string }>;
  sendMessage: (_jid: string, content: { text?: string; caption?: string }) => Promise<object>;
  groupMetadata: () => Promise<{ participants: never[] }>;
}

function makeMessage(
  chatId: string,
  phone: string | null,
  userId: string,
  text = ".menu",
  isGroup = true,
): [IncomingMessage, SockMock] {
  const sock: SockMock = {
    sent: 0,
    contents: [],
    sendMessage: async (_jid, content) => {
      sock.sent += 1;
      sock.contents.push(content);
      return {};
    },
    groupMetadata: async () => ({ participants: [] }),
  };
  const message = {
    sock,
    chatId,
    isGroup,
    senderJid: `${userId}@s.whatsapp.net`,
    senderAlt: null,
    userId,
    phone,
    name: "Tester",
    text,
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

  it("answers Jarvis in any letter case and sends the menu", async () => {
    const [message, sock] = makeMessage("group@g.us", "628997", "wa-jarvis", "Hey JARVIS");
    await handleIncoming(message);

    assert.equal(sock.contents[0]?.text, "siap,pak");
    assert.ok(sock.contents.some((content) => content.text?.includes("Yuuri Bot V1.0")));
  });

  it("keeps group-only commands private-only unless the owner uses the $ override", async () => {
    for (const name of ["rank", "leaderboard"]) {
      const [regular, regularSock] = makeMessage(
        "628222@s.whatsapp.net",
        "628222",
        `wa-private-${name}`,
        `.${name}`,
        false,
      );
      await handleIncoming(regular);
      assert.ok(regularSock.contents.some((content) => content.text?.includes("Fitur ini hanya untuk grup")), name);

      process.env.OWNER_NUMBER = "628111";
      const [override, overrideSock] = makeMessage(
        "628111@s.whatsapp.net",
        "628111",
        `wa-owner-${name}`,
        `$${name}`,
        false,
      );
      await handleIncoming(override);
      assert.ok(!overrideSock.contents.some((content) => content.text?.includes("Fitur ini hanya untuk grup")), name);
    }
  });
});
