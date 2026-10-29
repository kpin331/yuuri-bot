import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeQr, generateQr } from "../../../lib/qr.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { downloadMedia, mediaSourceOf } from "../message.js";
import { replyTo, sendImage, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

const USAGE = "Kirim .qr <teks atau tautan> untuk membuat QR, atau balas gambar berisi QR dengan .qr untuk membacanya.";

export const qrCommand: WaCommand = {
  name: "qr",
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    const raw = args.trim();

    if (raw) {
      try {
        const image = await generateQr(raw);
        await sendImage(reply, image, undefined, "qr.png");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await sendText(reply, `QR tidak bisa dibuat: ${reason}`);
      }
      return;
    }

    const source = message.quoted ?? message.message;
    const media = mediaSourceOf(source);
    if (!media || media.kind !== "image") {
      await sendText(reply, USAGE);
      return;
    }

    const dir = await makeTempDir("wa-qr");
    try {
      const input = join(dir, `input${media.ext}`);
      await writeFile(input, await downloadMedia(source, message.sock));
      const decoded = await decodeQr(input);
      if (decoded === null) {
        await sendText(reply, "Tidak ada QR yang terbaca di gambar itu. Pastikan QR-nya terlihat jelas dan tidak buram.");
        return;
      }
      await sendText(reply, `Isi QR:\n${decoded}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await sendText(reply, `QR tidak bisa dibaca: ${reason}`);
    } finally {
      await removeDir(dir);
    }
  },
};
