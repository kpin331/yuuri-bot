import type { Bot, Context } from "grammy";

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
