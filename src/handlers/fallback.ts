import type { Bot } from "grammy";

const COMMAND_PATTERN = /^\/[A-Za-z0-9_]+/;

// Runs last, after every real command handler. It only reacts to text that
// looks like an (unrecognised) bot command, and never echoes normal messages.
export function registerFallback(bot: Bot): void {
  bot.on("message", async (ctx) => {
    const message = ctx.message;
    const text = message.text ?? message.caption;
    if (text === undefined) return;

    if (!COMMAND_PATTERN.test(text.trimStart())) return;

    await ctx.reply("Unknown command.").catch(() => undefined);
  });
}
