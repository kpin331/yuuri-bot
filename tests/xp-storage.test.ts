import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, initDatabase } from "../src/lib/db.js";
import { addXp, getLeaderboard, getXp, isXpStorageReady } from "../src/lib/xp-storage.js";

describe("SQLite XP storage", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => closeDatabase());

  it("stores XP separately for each platform, chat, and user", async () => {
    assert.equal(isXpStorageReady(), true);
    assert.equal(
      await addXp({
        platform: "telegram",
        chatId: "group-1",
        userId: "user-1",
        displayName: "Rani",
        amount: 12,
        at: 1,
      }),
      12,
    );
    assert.equal(
      await addXp({
        platform: "telegram",
        chatId: "group-1",
        userId: "user-1",
        displayName: null,
        amount: 8,
        at: 2,
      }),
      20,
    );
    assert.equal(await getXp("telegram", "group-1", "user-1"), 20);
    assert.equal(await getXp("telegram", "group-2", "user-1"), 0);
    assert.equal(await getXp("whatsapp", "group-1", "user-1"), 0);
  });

  it("orders and limits a chat leaderboard", async () => {
    await addXp({
      platform: "telegram",
      chatId: "group-1",
      userId: "user-1",
      displayName: "Rani",
      amount: 10,
      at: 1,
    });
    await addXp({
      platform: "telegram",
      chatId: "group-1",
      userId: "user-2",
      displayName: "Dika",
      amount: 25,
      at: 2,
    });
    await addXp({
      platform: "telegram",
      chatId: "group-2",
      userId: "user-3",
      displayName: "Ayu",
      amount: 100,
      at: 3,
    });

    assert.deepEqual(await getLeaderboard("telegram", "group-1", 1), [
      { platform: "telegram", chatId: "group-1", userId: "user-2", displayName: "Dika", xp: 25 },
    ]);
  });
});
