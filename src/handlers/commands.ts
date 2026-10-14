import type { Bot } from "grammy";

export function registerCommands(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const name = ctx.from?.first_name ?? "there";
    await ctx.reply(
      `Hi ${name}! I'm a starter bot. Send me any text and I'll echo it back.\n\nUse /help to see what I can do.`,
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Available commands:",
        "/start - Greet me",
        "/help - Show this message",
        "",
        "Stickers:",
        "/s - Reply to an image or video to turn it into a sticker",
        "",
        "Downloaders:",
        "/dl <link> - Download media from any supported link",
        "/ig <link> - Download from Instagram",
        "/x <link> - Download from X (Twitter)",
        "/fb <link> - Download from Facebook",
        "",
        "Or just send text and I'll echo it back.",
      ].join("\n"),
    );
  });
}
