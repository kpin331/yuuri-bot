import type { Bot } from "grammy";

export function registerEcho(bot: Bot): void {
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;

    if (text.startsWith("/")) {
      await ctx.reply("Unknown command. Try /help.");
      return;
    }

    await ctx.reply(text);
  });

  bot.on("message", async (ctx) => {
    await ctx.reply("I can only echo text messages for now.");
  });
}
