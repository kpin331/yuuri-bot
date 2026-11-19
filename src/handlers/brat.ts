import { InlineKeyboard, InputFile, type Bot, type Context } from "grammy";
import {
  BRAT_PROMPT,
  BratSessionStore,
  normalizeBratText,
  parseBratChoice,
  renderBrat,
  type BratFormat,
  type BratSession,
} from "../lib/brat.js";
import { registerCommand } from "../lib/command.js";
import { isCommandEnabled } from "../lib/db.js";
import { makeTempDir, removeDir } from "../lib/temp.js";

const sessions = new BratSessionStore();

function usage(): string {
  return "Cara pakai: /brat <teks>";
}

async function handleCommand(ctx: Context): Promise<void> {
  const text = normalizeBratText(typeof ctx.match === "string" ? ctx.match : "");
  if (!text || ctx.chat === undefined || ctx.from === undefined) {
    await ctx.reply(usage());
    return;
  }

  sessions.create({
    chatId: String(ctx.chat.id),
    userId: String(ctx.from.id),
    text,
  });

  const keyboard = new InlineKeyboard()
    .text("static", "brat:static")
    .text("animated", "brat:animated");
  await ctx.reply(BRAT_PROMPT, { reply_markup: keyboard });
}

async function deliver(
  ctx: Context,
  chatId: number,
  session: BratSession,
  format: BratFormat,
): Promise<void> {
  const dir = await makeTempDir("brat");
  try {
    const path = await renderBrat({ text: session.text, format, workDir: dir });
    if (format === "static") {
      await ctx.api.sendPhoto(chatId, new InputFile(path));
    } else {
      await ctx.api.sendAnimation(chatId, new InputFile(path));
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await ctx.api.sendMessage(chatId, `Gagal membuat brat: ${reason}`).catch(() => undefined);
  } finally {
    await removeDir(dir);
  }
}

async function handleCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const chatId = ctx.callbackQuery?.message?.chat.id;
  const userId = ctx.callbackQuery?.from.id;

  if (chatId === undefined || userId === undefined) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }

  if (!isCommandEnabled("brat")) {
    await ctx
      .answerCallbackQuery({ text: "Perintah ini sedang dinonaktifkan.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  const format = parseBratChoice(data.replace(/^brat:/, ""));
  const session = format ? sessions.get(String(chatId), String(userId)) : null;
  if (!format || !session) {
    await ctx
      .answerCallbackQuery({ text: "Permintaan ini kedaluwarsa. Kirim /brat lagi.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  await ctx.answerCallbackQuery().catch(() => undefined);
  sessions.delete(String(chatId), String(userId));
  await deliver(ctx, chatId, session, format);
}

export function registerBrat(bot: Bot): void {
  registerCommand(bot, "brat", handleCommand);
  bot.callbackQuery(/^brat:/, handleCallback);
  bot.on("message:text", async (ctx, next) => {
    const format = parseBratChoice(ctx.message.text);
    if (!format || ctx.chat === undefined || ctx.from === undefined) return next();

    const chatId = String(ctx.chat.id);
    const userId = String(ctx.from.id);
    const session = sessions.get(chatId, userId);
    if (!session) return next();
    if (!isCommandEnabled("brat")) {
      sessions.delete(chatId, userId);
      await ctx.reply("Perintah ini sedang dinonaktifkan.");
      return;
    }

    sessions.delete(chatId, userId);
    await deliver(ctx, ctx.chat.id, session, format);
  });
}
