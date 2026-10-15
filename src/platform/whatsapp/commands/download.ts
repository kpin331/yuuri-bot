import {
  detectPlatform,
  download,
  extractUrl,
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

async function runDownload(
  message: Parameters<WaCommand["run"]>[0]["message"],
  platform: Platform | null,
): Promise<void> {
  const reply = replyTo(message);
  const quotedText = message.quoted ? extractText(message.quoted) : "";
  const url = extractUrl(message.text) ?? extractUrl(quotedText);

  if (!url) {
    await sendText(reply, "Send a link, or reply to a message that contains one.");
    return;
  }

  const resolved = platform ?? detectPlatform(url);
  await sendText(reply, "Downloading…");

  const dir = await makeTempDir("wa-dl");
  try {
    if (!(await hasFreeSpace(dir, MAX_UPLOAD_BYTES))) {
      await sendText(reply, "Not enough free disk space to download.");
      return;
    }

    const files = await download(url, resolved, dir);
    if (files.length === 0) {
      await sendText(reply, "No downloadable media found at that link.");
      return;
    }

    const infos = await collectInfos(dir);

    for (const file of files) {
      if (exceedsUploadLimit(file.size)) {
        await sendText(reply, uploadLimitError(file.size));
        continue;
      }

      const info = parseInfo(infos.get(mediaKey(file.path)));
      const caption = formatInfo(info);
      await sendMediaFile(reply, file, caption ? htmlToWhatsApp(caption) : undefined);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await sendText(reply, `Download failed: ${reason}`);
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
];
