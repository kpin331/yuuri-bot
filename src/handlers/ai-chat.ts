import type { Bot } from "grammy";
import { checkRateLimit, consumeQuota, getQuota } from "../core/access.js";
import { formatWait } from "../core/time.js";
import { isAdmin, isOwner } from "../lib/config.js";
import { generateGeminiReply, geminiChatErrorMessage } from "../lib/gemini-chat.js";

export function registerAiChat(bot: Bot): void {
  bot.on("message:text", async (ctx, next) => {
    const chat = ctx.chat;
    const user = ctx.from;
    const text = ctx.message.text.trim();
    if (!chat || !user || !text) return next();
    if (/^[/!$]/.test(text)) return next();

    let prompt = text;
    if (chat.type === "group" || chat.type === "supergroup") {
      const username = ctx.me.username?.toLowerCase();
      const matches = (ctx.message.entities ?? []).filter((entity) =>
        (entity.type === "mention" && username !== undefined &&
          text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === `@${username}`) ||
        (entity.type === "text_mention" && entity.user.id === ctx.me.id),
      );
      if (matches.length === 0) return next();
      for (const entity of [...matches].sort((left, right) => right.offset - left.offset)) {
        prompt = `${prompt.slice(0, entity.offset)}${prompt.slice(entity.offset + entity.length)}`;
      }
      prompt = prompt.trim();
      if (!prompt) return next();
    } else if (chat.type !== "private") {
      return next();
    }

    const userId = String(user.id);
    const role = isOwner(user.id) ? "owner" : isAdmin(user.id) ? "admin" : "member";
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

    try {
      const answer = await generateGeminiReply("telegram", userId, prompt, String(chat.id), role === "owner");
      if (!quota.unlimited) consumeQuota("telegram", userId);
      await ctx.reply(answer);
    } catch (error) {
      await ctx.reply(geminiChatErrorMessage(error));
    }
  });
}
