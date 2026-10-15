import { Bot } from "grammy";
import type { Update } from "grammy/types";

export interface CapturedCall {
  method: string;
  body: Record<string, unknown>;
}

export interface TextUpdateOptions {
  chatId?: number;
  fromId?: number;
  firstName?: string;
  isBot?: boolean;
  username?: string;
  chatType?: string;
  replyTo?: Update["message"];
  hasCommand?: boolean;
}

export function createTestBot(results?: Record<string, unknown>) {
  // Keep the access middleware open so non-owner test updates reach handlers.
  process.env.EVERYONE = "true";

  const calls: CapturedCall[] = [];
  let updateId = 1000;
  let messageId = 1;

  const botInfo = {
    id: 999000,
    is_bot: true,
    first_name: "TestBot",
    username: "test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
  };

  const fetchFn = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as { url?: string }).url ?? input);
    const method = url.split("/").pop() ?? "unknown";

    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        // ignore non-JSON bodies
      }
    }
    calls.push({ method, body });

    const result = results && method in results ? results[method] : {};

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const bot = new Bot("123456:TEST", { botInfo, client: { fetch: fetchFn } });

  function textUpdate(text: string, opts: TextUpdateOptions = {}): Update {
    const chatId = opts.chatId ?? 111;
    const fromId = opts.fromId ?? 222;
    const commandWord = text.trimStart().split(/[\s]/)[0] ?? "";
    const isCommand = opts.hasCommand ?? text.trimStart().startsWith("/");

    const message = {
      message_id: messageId++,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: opts.chatType ?? "private", first_name: opts.firstName ?? "User" },
      from: {
        id: fromId,
        is_bot: opts.isBot ?? false,
        first_name: opts.firstName ?? "User",
        username: opts.username,
      },
      text,
      entities: isCommand
        ? [{ type: "bot_command" as const, offset: 0, length: commandWord.length }]
        : undefined,
      reply_to_message: opts.replyTo,
    } as Update["message"];

    return { update_id: updateId++, message } as Update;
  }

  function messages(): CapturedCall[] {
    return calls.filter((call) => call.method === "sendMessage" || call.method === "sendDocument");
  }

  function replies(): string[] {
    return messages().map((call) => String(call.body.text ?? call.body.caption ?? ""));
  }

  return { bot, calls, textUpdate, messages, replies };
}
