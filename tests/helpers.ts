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

export interface CallbackUpdateOptions {
  data: string;
  chatId?: number;
  fromId?: number;
  messageId?: number;
  firstName?: string;
  username?: string;
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

  // sendMessage/sendDocument should return a Message like the real API (export
  // code reads the returned chat), so fill in message_id and chat when missing.
  function buildResult(
    method: string,
    body: Record<string, unknown>,
    configured: unknown,
  ): unknown {
    if (method !== "sendMessage" && method !== "sendDocument") {
      return configured === undefined ? {} : configured;
    }
    const base =
      configured && typeof configured === "object"
        ? { ...(configured as Record<string, unknown>) }
        : {};
    if (base.message_id === undefined) base.message_id = messageId++;
    if (base.chat === undefined) {
      base.chat = { id: Number(body.chat_id ?? 0), type: "private", first_name: "User" };
    }
    return base;
  }

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

    const configured = results && method in results ? results[method] : undefined;
    const result = buildResult(method, body, configured);

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

  function callbackUpdate(opts: CallbackUpdateOptions): Update {
    const chatId = opts.chatId ?? 111;
    const fromId = opts.fromId ?? 222;
    return {
      update_id: updateId++,
      callback_query: {
        id: `cb-${updateId}`,
        from: {
          id: fromId,
          is_bot: false,
          first_name: opts.firstName ?? "User",
          username: opts.username,
        },
        chat_instance: "test-instance",
        data: opts.data,
        message: {
          message_id: opts.messageId ?? 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: "private", first_name: "User" },
          from: { id: 999000, is_bot: true, first_name: "TestBot", username: "test_bot" },
          text: "menu",
        },
      },
    } as Update;
  }

  // Text of every editMessageText call, in order.
  function editedTexts(): string[] {
    return calls
      .filter((call) => call.method === "editMessageText")
      .map((call) => String(call.body.text ?? ""));
  }

  return { bot, calls, textUpdate, callbackUpdate, messages, replies, editedTexts };
}
