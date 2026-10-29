import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";

const oldEveryone = process.env.EVERYONE;
const oldPrefix = process.env.COMMAND_PREFIX;

afterEach(() => {
  if (oldEveryone === undefined) delete process.env.EVERYONE;
  else process.env.EVERYONE = oldEveryone;
  if (oldPrefix === undefined) delete process.env.COMMAND_PREFIX;
  else process.env.COMMAND_PREFIX = oldPrefix;
});

describe("WhatsApp .cara-pakai", () => {
  it("parses the hyphenated command and describes commands with multiple arguments", async () => {
    process.env.EVERYONE = "true";
    process.env.COMMAND_PREFIX = ".";
    const sent: Array<{ text?: string }> = [];
    const message = {
      sock: {
        sendMessage: async (_jid: string, content: { text?: string }) => {
          sent.push(content);
          return { key: { id: "help" } };
        },
        groupMetadata: async () => ({ participants: [] }),
      },
      chatId: "62855@s.whatsapp.net",
      isGroup: false,
      senderJid: "62855@s.whatsapp.net",
      senderAlt: null,
      userId: "62855",
      phone: "62855",
      name: "Tester",
      text: ".cara-pakai coinflip",
      message: { key: { id: "incoming" } },
      quoted: null,
    } as unknown as IncomingMessage;

    await handleIncoming(message);
    assert.match(sent[0]?.text ?? "", /Cara pakai: \.coinflip <taruhan> cara\|angka/);
    assert.match(sent[0]?.text ?? "", /Contoh: \.coinflip 1000 cara/);
  });
});
