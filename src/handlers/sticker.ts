import { extname, join } from "node:path";
import { InputFile, type Bot, type Context } from "grammy";
import type { Message } from "grammy/types";
import { registerCommand } from "../lib/command.js";
import { downloadTelegramFile } from "../lib/media.js";
import { makeStaticSticker, makeVideoSticker } from "../lib/stickers.js";
import { makeTempDir, removeDir } from "../lib/temp.js";

export interface Source {
  fileId: string;
  kind: "image" | "video";
  ext: string;
}

export function extractSource(message: Message): Source | null {
  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1];
    if (largest) return { fileId: largest.file_id, kind: "image", ext: ".jpg" };
  }
  if (message.video) {
    return { fileId: message.video.file_id, kind: "video", ext: ".mp4" };
  }
  if (message.animation) {
    return { fileId: message.animation.file_id, kind: "video", ext: ".mp4" };
  }
  if (message.video_note) {
    return { fileId: message.video_note.file_id, kind: "video", ext: ".mp4" };
  }
  if (message.sticker) {
    return message.sticker.is_video
      ? { fileId: message.sticker.file_id, kind: "video", ext: ".webm" }
      : { fileId: message.sticker.file_id, kind: "image", ext: ".webp" };
  }
  if (message.document) {
    const mime = message.document.mime_type ?? "";
    const name = message.document.file_name ?? "";
    const ext = extname(name) || (mime.includes("video") ? ".mp4" : ".jpg");
    if (mime.startsWith("video/")) {
      return { fileId: message.document.file_id, kind: "video", ext };
    }
    if (mime.startsWith("image/")) {
      return { fileId: message.document.file_id, kind: "image", ext };
    }
  }
  return null;
}

export function registerSticker(bot: Bot): void {
  registerCommand(bot, "s", async (ctx: Context) => {
    const message = ctx.message;
    if (!message) return;

    const candidate = message.reply_to_message ?? message;
    const source = extractSource(candidate);

    if (!source) {
      await ctx.reply(
        "Reply to an image or video with /s, or send a media file with /s as its caption.",
      );
      return;
    }

    const dir = await makeTempDir("sticker");
    try {
      await ctx.replyWithChatAction("choose_sticker");

      const input = join(dir, `input${source.ext}`);
      const output = join(dir, source.kind === "image" ? "sticker.webp" : "sticker.webm");

      await downloadTelegramFile(bot, source.fileId, input);

      if (source.kind === "image") {
        await makeStaticSticker(input, output);
      } else {
        await makeVideoSticker(input, output);
      }

      await ctx.replyWithSticker(new InputFile(output));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Could not create a sticker: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  });
}
