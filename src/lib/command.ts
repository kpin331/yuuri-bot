import type { Bot, Context } from "grammy";
import { isOwner } from "./config.js";

type CommandHandler = (ctx: Context) => Promise<void> | void;

const patternCache = new Map<string, RegExp>();

function commandPattern(name: string): RegExp {
  const cached = patternCache.get(name);
  if (cached) return cached;
  const pattern = new RegExp(`^/${name}(?:@([A-Za-z0-9_]+))?(?:\\s+([\\s\\S]*))?$`, "i");
  patternCache.set(name, pattern);
  return pattern;
}

// grammY's built-in `command` only matches `entities`, so commands sent as a
// media caption (which Telegram reports in `caption_entities`) never fire.
// This registers a message handler that accepts both.
export function registerCommand(bot: Bot, name: string, handler: CommandHandler): void {
  const pattern = commandPattern(name);

  bot.on("message", async (ctx, next) => {
    const message = ctx.message;
    const text = message.text ?? message.caption;
    if (text === undefined) return next();

    const entities = message.entities ?? message.caption_entities;
    const isCommand = entities?.some((e) => e.type === "bot_command" && e.offset === 0);
    if (!isCommand) return next();

    const match = pattern.exec(text);
    if (!match) return next();

    const target = match[1];
    if (target && target.toLowerCase() !== (ctx.me.username ?? "").toLowerCase()) return next();

    ctx.match = (match[2] ?? "").trimStart();
    await handler(ctx);
  });
}

// Commands beginning with `$` are not Telegram commands (no bot_command
// entity), so they are matched against plain text/caption and are
// owner-exclusive regardless of the EVERYONE switch.
export function registerOwnerCommand(bot: Bot, name: string, handler: CommandHandler): void {
  const pattern = new RegExp(`^\\$${name}(?:\\s+([\\s\\S]*))?$`, "i");

  bot.on("message", async (ctx, next) => {
    const message = ctx.message;
    const text = message.text ?? message.caption;
    if (text === undefined) return next();

    const match = pattern.exec(text.trim());
    if (!match) return next();

    if (!isOwner(ctx.from?.id)) {
      await ctx.reply("🚫 This command is owner-only.").catch(() => undefined);
      return;
    }

    ctx.match = (match[1] ?? "").trimStart();
    await handler(ctx);
  });
}
