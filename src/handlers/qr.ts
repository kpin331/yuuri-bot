import { join } from "node:path";
import { InputFile, type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { downloadTelegramFile } from "../lib/media.js";
import { decodeQr, generateQr } from "../lib/qr.js";
import { makeTempDir, removeDir } from "../lib/temp.js";
import { archiveMediaBuffer } from "../lib/runtime.js";
import { extractSource } from "./sticker.js";

const USAGE =
  "Kirim /qr <teks atau link> untuk membuat QR, atau balas gambar yang berisi QR dengan /qr untuk membacanya.";

export function registerQr(bot: Bot): void {
  registerCommand(bot, "qr", async (ctx: Context) => {
    const raw = typeof ctx.match === "string" ? ctx.match.trim() : "";

    if (raw.length > 0) {
      try {
        const image = await generateQr(raw);
        await archiveMediaBuffer(image, "qr.png");
        await ctx.replyWithPhoto(new InputFile(image, "qr.png"));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await ctx.reply(`QR tidak bisa dibuat: ${reason}`);
      }
      return;
    }

    const message = ctx.message;
    if (!message) return;

    const candidate = message.reply_to_message ?? message;
    const source = extractSource(candidate);
    if (!source) {
      await ctx.reply(USAGE);
      return;
    }

    const dir = await makeTempDir("qr");
    try {
      await ctx.replyWithChatAction("upload_photo");

      const input = join(dir, `input${source.ext}`);
      await downloadTelegramFile(bot, source.fileId, input);

      const decoded = await decodeQr(input);
      if (decoded === null) {
        await ctx.reply(
          "Tidak ada QR yang terbaca di gambar itu. Pastikan QR-nya terlihat jelas dan tidak buram.",
        );
        return;
      }

      await ctx.reply(`Isi QR:\n${decoded}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.reply(`QR tidak bisa dibaca: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  });
}
