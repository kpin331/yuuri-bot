import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InputFile, type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { isOwner, getPixivRefreshToken } from "../lib/config.js";
import { formatInfo } from "../lib/info.js";
import { downloadIllust, searchIllust } from "../lib/pixiv.js";
import { makeTempDir, removeDir } from "../lib/temp.js";
import { archiveMediaFile } from "../lib/runtime.js";
import { isPixivNsfwEnabled, isPixivSettingInput, pixivSettingReply } from "../lib/pixiv-settings.js";

function usage(): string {
  return "Cara pakai: /pixiv <kata kunci pencarian> atau !pixiv nsfw true|false";
}

async function handlePixiv(ctx: Context): Promise<void> {
  const raw = typeof ctx.match === "string" ? ctx.match.trim() : "";

  if (isPixivSettingInput(raw)) {
    if (!isOwner(ctx.from?.id)) {
      await ctx.reply("Pengaturan pixiv hanya untuk pemilik bot.").catch(() => undefined);
      return;
    }
    const settingReply = pixivSettingReply(raw);
    if (settingReply !== null) {
      await ctx.reply(settingReply);
      return;
    }
  }

  const query = raw;
  if (!query) {
    await ctx.reply(usage());
    return;
  }

  const refreshToken = getPixivRefreshToken();
  if (!refreshToken) {
    await ctx.reply("Pixiv belum dikonfigurasi. Isi PIXIV_REFRESH_TOKEN di berkas .env.");
    return;
  }

  const status = await ctx.reply("Sedang mencari di Pixiv…");
  const dir = await makeTempDir("pixiv");

  try {
    await ctx.replyWithChatAction("upload_photo");

    const illust = await searchIllust(refreshToken, query, isPixivNsfwEnabled());
    if (!illust) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        "Ilustrasi Pixiv tidak ditemukan.",
      );
      return;
    }

    const buffer = await downloadIllust(illust.imageUrl);
    const path = join(dir, `pixiv_${illust.id}.jpg`);
    await writeFile(path, buffer);

    const caption = formatInfo({
      title: illust.title,
      author: illust.author,
      date: illust.createDate?.slice(0, 10),
      caption: illust.tags.length > 0 ? illust.tags.map((tag) => `#${tag}`).join(" ") : undefined,
      source: illust.pageUrl,
    });

    await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
    await archiveMediaFile(path);
    await ctx.replyWithPhoto(new InputFile(path), caption ? { caption, parse_mode: "HTML" } : {});
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await ctx.api
      .editMessageText(status.chat.id, status.message_id, `Pencarian Pixiv gagal: ${reason}`)
      .catch(() => undefined);
  } finally {
    await removeDir(dir);
  }
}

export function registerPixiv(bot: Bot): void {
  registerCommand(bot, "pixiv", handlePixiv);
  bot.hears(/^!pixiv\s+(nsfw(?:\s.*)?)$/i, async (ctx) => {
    ctx.match = ctx.match[1] ?? "";
    await handlePixiv(ctx);
  });
}
