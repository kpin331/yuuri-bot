import { getCommandPrefix, getPixivRefreshToken } from "../../../lib/config.js";
import { formatInfo } from "../../../lib/info.js";
import { downloadIllust, searchIllust } from "../../../lib/pixiv.js";
import { htmlToWhatsApp } from "../../../lib/text.js";
import { replyTo, sendImage, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const pixivCommand: WaCommand = {
  name: "pixiv",
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    const query = args.trim();
    if (!query) {
      await sendText(reply, `Usage: ${getCommandPrefix()}pixiv <search query>`);
      return;
    }

    const refreshToken = getPixivRefreshToken();
    if (!refreshToken) {
      await sendText(reply, "Pixiv is not configured. Set PIXIV_REFRESH_TOKEN in .env.");
      return;
    }

    await sendText(reply, "Searching Pixiv…");
    try {
      const illust = await searchIllust(refreshToken, query);
      if (!illust) {
        await sendText(reply, "No Pixiv illustration found for that query.");
        return;
      }

      const buffer = await downloadIllust(illust.imageUrl);
      const caption = formatInfo({
        title: illust.title,
        author: illust.author,
        date: illust.createDate?.slice(0, 10),
        caption:
          illust.tags.length > 0 ? illust.tags.map((tag) => `#${tag}`).join(" ") : undefined,
        source: illust.pageUrl,
      });

      await sendImage(reply, buffer, caption ? htmlToWhatsApp(caption) : undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendText(reply, `Pixiv search failed: ${reason}`);
    }
  },
};
