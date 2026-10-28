import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { userinfoCommand } from "../src/platform/whatsapp/commands/userinfo.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("WhatsApp userinfo profile header", () => {
  it("sends the user's profile photo with the report as its caption", async () => {
    const sent: Array<{ image?: Buffer; caption?: string; text?: string }> = [];
    const sock = {
      profilePictureUrl: async (jid: string) => {
        assert.equal(jid, "628222@s.whatsapp.net");
        return "https://example.test/user.jpg";
      },
      sendMessage: async (_jid: string, content: { image?: Buffer; caption?: string; text?: string }) => {
        sent.push(content);
        return {};
      },
    };
    globalThis.fetch = (async () => new Response(Buffer.from([1, 2, 3]), { status: 200 })) as typeof fetch;
    const message = {
      sock,
      chatId: "628222@s.whatsapp.net",
      isGroup: false,
      senderJid: "628222@s.whatsapp.net",
      senderAlt: null,
      userId: "628222",
      phone: "628222",
      name: "Tester",
      text: ".userinfo",
      message: {},
      quoted: null,
    } as unknown as IncomingMessage;

    await userinfoCommand.run({ message, args: "", role: "member" });

    assert.equal(sent.length, 1);
    assert.ok(Buffer.isBuffer(sent[0]?.image));
    assert.ok(sent[0]?.caption?.includes("*Profil*"));
  });

  it("falls back to text if the profile photo is unavailable", async () => {
    const sent: Array<{ image?: Buffer; caption?: string; text?: string }> = [];
    const sock = {
      profilePictureUrl: async () => undefined,
      sendMessage: async (_jid: string, content: { image?: Buffer; caption?: string; text?: string }) => {
        sent.push(content);
        return {};
      },
    };
    const message = {
      sock,
      chatId: "628222@s.whatsapp.net",
      isGroup: false,
      senderJid: "628222@s.whatsapp.net",
      senderAlt: null,
      userId: "628222",
      phone: "628222",
      name: "Tester",
      text: ".userinfo",
      message: {},
      quoted: null,
    } as unknown as IncomingMessage;

    await userinfoCommand.run({ message, args: "", role: "member" });

    assert.ok(sent[0]?.text?.includes("*Profil*"));
  });
});
