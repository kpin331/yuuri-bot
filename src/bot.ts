import { Bot, GrammyError, HttpError } from "grammy";
import { registerBan, registerBanGuard } from "./handlers/ban.js";
import { registerCasino } from "./handlers/casino.js";
import { registerCommandControl } from "./handlers/commandcontrol.js";
import { registerCommandHelp } from "./handlers/commandhelp.js";
import { registerEconomy } from "./handlers/economy.js";
import { registerCommands } from "./handlers/commands.js";
import { registerDatabase } from "./handlers/database.js";
import { registerDelete } from "./handlers/delete.js";
import { registerDownloader } from "./handlers/download.js";
import { registerFallback } from "./handlers/fallback.js";
import { registerPinterest } from "./handlers/pinterest.js";
import { registerPixiv } from "./handlers/pixiv.js";
import { registerPlay } from "./handlers/play.js";
import { registerPurge } from "./handlers/purge.js";
import { registerQr } from "./handlers/qr.js";
import { registerQuotaReset } from "./handlers/quotareset.js";
import { registerQuota } from "./handlers/quota.js";
import { registerRank } from "./handlers/rank.js";
import { registerSmeme } from "./handlers/smeme.js";
import { registerSticker } from "./handlers/sticker.js";
import { registerSys } from "./handlers/sys.js";
import { isBotPaused, isShellResumeCommand, registerShell } from "./platform/shell.js";
import { registerToimg } from "./handlers/toimg.js";
import { registerTracking } from "./handlers/tracking.js";
import { registerUserinfo } from "./handlers/userinfo.js";
import { registerWordle } from "./handlers/wordle.js";
import { registerRoll } from "./handlers/roll.js";
import { registerQuickTools } from "./handlers/quick-tools.js";
import { registerTextTools } from "./handlers/text-tools.js";
import { registerAiChat } from "./handlers/ai-chat.js";
import { registerAiReset } from "./handlers/ai-reset.js";
import { registerPersonalityCommands } from "./handlers/personality.js";
import { registerStickerCatalog } from "./handlers/sticker-catalog.js";
import { registerAdminCommands } from "./platform/admincommands.js";
import { registerBroadcast } from "./handlers/broadcast.js";
import { isAuthorized, isEveryoneAllowed, isOwner, isTelegramGroupAllowed } from "./lib/config.js";
import { writeLog } from "./lib/runtime.js";

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Terjadi kesalahan saat menangani pembaruan ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Kesalahan pada permintaan:", e.description);
    } else if (e instanceof HttpError) {
      // Log the message only: the underlying error can contain the request URL,
      // which embeds the bot token.
      console.error("Tidak dapat menghubungi Telegram:", e.message);
    } else {
      console.error("Kesalahan tidak diketahui:", e instanceof Error ? e.message : e);
    }
  });

  registerBanGuard(bot);

  bot.use(async (ctx, next) => {
    const updateKind = Object.keys(ctx.update).filter((key) => key !== "update_id").join(",") || "unknown";
    const chat = ctx.chat;
    const actor = ctx.from?.id ?? "unknown";
    const group = chat?.type === "group" || chat?.type === "supergroup";
    const commandText = ctx.message?.text ?? ctx.message?.caption ?? "";
    const command = /^\s*(\/[A-Za-z0-9_]+|[$!][A-Za-z0-9_]+)/.exec(commandText)?.[1] ?? "none";
    writeLog(
      "INTERACTION",
      `platform=telegram update=${updateKind} update_id=${ctx.update.update_id} user_id=${actor} phone=not_provided_by_telegram sender_ip=not_exposed_by_platform chat_id=${chat?.id ?? "unknown"} chat_type=${chat?.type ?? "unknown"}${group ? ` group_id=${chat.id} group_title=${"title" in chat ? chat.title : "unknown"}` : ""} command=${command}`,
    );
    const text = ctx.message?.text ?? ctx.message?.caption ?? "";
    if (isBotPaused() && !(isOwner(ctx.from?.id) && isShellResumeCommand(text))) return;
    if (group && !isAuthorized(ctx.from?.id) && !isTelegramGroupAllowed(chat?.id)) return;
    if (isEveryoneAllowed()) return next();
    if (isAuthorized(ctx.from?.id)) return next();

    if (/^!(ping|neoping|groupinfo)$/i.test(text.trim()) && isGroup(ctx.chat?.type)) {
      return next();
    }

    return;
  });

  registerShell(bot);
  registerTracking(bot);
  registerCommands(bot);
  registerCommandHelp(bot);
  registerCasino(bot);
  registerEconomy(bot);
  registerBroadcast(bot);
  registerQuota(bot);
  registerSticker(bot);
  registerSmeme(bot);
  registerPinterest(bot);
  registerPixiv(bot);
  registerDownloader(bot);
  registerPlay(bot);
  registerPurge(bot);
  registerQr(bot);
  registerRank(bot);
  registerToimg(bot);
  registerUserinfo(bot);
  registerWordle(bot);
  registerRoll(bot);
  registerQuickTools(bot);
  registerTextTools(bot);
  registerStickerCatalog(bot);
  registerAiReset(bot);
  registerPersonalityCommands(bot);
  registerAiChat(bot);
  registerBan(bot);
  registerAdminCommands(bot);
  registerCommandControl(bot);
  registerSys(bot);
  registerQuotaReset(bot);
  registerDatabase(bot);
  registerDelete(bot);
  registerFallback(bot);

  return bot;
}

function isGroup(type: string | undefined): boolean {
  return type === "group" || type === "supergroup";
}
