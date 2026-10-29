import { InputFile, type Bot } from "grammy";
import { registerCommand } from "../lib/command.js";
import { formatPinterestInfo, parseInfo } from "../lib/info.js";
import { buildSearchUrl, downloadPin, searchPins, topPins } from "../lib/pinterest.js";
import { archiveMediaBuffer } from "../lib/runtime.js";

export function registerPinterest(bot: Bot): void {
  registerCommand(bot, "pin", async (ctx) => {
    const replied = ctx.message?.reply_to_message;
    const query =
      typeof ctx.match === "string" && ctx.match.trim().length > 0
        ? ctx.match.trim()
        : (replied?.text ?? replied?.caption ?? "").trim();

    if (!query) {
      await ctx.reply("Cara pakai: /pin <kata kunci atau tautan Pinterest>");
      return;
    }

    const status = await ctx.reply("Sedang mencari 4 gambar teratas di Pinterest…");
    try {
      await ctx.replyWithChatAction("upload_photo");
      const pins = topPins(await searchPins(buildSearchUrl(query)));
      if (pins.length === 0) {
        await ctx.api.editMessageText(status.chat.id, status.message_id, "Gambar Pinterest tidak ditemukan.");
        return;
      }

      const downloads = await Promise.allSettled(pins.map(downloadPin));
      const images = downloads.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (images.length === 0) throw new Error("Gambar Pinterest teratas gagal diunduh.");

      const media = images.map(({ pin, buffer }, index) => {
        void archiveMediaBuffer(buffer, `pinterest-${index + 1}.jpg`);
        const pinId = typeof pin.id === "string" ? pin.id : undefined;
        const info = parseInfo(pin);
        return {
          type: "photo" as const,
          media: new InputFile(buffer, `pin-${index + 1}.jpg`),
          caption: formatPinterestInfo({
            ...info,
            source: pinId ? `https://www.pinterest.com/pin/${pinId}/` : info.source,
          }),
          parse_mode: "HTML" as const,
        };
      });

      await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
      if (media.length === 1) {
        const first = media[0]!;
        await ctx.replyWithPhoto(first.media, { caption: first.caption, parse_mode: first.parse_mode });
      } else {
        await ctx.api.sendMediaGroup(status.chat.id, media);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.api
        .editMessageText(status.chat.id, status.message_id, `Pencarian Pinterest gagal: ${reason}`)
        .catch(() => undefined);
    }
  });
}
