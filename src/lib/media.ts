import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Bot } from "grammy";
import type { MediaInfo } from "./info.js";

export type MediaKind = "photo" | "video";

export interface MediaFile {
  path: string;
  name: string;
  kind: MediaKind;
  size: number;
  info?: MediaInfo;
}

const PHOTO_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".heic",
  ".avif",
]);

const VIDEO_EXT = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".3gp",
  ".mpg",
  ".mpeg",
  ".ts",
]);

const PHOTO_MIME_PREFIX = "image/";
const VIDEO_MIME_PREFIX = "video/";

export function kindFromExtension(path: string): MediaKind | null {
  const ext = extname(path).toLowerCase();
  if (PHOTO_EXT.has(ext)) return "photo";
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

export function kindFromMime(mime: string | undefined): MediaKind | null {
  if (!mime) return null;
  if (mime.startsWith(PHOTO_MIME_PREFIX)) return "photo";
  if (mime.startsWith(VIDEO_MIME_PREFIX)) return "video";
  return null;
}

export async function collectMedia(dir: string): Promise<MediaFile[]> {
  const found: MediaFile[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const kind = kindFromExtension(full);
      if (!kind) continue;
      const info = await stat(full);
      if (info.size === 0) continue;
      found.push({ path: full, name: entry.name, kind, size: info.size });
    }
  }

  await walk(dir);
  return found;
}

export function mediaKey(path: string): string {
  const ext = extname(path);
  return ext !== "" && kindFromExtension(path) !== null ? path.slice(0, -ext.length) : path;
}

export async function collectInfos(dir: string): Promise<Map<string, unknown>> {
  const map = new Map<string, unknown>();

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      let base: string | null = null;
      const isInfoJson = entry.name.endsWith(".info.json");
      if (isInfoJson) {
        base = full.slice(0, -".info.json".length);
      } else if (entry.name.endsWith(".json")) {
        base = full.slice(0, -".json".length);
      }
      if (base === null) continue;

      const key = mediaKey(base);
      if (!isInfoJson && map.has(key)) continue;

      try {
        map.set(key, JSON.parse(await readFile(full, "utf8")));
      } catch {
        // ignore unreadable/invalid metadata files
      }
    }
  }

  await walk(dir);
  return map;
}

export async function downloadTelegramFile(
  bot: Bot,
  fileId: string,
  destPath: string,
): Promise<void> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a file path.");
  }
  const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destPath, buffer);
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
