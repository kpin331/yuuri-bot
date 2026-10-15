import { extname } from "node:path";
import { InputFile, type Bot, type Context } from "grammy";
import { InputMediaBuilder } from "grammy";
import { registerCommand } from "../lib/command.js";
import { detectPlatform, download, extractUrl, type Platform } from "../lib/downloader.js";
import { formatInfo, parseInfo } from "../lib/info.js";
import {
  collectInfos,
  exceedsUploadLimit,
  formatBytes,
  hasFreeSpace,
  MAX_UPLOAD_BYTES,
  mediaKey,
  uploadLimitError,
  type MediaFile,
} from "../lib/media.js";
import { makeTempDir, removeDir } from "../lib/temp.js";

const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov"]);

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

function captionOf(file: MediaFile): string | undefined {
  return file.info ? formatInfo(file.info) : undefined;
}

async function sendPhotos(ctx: Context, photos: MediaFile[]): Promise<void> {
  for (const group of chunk(photos, 10)) {
    const firstCaption = captionOf(group[0]!);
    try {
      if (group.length === 1) {
        await ctx.replyWithPhoto(
          new InputFile(group[0]!.path),
          firstCaption ? { caption: firstCaption, parse_mode: "HTML" } : {},
        );
      } else {
        const media = group.map((file, index) =>
          InputMediaBuilder.photo(
            new InputFile(file.path),
            index === 0 && firstCaption ? { caption: firstCaption, parse_mode: "HTML" } : {},
          ),
        );
        await ctx.replyWithMediaGroup(media);
      }
    } catch {
      for (const file of group) {
        const caption = captionOf(file);
        await ctx.replyWithDocument(
          new InputFile(file.path),
          caption ? { caption, parse_mode: "HTML" } : {},
        );
      }
    }
  }
}

async function sendVideo(ctx: Context, file: MediaFile): Promise<void> {
  const caption = captionOf(file);
  const options = caption ? { caption, parse_mode: "HTML" as const } : {};
  const sendable = VIDEO_EXTENSIONS.has(extname(file.path).toLowerCase());
  if (sendable) {
    try {
      await ctx.replyWithVideo(new InputFile(file.path), options);
      return;
    } catch {
      // fall through to document
    }
  }
  await ctx.replyWithDocument(new InputFile(file.path), options);
}

async function handleDownload(ctx: Context, platform: Platform | null): Promise<void> {
  const replied = ctx.message?.reply_to_message;
  const text =
    ctx.match && typeof ctx.match === "string" && ctx.match.trim().length > 0
      ? ctx.match
      : (replied?.text ?? replied?.caption ?? ctx.message?.caption);

  const url = extractUrl(text);
  if (!url) {
    await ctx.reply("Send a link, e.g. `/dl https://…`, or reply to a message containing a link.", {
      parse_mode: "Markdown",
    });
    return;
  }

  const resolved = platform ?? detectPlatform(url);
  const status = await ctx.reply("Downloading…");

  const dir = await makeTempDir("dl");
  try {
    if (!(await hasFreeSpace(dir, MAX_UPLOAD_BYTES))) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        "Not enough free disk space to download safely.",
      );
      return;
    }

    await ctx.replyWithChatAction("upload_photo");
    const downloaded = await download(url, resolved, dir);
    const infos = await collectInfos(dir);
    const files = downloaded.map((file) => ({
      ...file,
      info: parseInfo(infos.get(mediaKey(file.path))),
    }));

    if (files.length === 0) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        "Could not find any downloadable media at that link. The post may be private, or require cookies.",
      );
      return;
    }

    const photos = files.filter((file) => file.kind === "photo");
    const videos = files.filter((file) => file.kind === "video");
    const oversized = files.filter((file) => exceedsUploadLimit(file.size));

    await ctx.api.editMessageText(
      status.chat.id,
      status.message_id,
      `Found ${photos.length} photo(s) and ${videos.length} video(s).`,
    );

    await sendPhotos(ctx, photos);

    for (const file of videos) {
      if (exceedsUploadLimit(file.size)) continue;
      await sendVideo(ctx, file);
    }

    if (oversized.length > 0) {
      const list = oversized
        .map((file) => `• ${file.name} (${formatBytes(file.size)}) — ${uploadLimitError(file.size)}`)
        .join("\n");
      await ctx.reply(`Skipped ${oversized.length} file(s) over the limit:\n${list}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await ctx.api
      .editMessageText(status.chat.id, status.message_id, `Download failed: ${reason}`)
      .catch(() => undefined);
  } finally {
    await removeDir(dir);
  }
}

export function registerDownloader(bot: Bot): void {
  const platforms: Record<string, Platform | null> = {
    ig: "ig",
    x: "x",
    fb: "fb",
    dl: null,
  };

  for (const [command, platform] of Object.entries(platforms)) {
    registerCommand(bot, command, (ctx) => handleDownload(ctx, platform));
  }
}
