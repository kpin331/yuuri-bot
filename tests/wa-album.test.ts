import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { sendImageAlbum, type ReplyTarget } from "../src/platform/whatsapp/reply.js";

describe("WhatsApp image albums", () => {
  it("sends one album marker and associates every captioned image with it", async () => {
    const sent: AnyMessageContent[] = [];
    const target = {
      jid: "123@g.us",
      quoted: { key: { id: "incoming" } },
      sock: {
        sendMessage: async (_jid: string, content: AnyMessageContent) => {
          sent.push(content);
          const id = `sent-${sent.length}`;
          return { key: { id } };
        },
      },
    } as unknown as ReplyTarget;

    await sendImageAlbum(target, [
      { image: Buffer.from("one"), caption: "one", fileName: "one.jpg" },
      { image: Buffer.from("two"), caption: "two", fileName: "two.jpg" },
      { image: Buffer.from("three"), caption: "three", fileName: "three.jpg" },
      { image: Buffer.from("four"), caption: "four", fileName: "four.jpg" },
    ]);

    assert.equal(sent.length, 5);
    assert.deepEqual(sent[0], { album: { expectedImageCount: 4 } });
    const parentKey = { id: "sent-1" };
    assert.deepEqual(sent.slice(1).map((content) => "image" in content && content.caption), [
      "one", "two", "three", "four",
    ]);
    assert.ok(sent.slice(1).every((content) =>
      "albumParentKey" in content && JSON.stringify(content.albumParentKey) === JSON.stringify(parentKey),
    ));
  });
});
