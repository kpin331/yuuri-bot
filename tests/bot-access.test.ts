import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { Update } from "grammy/types";
import { createBot } from "../src/bot.js";

const KEYS = ["OWNER_ID", "ADMIN_IDS", "EVERYONE"] as const;

let saved: Record<string, string | undefined> = {};
let updateId = 10_000;

const BOT_INFO = {
  id: 999000,
  is_bot: true,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

function setEnv(key: (typeof KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function messageUpdate(fromId: number, text: string): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: fromId, type: "private" },
      from: { id: fromId, is_bot: false, first_name: "User" },
      text,
      entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }],
    },
  } as Update;
}

// Installs a stubbed Telegram API so no request leaves the process, and returns
// the list of sendMessage texts the bot produced.
function instrument(bot: ReturnType<typeof createBot>): string[] {
  const sent: string[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "getMe") {
      return Promise.resolve({ ok: true, result: BOT_INFO }) as never;
    }
    if (method === "sendMessage") {
      sent.push(String((payload as { text?: string }).text ?? ""));
    }
    return Promise.resolve({ ok: true, result: {} }) as never;
  });
  return sent;
}

async function run(fromId: number): Promise<string[]> {
  const bot = createBot("123456:TEST");
  const sent = instrument(bot);
  await bot.init();
  await bot.handleUpdate(messageUpdate(fromId, "/start"));
  return sent;
}

const PRIVATE = "This bot is private";

describe("telegram access gate", () => {
  beforeEach(() => {
    saved = {};
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) setEnv(key, saved[key]);
  });

  it("fails closed when private mode is on but no owner or admin is configured", async () => {
    // EVERYONE unset (private), OWNER_ID and ADMIN_IDS unset.
    const sent = await run(555);
    assert.ok(sent.some((line) => line.includes(PRIVATE)));
    assert.ok(!sent.some((line) => line.includes("Unknown command")));
  });

  it("still lets configured admins through when no owner is set", async () => {
    process.env.ADMIN_IDS = "555";
    const sent = await run(555);
    assert.ok(!sent.some((line) => line.includes(PRIVATE)));
  });

  it("blocks non-owners when an owner is set and everyone is off", async () => {
    process.env.OWNER_ID = "222";
    const sent = await run(555);
    assert.ok(sent.some((line) => line.includes(PRIVATE)));
  });

  it("lets anyone in when EVERYONE is on", async () => {
    process.env.EVERYONE = "true";
    const sent = await run(555);
    assert.ok(!sent.some((line) => line.includes(PRIVATE)));
  });
});
