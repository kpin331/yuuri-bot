import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseMemeText, renderMeme } from "../../../lib/meme.js";
import {
  addStickerExif,
  makeAnimatedSticker,
  makeStaticSticker,
} from "../../../lib/stickers.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { downloadMedia, mediaSourceOf } from "../message.js";
import { replyTo, sendSticker, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";
import { PACK_AUTHOR, PACK_ID, PACK_NAME } from "./sticker.js";

const USAGE_MEDIA =
  "Reply to an image or video with .smeme, or send a media file with .smeme as its caption.";
const USAGE_TEXT =
  "Add some text: .smeme top | bottom. With no | the text goes at the bottom.";

export const smemeCommand: WaCommand = {
  name: "smeme",
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    const source = message.quoted ?? message.message;
    const media = mediaSourceOf(source);

    if (!media) {
      await sendText(reply, USAGE_MEDIA);
      return;
    }

    const text = parseMemeText(args);
    if (!text) {
      await sendText(reply, USAGE_TEXT);
      return;
    }

    const dir = await makeTempDir("wa-smeme");
    try {
      const inputBuffer = await downloadMedia(source, message.sock);
      const input = join(dir, `input${media.ext}`);
      const meme = join(dir, media.kind === "image" ? "meme.png" : "meme.mp4");
      const output = join(dir, "sticker.webp");
      await writeFile(input, inputBuffer);

      await renderMeme(input, meme, { ...text, kind: media.kind });

      if (media.kind === "image") {
        await makeStaticSticker(meme, output);
      } else {
        await makeAnimatedSticker(meme, output);
      }

      const sticker = await readFile(output);
      await sendSticker(
        reply,
        addStickerExif(sticker, {
          packId: PACK_ID,
          packName: PACK_NAME,
          publisher: PACK_AUTHOR,
        }),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendText(reply, `Could not create a meme sticker: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  },
};
