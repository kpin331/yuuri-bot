import { Bot, GrammyError, HttpError } from "grammy";
import { registerBan, registerBanGuard } from "./handlers/ban.js";
import { registerCommandControl } from "./handlers/commandcontrol.js";
import { registerCommands } from "./handlers/commands.js";
import { registerDatabase } from "./handlers/database.js";
import { registerDownloader } from "./handlers/download.js";
import { registerFallback } from "./handlers/fallback.js";
import { registerPinterest } from "./handlers/pinterest.js";
import { registerPixiv } from "./handlers/pixiv.js";
import { registerPlay } from "./handlers/play.js";
import { registerQuotaReset } from "./handlers/quotareset.js";
import { registerSticker } from "./handlers/sticker.js";
import { registerSys } from "./handlers/sys.js";
import { registerToimg } from "./handlers/toimg.js";
import { registerTracking } from "./handlers/tracking.js";
import { registerUserinfo } from "./handlers/userinfo.js";
import { isAuthorized, isEveryoneAllowed } from "./lib/config.js";

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Error in request:", e.description);
    } else if (e instanceof HttpError) {
      // Log the message only: the underlying error can contain the request URL,
      // which embeds the bot token.
      console.error("Could not contact Telegram:", e.message);
    } else {
      console.error("Unknown error:", e instanceof Error ? e.message : e);
    }
  });

  bot.use(async (ctx, next) => {
    if (isEveryoneAllowed()) return next();
    if (isAuthorized(ctx.from?.id)) return next();

    if (ctx.chat) {
      await ctx
        .reply("🚫 This bot is private. Only the owner can use it.")
        .catch(() => undefined);
    }
  });

  registerBanGuard(bot);
  registerTracking(bot);
  registerCommands(bot);
  registerSticker(bot);
  registerPinterest(bot);
  registerPixiv(bot);
  registerDownloader(bot);
  registerPlay(bot);
  registerToimg(bot);
  registerUserinfo(bot);
  registerBan(bot);
  registerCommandControl(bot);
  registerSys(bot);
  registerQuotaReset(bot);
  registerDatabase(bot);
  registerFallback(bot);

  return bot;
}
