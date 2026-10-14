import { Bot, GrammyError, HttpError } from "grammy";
import { registerCommands } from "./handlers/commands.js";
import { registerDownloader } from "./handlers/download.js";
import { registerFallback } from "./handlers/fallback.js";
import { registerPinterest } from "./handlers/pinterest.js";
import { registerPixiv } from "./handlers/pixiv.js";
import { registerPlay } from "./handlers/play.js";
import { registerSticker } from "./handlers/sticker.js";
import { registerSys } from "./handlers/sys.js";
import { registerToimg } from "./handlers/toimg.js";
import { registerTracking } from "./handlers/tracking.js";
import { registerUserinfo } from "./handlers/userinfo.js";
import { getOwnerId, isEveryoneAllowed } from "./lib/config.js";

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Error in request:", e.description);
    } else if (e instanceof HttpError) {
      console.error("Could not contact Telegram:", e);
    } else {
      console.error("Unknown error:", e);
    }
  });

  bot.use(async (ctx, next) => {
    if (isEveryoneAllowed()) return next();

    const ownerId = getOwnerId();
    if (ownerId === null || ctx.from?.id === ownerId) return next();

    if (ctx.chat) {
      await ctx
        .reply("🚫 This bot is private. Only the owner can use it.")
        .catch(() => undefined);
    }
  });

  registerTracking(bot);
  registerCommands(bot);
  registerSticker(bot);
  registerPinterest(bot);
  registerPixiv(bot);
  registerDownloader(bot);
  registerPlay(bot);
  registerToimg(bot);
  registerUserinfo(bot);
  registerSys(bot);
  registerFallback(bot);

  return bot;
}
