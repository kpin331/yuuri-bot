import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, getStickerCatalogEntry, initDatabase, listStickerCatalog, removeStickerCatalogEntry, saveStickerCatalogEntry } from "../src/lib/db.js";
import { consumeStickerExplanation, parseStickerLabel, requestStickerExplanation } from "../src/lib/sticker-catalog.js";
import { registerStickerCatalog } from "../src/handlers/sticker-catalog.js";
import { findCommand } from "../src/platform/whatsapp/commands/index.js";
import { createTestBot } from "./helpers.js";

const originalOwner = process.env.OWNER_ID;

describe("sticker catalog storage", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
    if (originalOwner === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = originalOwner;
  });

  it("parses a name and description with the first separator", () => {
    assert.deepEqual(parseStickerLabel("malu | Yuuri tersipu | pura-pura kesal"), {
      name: "malu",
      description: "Yuuri tersipu | pura-pura kesal",
    });
    assert.equal(parseStickerLabel("nama saja"), null);
    assert.equal(parseStickerLabel(" | deskripsi"), null);
    assert.equal(parseStickerLabel("a".repeat(41) + " | deskripsi"), null);
    assert.equal(parseStickerLabel("nama | " + "a".repeat(241)), null);
  });

  it("stores per-platform sticker assets and rejects duplicate names per platform", () => {
    assert.equal(saveStickerCatalogEntry({
      platform: "telegram",
      stickerId: "telegram-id",
      name: "malu",
      description: "Tersipu dan pura-pura kesal",
      telegramFileId: "telegram-file-id",
      stickerData: null,
    }), true);
    assert.equal(saveStickerCatalogEntry({
      platform: "whatsapp",
      stickerId: "whatsapp-id",
      name: "malu",
      description: "Tersipu dan pura-pura kesal",
      telegramFileId: null,
      stickerData: new Uint8Array([1, 2, 3]),
    }), true);
    assert.equal(saveStickerCatalogEntry({
      platform: "telegram",
      stickerId: "other-id",
      name: "MALU",
      description: "Duplikat",
      telegramFileId: "other-file-id",
      stickerData: null,
    }), false);

    assert.equal(getStickerCatalogEntry("telegram", "telegram-id")?.telegramFileId, "telegram-file-id");
    assert.deepEqual(getStickerCatalogEntry("whatsapp", "whatsapp-id")?.stickerData, new Uint8Array([1, 2, 3]));
    assert.equal(listStickerCatalog("telegram").length, 1);
    assert.equal(removeStickerCatalogEntry("malu"), 2);
    assert.equal(listStickerCatalog("whatsapp").length, 0);
  });

  it("uses the explanation for an unknown sticker once and expires it", () => {
    requestStickerExplanation("telegram", "chat-1", "user-1", 1000);
    assert.equal(consumeStickerExplanation("telegram", "chat-1", "user-1", 1001), true);
    assert.equal(consumeStickerExplanation("telegram", "chat-1", "user-1", 1002), false);

    requestStickerExplanation("whatsapp", "chat-2", "user-2", 2000);
    assert.equal(consumeStickerExplanation("whatsapp", "chat-2", "user-2", 602001), false);
  });

  it("registers and removes Telegram stickers with owner-only commands", async () => {
    process.env.OWNER_ID = "222";
    const t = createTestBot();
    registerStickerCatalog(t.bot);
    const sticker = {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 111, type: "private", first_name: "User" },
      from: { id: 111, is_bot: false, first_name: "User" },
      sticker: {
        file_id: "file-id",
        file_unique_id: "unique-id",
        type: "regular",
        width: 512,
        height: 512,
        is_animated: false,
        is_video: false,
      },
    } as never;
    await t.bot.handleUpdate(t.textUpdate("$stickeradd malu | Yuuri tersipu", { fromId: 222, replyTo: sticker }));
    assert.equal(getStickerCatalogEntry("telegram", "unique-id")?.name, "malu");

    await t.bot.handleUpdate(t.textUpdate("$stickeradd nakal | iseng", { fromId: 333, replyTo: sticker }));
    assert.equal(getStickerCatalogEntry("telegram", "unique-id")?.name, "malu");
    assert.ok(t.replies().some((reply) => reply.includes("hanya untuk pemilik")));

    await t.bot.handleUpdate(t.textUpdate("$stickerremove malu", { fromId: 222 }));
    assert.equal(getStickerCatalogEntry("telegram", "unique-id"), null);
    assert.equal(findCommand("stickeradd")?.ownerOnly, true);
    assert.equal(findCommand("stickerremove")?.ownerOnly, true);
  });
});
