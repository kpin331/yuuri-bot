import type { Bot, Context } from "grammy";
import { getOwnerId, isOwner } from "../lib/config.js";

const TITLE = "Yuuri Bot V1.0✨";
const SUBTITLE = "List command to use";

function buildMenu(): string {
  return [
    `<b>${TITLE}</b>`,
    `<i>${SUBTITLE}</i>`,
    "",
    "<b>General</b>",
    "/start — Show this menu",
    "/menu — Show this menu",
    "/help — Show this menu",
    "/id — Show your Telegram ID",
    "",
    "<b>Stickers</b>",
    "/s — Reply to an image or video to turn it into a sticker",
    "",
    "<b>Downloaders</b>",
    "/dl — Download media from any supported link",
    "/ig — Download from Instagram",
    "/x — Download from X (Twitter)",
    "/fb — Download from Facebook",
  ].join("\n");
}

export function registerCommands(bot: Bot): void {
  const showMenu = async (ctx: Context): Promise<void> => {
    await ctx.reply(buildMenu(), { parse_mode: "HTML" });
  };

  bot.command("start", showMenu);
  bot.command("menu", showMenu);
  bot.command("help", showMenu);

  bot.command("id", async (ctx) => {
    const userId = ctx.from?.id;
    const ownerId = getOwnerId();
    const lines = [`Your Telegram ID: <code>${userId ?? "unknown"}</code>`];

    if (ownerId === null) {
      lines.push("Owner ID is not configured (set OWNER_ID in .env).");
    } else {
      lines.push(`Owner ID: <code>${ownerId}</code>`);
      lines.push(isOwner(userId) ? "You are the owner. ✅" : "You are not the owner.");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
