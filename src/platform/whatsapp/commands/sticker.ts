import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeAnimatedSticker, makeStaticSticker } from "../../../lib/stickers.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { downloadMedia, mediaSourceOf } from "../message.js";
import { replyTo, sendSticker, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const stickerCommand: WaCommand = {
  name: "s",
  run: async ({ message }) => {
    const reply = replyTo(message);
    const source = message.quoted ?? message.message;
    const media = mediaSourceOf(source);

    if (!media) {
      await sendText(
        reply,
        "Reply to an image or video with .s, or send a media file with .s as its caption.",
      );
      return;
    }

    const dir = await makeTempDir("wa-sticker");
    try {
      const inputBuffer = await downloadMedia(source, message.sock);
      const input = join(dir, `input${media.ext}`);
      const output = join(dir, "sticker.webp");
      await writeFile(input, inputBuffer);

      if (media.kind === "image") {
        await makeStaticSticker(input, output);
      } else {
        await makeAnimatedSticker(input, output);
      }

      await sendSticker(reply, await readFile(output));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendText(reply, `Could not create a sticker: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  },
};
