import { join } from "node:path";
import { InputFile, type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { downloadTelegramFile } from "../lib/media.js";
import { parseMemeText, renderMeme } from "../lib/meme.js";
import { makeStaticSticker, makeVideoSticker } from "../lib/stickers.js";
import { makeTempDir, removeDir } from "../lib/temp.js";
import { extractSource } from "./sticker.js";

const USAGE_MEDIA =
  "Reply to an image or video with /smeme, or send a media file with /smeme as its caption.";
const USAGE_TEXT =
  "Add some text: /smeme top | bottom. With no | the text goes at the bottom.";

export function registerSmeme(bot: Bot): void {
  registerCommand(bot, "smeme", async (ctx: Context) => {
    const message = ctx.message;
    if (!message) return;

    const candidate = message.reply_to_message ?? message;
    const source = extractSource(candidate);

    if (!source) {
      await ctx.reply(USAGE_MEDIA);
      return;
    }

    const raw = typeof ctx.match === "string" ? ctx.match : "";
    const text = parseMemeText(raw);
    if (!text) {
      await ctx.reply(USAGE_TEXT);
      return;
    }

    const dir = await makeTempDir("smeme");
    try {
      await ctx.replyWithChatAction("choose_sticker");

      const input = join(dir, `input${source.ext}`);
      const meme = join(dir, source.kind === "image" ? "meme.png" : "meme.mp4");
      const output = join(dir, source.kind === "image" ? "sticker.webp" : "sticker.webm");

      await downloadTelegramFile(bot, source.fileId, input);
      await renderMeme(input, meme, { ...text, kind: source.kind });

      if (source.kind === "image") {
        await makeStaticSticker(meme, output);
      } else {
        await makeVideoSticker(meme, output);
      }

      await ctx.replyWithSticker(new InputFile(output));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Could not create a meme sticker: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  });
}
