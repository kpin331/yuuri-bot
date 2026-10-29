import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stickerToMp4 } from "../../../lib/stickers.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { downloadMedia, isStickerMessage, mediaSourceOf } from "../message.js";
import { replyTo, sendText, sendVideo } from "../reply.js";
import type { WaCommand } from "../types.js";

export const tovidCommand: WaCommand = {
  name: "tovid",
  run: async ({ message }) => {
    const reply = replyTo(message);
    const source = message.quoted ?? message.message;

    if (!isStickerMessage(source)) {
      await sendText(reply, "Balas stiker dengan .tovid untuk mengubahnya menjadi video MP4.");
      return;
    }

    const dir = await makeTempDir("wa-tovid");
    try {
      const media = mediaSourceOf(source);
      const input = join(dir, `input${media?.ext ?? ".webp"}`);
      const output = join(dir, "sticker.mp4");

      await writeFile(input, await downloadMedia(source, message.sock));
      await stickerToMp4(input, output);
      await sendVideo(reply, await readFile(output), undefined, "sticker.mp4");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendText(reply, `Stiker tidak dapat dikonversi: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  },
};
