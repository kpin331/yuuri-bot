import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InputFile, type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { getPixivRefreshToken } from "../lib/config.js";
import { formatInfo } from "../lib/info.js";
import { downloadIllust, searchIllust } from "../lib/pixiv.js";
import { makeTempDir, removeDir } from "../lib/temp.js";

function usage(): string {
  return "Usage: /pixiv <search query>";
}

async function handlePixiv(ctx: Context): Promise<void> {
  const query = typeof ctx.match === "string" ? ctx.match.trim() : "";
  if (!query) {
    await ctx.reply(usage());
    return;
  }

  const refreshToken = getPixivRefreshToken();
  if (!refreshToken) {
    await ctx.reply("Pixiv is not configured. Set PIXIV_REFRESH_TOKEN in .env.");
    return;
  }

  const status = await ctx.reply("Searching Pixiv…");
  const dir = await makeTempDir("pixiv");

  try {
    await ctx.replyWithChatAction("upload_photo");

    const illust = await searchIllust(refreshToken, query);
    if (!illust) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        "No Pixiv illustration found for that query.",
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
    await ctx.replyWithPhoto(new InputFile(path), caption ? { caption, parse_mode: "HTML" } : {});
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await ctx.api
      .editMessageText(status.chat.id, status.message_id, `Pixiv search failed: ${reason}`)
      .catch(() => undefined);
  } finally {
    await removeDir(dir);
  }
}

export function registerPixiv(bot: Bot): void {
  registerCommand(bot, "pixiv", handlePixiv);
}
