import { getCommandPrefix } from "../../../lib/config.js";
import { formatInfo, parseInfo } from "../../../lib/info.js";
import { bestImageUrl, buildSearchUrl, searchPins } from "../../../lib/pinterest.js";
import { htmlToWhatsApp } from "../../../lib/text.js";
import { extractText } from "../message.js";
import { replyTo, sendImage, sendText } from "../reply.js";
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

    await sendText(reply, "Sedang mencari di Pinterest…");
    try {
      const pins = await searchPins(buildSearchUrl(query));
      if (pins.length === 0) {
        await sendText(reply, "Gambar Pinterest tidak ditemukan untuk kata kunci tersebut.");
        return;
      }

      const pin = pins[0]!;
      const imageUrl = bestImageUrl(pin);
      if (!imageUrl) {
        await sendText(reply, "Pin ditemukan, tetapi gambarnya tidak dapat diunduh.");
        return;
      }

      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Gagal mengunduh gambar (status ${response.status})`);
      const buffer = Buffer.from(await response.arrayBuffer());

      const pinId = typeof pin.id === "string" ? pin.id : undefined;
      const info = parseInfo(pin);
      const caption = formatInfo({
        ...info,
        source: pinId ? `https://www.pinterest.com/pin/${pinId}/` : info.source,
      });

      await sendImage(reply, buffer, caption ? htmlToWhatsApp(caption) : undefined);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendText(reply, `Pencarian Pinterest gagal: ${reason}`);
    }
  },
};
