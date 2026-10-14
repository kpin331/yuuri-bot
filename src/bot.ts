import { Bot, GrammyError, HttpError } from "grammy";
import { registerCommands } from "./handlers/commands.js";
import { registerDownloader } from "./handlers/download.js";
import { registerEcho } from "./handlers/echo.js";
import { registerSticker } from "./handlers/sticker.js";

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

  registerCommands(bot);
  registerSticker(bot);
  registerDownloader(bot);
  registerEcho(bot);

  return bot;
}
