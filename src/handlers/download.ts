import { extname, join } from "node:path";
import { InputFile, type Bot, type Context } from "grammy";
import { InputMediaBuilder } from "grammy";
import { exec } from "../lib/exec.js";
import {
  collectMedia,
  formatBytes,
  MAX_UPLOAD_BYTES,
  type MediaFile,
} from "../lib/media.js";
import { makeTempDir, removeDir } from "../lib/temp.js";
import { TOOLS } from "../lib/tools.js";

type Platform = "ig" | "x" | "fb" | "auto";
type DownloadTool = "gallery" | "ytdlp";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov"]);
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

function extractUrl(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_PATTERN);
  return match ? match[0] : null;
}

function detectPlatform(url: string): Platform {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "auto";
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) return "ig";
  if (host === "x.com" || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
  if (host === "fb.watch" || host === "facebook.com" || host.endsWith(".facebook.com")) {
    return "fb";
  }
  return "auto";
}

function strategiesFor(platform: Platform): DownloadTool[] {
  switch (platform) {
    case "ig":
    case "x":
      return ["gallery", "ytdlp"];
    case "fb":
    case "auto":
      return ["ytdlp", "gallery"];
  }
}

async function runYtDlp(url: string, dir: string): Promise<void> {
  const args = [
    "--no-warnings",
    "--no-progress",
    "--no-mtime",
    "--playlist-end",
    "30",
    "--max-filesize",
    "500M",
    "-f",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "-o",
    join(dir, "%(title).60s_%(id)s_%(autonumber)s.%(ext)s"),
  ];
  if (process.env.YTDLP_COOKIES) args.push("--cookies", process.env.YTDLP_COOKIES);
  args.push(url);
  await exec(TOOLS.ytDlp, args, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
}

async function runGalleryDl(url: string, dir: string): Promise<void> {
  const args = ["--dest", dir, "--no-mtime", "--range", "1-50"];
  if (process.env.GALLERYDL_COOKIES) {
    args.push("--cookies", process.env.GALLERYDL_COOKIES);
  }
  args.push(url);
  await exec(TOOLS.galleryDl, args, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
}

async function download(url: string, platform: Platform, dir: string): Promise<MediaFile[]> {
  for (const tool of strategiesFor(platform)) {
    try {
      if (tool === "ytdlp") {
        await runYtDlp(url, dir);
      } else {
        await runGalleryDl(url, dir);
      }
    } catch {
      continue;
    }
    const files = await collectMedia(dir);
    if (files.length > 0) return files;
  }
  return collectMedia(dir);
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

async function sendPhotos(ctx: Context, photos: MediaFile[]): Promise<void> {
  for (const group of chunk(photos, 10)) {
    try {
      if (group.length === 1) {
        await ctx.replyWithPhoto(new InputFile(group[0]!.path));
      } else {
        const media = group.map((file) => InputMediaBuilder.photo(new InputFile(file.path)));
        await ctx.replyWithMediaGroup(media);
      }
    } catch {
      for (const file of group) {
        await ctx.replyWithDocument(new InputFile(file.path));
      }
    }
  }
}

async function sendVideo(ctx: Context, file: MediaFile): Promise<void> {
  const sendable = VIDEO_EXTENSIONS.has(extname(file.path).toLowerCase());
  if (sendable) {
    try {
      await ctx.replyWithVideo(new InputFile(file.path));
      return;
    } catch {
      // fall through to document
    }
  }
  await ctx.replyWithDocument(new InputFile(file.path));
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
    await ctx.replyWithChatAction("upload_photo");
    const files = await download(url, resolved, dir);

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
    const oversized = files.filter((file) => file.size > MAX_UPLOAD_BYTES);

    await ctx.api.editMessageText(
      status.chat.id,
      status.message_id,
      `Found ${photos.length} photo(s) and ${videos.length} video(s).`,
    );

    await sendPhotos(ctx, photos);

    for (const file of videos) {
      if (file.size > MAX_UPLOAD_BYTES) continue;
      await sendVideo(ctx, file);
    }

    if (oversized.length > 0) {
      const list = oversized.map((file) => `• ${file.name} (${formatBytes(file.size)})`).join("\n");
      await ctx.reply(`Skipped ${oversized.length} file(s) larger than 50 MB:\n${list}`);
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
    bot.command(command, (ctx) => handleDownload(ctx, platform));
  }
}
