import { join } from "node:path";
import { InputFile, type Bot, type Context } from "grammy";
import type { Message } from "grammy/types";
import { registerCommand } from "../lib/command.js";
import { exec } from "../lib/exec.js";
import { downloadTelegramFile } from "../lib/media.js";
import { makeTempDir, removeDir } from "../lib/temp.js";
import { TOOLS } from "../lib/tools.js";

type StickerKind = "static" | "video" | "animated";

interface StickerSource {
  kind: StickerKind;
  fileId?: string;
}

function resolveSticker(message: Message): StickerSource | null {
  const sticker = message.sticker;
  if (!sticker) return null;
  if (sticker.is_animated) return { kind: "animated" };
  if (sticker.is_video) return { kind: "video", fileId: sticker.file_id };
  return { kind: "static", fileId: sticker.file_id };
}

async function toPng(input: string, output: string): Promise<void> {
  const { code, stderr } = await exec(TOOLS.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-frames:v",
    "1",
    output,
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg failed to convert the sticker: ${stderr.trim()}`);
  }
}

export function registerToimg(bot: Bot): void {
  registerCommand(bot, "toimg", async (ctx: Context) => {
    const message = ctx.message;
    if (!message) return;

    const candidate = message.reply_to_message ?? message;
    const source = resolveSticker(candidate);

    if (!source) {
      await ctx.reply("Reply to a sticker with /toimg to convert it into a PNG image.");
      return;
    }

    if (source.kind === "animated" || !source.fileId) {
      await ctx.reply(
        "Animated stickers (.tgs) can't be converted. Only static and video stickers are supported.",
      );
      return;
    }

    const dir = await makeTempDir("toimg");
    try {
      await ctx.replyWithChatAction("upload_photo");

      const ext = source.kind === "video" ? ".webm" : ".webp";
      const input = join(dir, `input${ext}`);
      const output = join(dir, "sticker.png");

      await downloadTelegramFile(bot, source.fileId, input);
      await toPng(input, output);

      await ctx.replyWithDocument(new InputFile(output, "sticker.png"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Could not convert the sticker: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  });
}
