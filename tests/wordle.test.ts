import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { closeDatabase, initDatabase } from "../src/lib/db.js";
import { getXp } from "../src/lib/xp-storage.js";
import { createTestBot } from "./helpers.js";
import { registerWordle } from "../src/handlers/wordle.js";
import { findCommand } from "../src/platform/whatsapp/commands/index.js";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";
import { isValidWordleGuess, jakartaDayKey, normalizeWordleGuess, scoreWordleGuess, WORDLE_MAX_GUESSES } from "../src/lib/wordle.js";
import { awardWordleWin, getWordleSession, getWordleStats, recordWordleGuess, startWordleSession } from "../src/lib/wordle-storage.js";
import { WORDLE_WORDS } from "../src/lib/wordle-words.js";
import { formatCommandHelp } from "../src/lib/command-help.js";

const ENV = ["EVERYONE", "DEFAULT_QUOTA", "RATE_LIMIT", "RATE_WINDOW_SECONDS", "COMMAND_PREFIX"] as const;
let previous: Record<string, string | undefined> = {};

function waMessage(text: string, sent: string[] = []): IncomingMessage {
  const sock = {
    sendMessage: async (_chatId: string, payload: { text?: string }) => {
      if (payload.text) sent.push(payload.text);
      return {};
    },
    groupMetadata: async () => ({ participants: [] }),
  } as unknown as IncomingMessage["sock"];
  return {
    sock, chatId: "chat-1", isGroup: false, senderJid: "62855@s.whatsapp.net",
    senderAlt: null, userId: "62855", phone: "62855", name: "Tester", text,
    message: { key: { id: "wordle-test" } } as IncomingMessage["message"], quoted: null,
  };
}

describe("Wordle", () => {
  beforeEach(() => {
    previous = {};
    for (const key of ENV) previous[key] = process.env[key];
    process.env.EVERYONE = "true";
    process.env.DEFAULT_QUOTA = "25";
    process.env.RATE_LIMIT = "20";
    process.env.RATE_WINDOW_SECONDS = "60";
    process.env.COMMAND_PREFIX = ".";
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
    for (const key of ENV) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key]!;
    }
  });

  it("keeps a curated five-letter Indonesian word list", () => {
    assert.ok(WORDLE_WORDS.length > 100);
    assert.ok(WORDLE_WORDS.every((word) => /^[a-z]{5}$/.test(word)));
    assert.ok(isValidWordleGuess("acara"));
    assert.equal(isValidWordleGuess("zzzzz"), false);
  });

  it("documents Wordle with each platform's command prefix", () => {
    assert.match(formatCommandHelp("wordle", "telegram"), /Cara pakai: \/wordle/);
    assert.match(formatCommandHelp("wordle", "whatsapp", "."), /Cara pakai: \.wordle/);
    assert.match(formatCommandHelp("wordle", "whatsapp", "."), /enam kesempatan/);
  });

  it("normalizes guesses and scores duplicate letters using remaining counts", () => {
    assert.equal(normalizeWordleGuess("  ACARA "), "acara");
    assert.equal(normalizeWordleGuess("empat"), "empat");
    assert.equal(normalizeWordleGuess("satu"), null);
    assert.deepEqual(scoreWordleGuess("kakak", "akaka"), ["present", "present", "present", "present", "absent"]);
    assert.deepEqual(scoreWordleGuess("kakak", "kkkak"), ["correct", "absent", "correct", "correct", "correct"]);
  });

  it("uses the Jakarta calendar day for the daily reward key", () => {
    assert.equal(jakartaDayKey(Date.UTC(2025, 0, 1, 16)), "2025-01-01");
    assert.equal(jakartaDayKey(Date.UTC(2025, 0, 1, 17)), "2025-01-02");
    assert.equal(WORDLE_MAX_GUESSES, 6);
  });

  it("stores separate rounds and records a loss after six guesses", () => {
    startWordleSession("telegram", "group-1", "user-1", "acara");
    startWordleSession("telegram", "group-1", "user-2", "badan");
    startWordleSession("whatsapp", "group-1", "user-1", "badan");
    assert.deepEqual(getWordleSession("telegram", "group-1", "user-1"), { solution: "acara", guesses: [] });
    assert.deepEqual(getWordleSession("telegram", "group-1", "user-2"), { solution: "badan", guesses: [] });
    assert.deepEqual(getWordleSession("whatsapp", "group-1", "user-1"), { solution: "badan", guesses: [] });

    let result = null;
    for (let attempt = 0; attempt < WORDLE_MAX_GUESSES; attempt += 1) {
      result = recordWordleGuess("telegram", "group-1", "user-1", "zombi");
    }
    assert.equal(result?.finished, true);
    assert.equal(result?.won, false);
    assert.equal(getWordleSession("telegram", "group-1", "user-1"), null);
    assert.deepEqual(getWordleStats("telegram", "group-1", "user-1"), { games: 1, wins: 0 });
  });

  it("awards 25 XP once per platform user per Jakarta day", async () => {
    const at = Date.UTC(2025, 0, 1, 16);
    assert.equal(await awardWordleWin({ platform: "telegram", chatId: "group-1", userId: "user-1", displayName: "Rani", at }), true);
    assert.equal(await awardWordleWin({ platform: "telegram", chatId: "group-2", userId: "user-1", displayName: "Rani", at }), false);
    assert.equal(await getXp("telegram", "group-1", "user-1"), 25);
    assert.equal(await awardWordleWin({ platform: "telegram", chatId: "group-2", userId: "user-1", displayName: "Rani", at: at + 8 * 60 * 60 * 1000 }), true);
    assert.equal(await awardWordleWin({ platform: "whatsapp", chatId: "group-1", userId: "user-1", displayName: "Rani", at }), true);
  });

  it("starts Telegram rounds without command XP and awards XP on a win", async () => {
    const t = createTestBot();
    registerWordle(t.bot);
    await t.bot.handleUpdate(t.textUpdate("/wordle", { fromId: 778 }));
    const session = getWordleSession("telegram", "111", "778");
    assert.ok(session);
    assert.equal(await getXp("telegram", "111", "778"), 0);
    await t.bot.handleUpdate(t.textUpdate(session.solution, { fromId: 778, hasCommand: false }));
    assert.equal(await getXp("telegram", "111", "778"), 25);
    assert.match(t.replies().at(-1) ?? "", /Kamu menang/);
    assert.match(t.replies().at(-1) ?? "", /Statistik: 1 permainan, 1 menang \(100%\)/);
  });

  it("registers WhatsApp Wordle and accepts a plain-text winning guess", async () => {
    const command = findCommand("wordle");
    assert.equal(command?.free, true);
    assert.equal(command?.awardXp, false);
    const replies: string[] = [];
    await handleIncoming(waMessage(".wordle", replies));
    const session = getWordleSession("whatsapp", "chat-1", "62855");
    assert.ok(session);
    assert.equal(await getXp("whatsapp", "chat-1", "62855"), 0);
    await handleIncoming(waMessage(session.solution, replies));
    assert.equal(await getXp("whatsapp", "chat-1", "62855"), 25);
    assert.ok(replies.some((reply) => reply.includes("Kamu menang")));
  });
});
