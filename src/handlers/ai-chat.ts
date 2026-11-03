import type { Bot, Context } from "grammy";
import { checkRateLimit, consumeQuota, getQuota } from "../core/access.js";
import { formatWait } from "../core/time.js";
import { isAdmin, isOwner } from "../lib/config.js";
import { isCommandEnabled } from "../lib/db.js";
import { registerKnownCommand } from "../lib/command.js";
import { getStickerForName, getStickerOptions, findCatalogSticker, consumeStickerExplanation, requestStickerExplanation } from "../lib/sticker-catalog.js";
import { generateGeminiReply, geminiChatErrorMessage, type GeminiImage } from "../lib/gemini-chat.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function runAiReply(
  ctx: Context,
  userId: string,
  chatId: string,
  role: "owner" | "admin" | "member",
  prompt: string,
  userName = "",
  image?: GeminiImage,
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
      userName || user.first_name,
      image,
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
  const entities = ctx.message && "caption_entities" in ctx.message && ctx.message.caption
    ? ctx.message.caption_entities ?? []
    : ctx.message && "entities" in ctx.message
      ? ctx.message.entities ?? []
      : [];
  const matches = entities.filter((entity) =>
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
  registerKnownCommand("ai");

  bot.on("message:text", async (ctx, next) => {
    const chat = ctx.chat;
    const user = ctx.from;
    const text = ctx.message.text.trim();
    if (!chat || !user || !text) return next();
    if (!isCommandEnabled("ai")) return next();
    if (/^[/!$]/.test(text)) return next();

    let prompt = text;
    if (chat.type === "group" || chat.type === "supergroup") {
      const mentionedPrompt = promptForBotMention(ctx, text);
      if (!mentionedPrompt) return next();
      prompt = mentionedPrompt;
    } else if (chat.type !== "private") {
      return next();
    }

    await runAiReply(ctx, String(user.id), String(chat.id), currentRole(user.id), prompt, user.first_name);
  });

  bot.on("message:photo", async (ctx, next) => {
    const chat = ctx.chat;
    const user = ctx.from;
    const photo = ctx.message.photo.at(-1);
    if (!chat || !user || !photo) return next();
    if (!isCommandEnabled("ai")) return next();
    if (chat.type !== "private" && chat.type !== "group" && chat.type !== "supergroup") return next();

    let prompt = ctx.message.caption?.trim() ?? "";
    if (chat.type === "group" || chat.type === "supergroup") {
      const mentionedPrompt = promptForBotMention(ctx, prompt);
      if (!mentionedPrompt) return next();
      prompt = mentionedPrompt;
    }
    if (!prompt) prompt = "Lihat gambar yang kukirim dan tanggapi secara alami.";

    try {
      const file = await ctx.api.getFile(photo.file_id);
      if (file.file_size && file.file_size > MAX_IMAGE_BYTES) {
        await ctx.reply("Gambarnya terlalu besar untuk Mommy lihat. Coba kirim gambar yang lebih kecil, ya?");
        return;
      }
      if (!file.file_path) throw new Error("Telegram file path missing");
      const imageResponse = await fetch(`https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`);
      if (!imageResponse.ok) throw new Error(`Telegram image download failed: ${imageResponse.status}`);
      const imageData = new Uint8Array(await imageResponse.arrayBuffer());
      if (imageData.byteLength > MAX_IMAGE_BYTES) {
        await ctx.reply("Gambarnya terlalu besar untuk Mommy lihat. Coba kirim gambar yang lebih kecil, ya?");
        return;
      }
      await runAiReply(
        ctx,
        String(user.id),
        String(chat.id),
        currentRole(user.id),
        prompt,
        user.first_name,
        { mimeType: "image/jpeg", data: imageData },
      );
    } catch (error) {
      console.error("Gagal mengunduh gambar Telegram untuk AI:", error);
      await ctx.reply("Mommy gagal membuka gambarnya. Coba kirim ulang, ya?");
    }
  });

  bot.on("message:sticker", async (ctx, next) => {
    const chat = ctx.chat;
    const user = ctx.from;
    const sticker = ctx.message.sticker;
    if (!chat || chat.type !== "private" || !user) return next();
    if (!isCommandEnabled("ai")) return next();

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
