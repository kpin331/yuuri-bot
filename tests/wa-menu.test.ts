import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { menuCommand } from "../src/platform/whatsapp/commands/menu.js";
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

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("whatsapp menu", () => {
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
});
