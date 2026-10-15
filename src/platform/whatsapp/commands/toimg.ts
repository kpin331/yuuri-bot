import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stickerToPng } from "../../../lib/stickers.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { downloadMedia, isStickerMessage, mediaSourceOf } from "../message.js";
import { replyTo, sendDocument, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const toimgCommand: WaCommand = {
  name: "toimg",
  run: async ({ message }) => {
    const reply = replyTo(message);
    const source = message.quoted ?? message.message;

    if (!isStickerMessage(source)) {
      await sendText(reply, "Reply to a sticker with .toimg to convert it into a PNG image.");
      return;
    }

    const dir = await makeTempDir("wa-toimg");
    try {
      const media = mediaSourceOf(source);
      const input = join(dir, `input${media?.ext ?? ".webp"}`);
      const output = join(dir, "sticker.png");

      await writeFile(input, await downloadMedia(source, message.sock));
      await stickerToPng(input, output);

      await sendDocument(reply, await readFile(output), "sticker.png");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendText(reply, `Could not convert the sticker: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  },
};
