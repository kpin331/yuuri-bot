import {
  download,
  type Platform,
} from "../../../lib/downloader.js";
import { formatInfo, parseInfo } from "../../../lib/info.js";
import {
  collectInfos,
  exceedsUploadLimit,
  hasFreeSpace,
  MAX_UPLOAD_BYTES,
  mediaKey,
  uploadLimitError,
} from "../../../lib/media.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { htmlToWhatsApp } from "../../../lib/text.js";
import { extractText } from "../message.js";
import { replyTo, sendMediaFile, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";
import { normalizeWaDownloadVideo, parseWaDownload } from "../../../lib/wa-download-video.js";

async function runDownload(
  message: Parameters<WaCommand["run"]>[0]["message"],
  platform: Platform | null,
): Promise<void> {
  const reply = replyTo(message);
  const quotedText = message.quoted ? extractText(message.quoted) : "";
  const options = parseWaDownload(message.text, quotedText, platform);
  const url = options.url;

  if (!url) {
    await sendText(reply, "Kirim tautan atau balas pesan yang berisi tautan.");
    return;
  }

  const resolved = options.platform;
  await sendText(reply, "Sedang mengunduh…");

  const dir = await makeTempDir("wa-dl");
  try {
    if (!(await hasFreeSpace(dir, MAX_UPLOAD_BYTES))) {
      await sendText(reply, "Ruang penyimpanan tidak cukup untuk mengunduh.");
      return;
    }

    const files = await download(url, resolved, dir);
    if (files.length === 0) {
      await sendText(reply, "Tidak ditemukan media yang dapat diunduh dari tautan itu.");
      return;
    }

    const infos = await collectInfos(dir);

    for (const file of files) {
      const prepared = file.kind === "video" && options.resolution !== null
        ? await normalizeWaDownloadVideo(file, dir, options.resolution)
        : file;
      if (exceedsUploadLimit(prepared.size)) {
        await sendText(reply, uploadLimitError(prepared.size));
        continue;
      }

      const info = parseInfo(infos.get(mediaKey(file.path)));
      const caption = formatInfo(info);
      await sendMediaFile(reply, prepared, caption ? htmlToWhatsApp(caption) : undefined);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await sendText(reply, `Pengunduhan gagal: ${reason}`);
  } finally {
    await removeDir(dir);
  }
}

function makeDownloadCommand(name: string, platform: Platform | null): WaCommand {
  return {
    name,
    run: async ({ message }) => {
      await runDownload(message, platform);
    },
  };
}

export const downloadCommands: WaCommand[] = [
  makeDownloadCommand("dl", null),
  makeDownloadCommand("ig", "ig"),
  makeDownloadCommand("x", "x"),
  makeDownloadCommand("fb", "fb"),
  makeDownloadCommand("tt", "tt"),
];
