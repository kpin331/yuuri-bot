import type { Bot, Context } from "grammy";
import { checkRateLimit, consumeQuota, getQuota } from "../core/access.js";
import { formatWait } from "../core/time.js";
import { isAdmin, isOwner } from "../lib/config.js";
import { getStickerForName, getStickerOptions, findCatalogSticker, consumeStickerExplanation, requestStickerExplanation } from "../lib/sticker-catalog.js";
import { generateGeminiReply, geminiChatErrorMessage } from "../lib/gemini-chat.js";

async function runAiReply(
  ctx: Context,
  userId: string,
  chatId: string,
  role: "owner" | "admin" | "member",
  prompt: string,
): Promise<void> {
  const user = ctx.from;
  if (!user) return;
  const quota = getQuota("telegram", userId, role, user.first_name);
  if (!quota.unlimited && quota.quotaLeft < 1) {
    await ctx.reply(`Kuota harian habis. Diatur ulang dalam ${formatWait(quota.resetInSeconds)}.`);
    return;
  }

  const rate = checkRateLimit("telegram", userId);
  if (!rate.allowed) {
    await ctx.reply(`Terlalu banyak permintaan. Coba lagi dalam ${formatWait(rate.retryAfterSeconds)}.`);
    return;
  }

  const pending = consumeStickerExplanation("telegram", chatId, userId);
  const contextualPrompt = pending
    ? `Konteks: pengguna baru saja menjelaskan arti stiker yang belum dikenal. Gunakan penjelasan ini sekali saja.\nPenjelasan pengguna: ${prompt}`
    : prompt;

  try {
    const options = getStickerOptions("telegram");
    const response = await generateGeminiReply(
      "telegram",
      userId,
      contextualPrompt,
      chatId,
      role === "owner",
      options,
    );
    if (!quota.unlimited) consumeQuota("telegram", userId);
    await ctx.reply(response.text);
    if (response.stickerName) {
      const sticker = getStickerForName("telegram", response.stickerName);
      if (sticker?.telegramFileId) await ctx.replyWithSticker(sticker.telegramFileId).catch(() => undefined);
    }
  } catch (error) {
    await ctx.reply(geminiChatErrorMessage(error));
  }
}

function promptForBotMention(ctx: Context, text: string): string | null {
  const username = ctx.me.username?.toLowerCase();
  const matches = (ctx.message && "entities" in ctx.message ? ctx.message.entities ?? [] : []).filter((entity) =>
    (entity.type === "mention" && username !== undefined &&
      text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === `@${username}`) ||
    (entity.type === "text_mention" && entity.user.id === ctx.me.id),
  );
  if (matches.length === 0) return null;
  let prompt = text;
  for (const entity of [...matches].sort((left, right) => right.offset - left.offset)) {
    prompt = `${prompt.slice(0, entity.offset)}${prompt.slice(entity.offset + entity.length)}`;
  }
  return prompt.trim() || null;
}

function currentRole(userId: number): "owner" | "admin" | "member" {
  return isOwner(userId) ? "owner" : isAdmin(userId) ? "admin" : "member";
}

export function registerAiChat(bot: Bot): void {
  bot.on("message:text", async (ctx, next) => {
    const chat = ctx.chat;
    const user = ctx.from;
    const text = ctx.message.text.trim();
    if (!chat || !user || !text) return next();
    if (/^[/!$]/.test(text)) return next();

    let prompt = text;
    if (chat.type === "group" || chat.type === "supergroup") {
      const mentionedPrompt = promptForBotMention(ctx, text);
      if (!mentionedPrompt) return next();
      prompt = mentionedPrompt;
    } else if (chat.type !== "private") {
      return next();
    }

    await runAiReply(ctx, String(user.id), String(chat.id), currentRole(user.id), prompt);
  });

  bot.on("message:sticker", async (ctx, next) => {
    const chat = ctx.chat;
    const user = ctx.from;
    const sticker = ctx.message.sticker;
    if (!chat || chat.type !== "private" || !user) return next();

    const userId = String(user.id);
    const chatId = String(chat.id);
    const role = currentRole(user.id);
    const entry = findCatalogSticker("telegram", sticker.file_unique_id);
    if (!entry) {
      const rate = checkRateLimit("telegram", userId);
      if (!rate.allowed) {
        await ctx.reply(`Terlalu banyak permintaan. Coba lagi dalam ${formatWait(rate.retryAfterSeconds)}.`);
        return;
      }
      requestStickerExplanation("telegram", chatId, userId);
      await ctx.reply("Stiker ini belum Mommy kenal. Jelasin artinya dong, biar Mommy bisa nanggepin dengan benar?");
      return;
    }

    await runAiReply(
      ctx,
      userId,
      chatId,
      role,
      `Pengguna mengirim stiker bernama “${entry.name}”. Deskripsi: ${entry.description}. Tanggapi makna atau reaksinya secara alami.`,
    );
  });
}
