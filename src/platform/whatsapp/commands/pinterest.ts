import { getCommandPrefix } from "../../../lib/config.js";
import { formatPinterestInfo, parseInfo } from "../../../lib/info.js";
import { buildSearchUrl, downloadPin, searchPins, topPins } from "../../../lib/pinterest.js";
import { htmlToWhatsApp } from "../../../lib/text.js";
import { extractText } from "../message.js";
import { replyTo, sendImageAlbum, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const pinCommand: WaCommand = {
  name: "pin",
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    const quotedText = message.quoted ? extractText(message.quoted) : "";
    const query = args.trim() || quotedText.trim();
    if (!query) {
      await sendText(reply, `Cara pakai: ${getCommandPrefix()}pin <kata kunci atau tautan Pinterest>`);
      return;
    }

    await sendText(reply, "Sedang mencari 4 gambar teratas di Pinterest…");
    try {
      const pins = topPins(await searchPins(buildSearchUrl(query)));
      if (pins.length === 0) {
        await sendText(reply, "Gambar Pinterest tidak ditemukan untuk kata kunci tersebut.");
        return;
      }

      const downloads = await Promise.allSettled(pins.map(downloadPin));
      const images = downloads.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (images.length === 0) throw new Error("Gambar Pinterest teratas gagal diunduh.");

      const album = images.map(({ pin, buffer }, index) => {
        const pinId = typeof pin.id === "string" ? pin.id : undefined;
        const info = parseInfo(pin);
        const caption = formatPinterestInfo({
          ...info,
          source: pinId ? `https://www.pinterest.com/pin/${pinId}/` : info.source,
        });
        return {
          image: buffer,
          caption: htmlToWhatsApp(caption),
          fileName: `pinterest-${pinId ?? index + 1}.jpg`,
        };
      });
      await sendImageAlbum(reply, album);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendText(reply, `Pencarian Pinterest gagal: ${reason}`);
    }
  },
};
