import { join } from "node:path";
import { exec } from "./exec.js";
import { collectMedia, MAX_UPLOAD_BYTES, type MediaFile } from "./media.js";
import { galleryDlCookieArgs, impersonateArgs, TOOLS, ytDlpCookieArgs } from "./tools.js";

export type Platform = "ig" | "x" | "fb" | "auto";
type DownloadTool = "gallery" | "ytdlp";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

// Pulls the first URL out of a message, or null when there is none.
export function extractUrl(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_PATTERN);
  return match ? match[0] : null;
}

// Guesses which site a link belongs to so the right downloader runs first.
export function detectPlatform(url: string): Platform {
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
    ...impersonateArgs(),
    ...ytDlpCookieArgs(),
    "--playlist-end",
    "30",
    "--max-filesize",
    `${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}M`,
    "-f",
    "bv*+ba/b",
    "--merge-output-format",
    "mp4",
    "--write-info-json",
    "-o",
    join(dir, "%(title).60s_%(id)s_%(autonumber)s.%(ext)s"),
    url,
  ];
  await exec(TOOLS.ytDlp, args, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
}

async function runGalleryDl(url: string, dir: string): Promise<void> {
  const args = [
    "--dest",
    dir,
    "--no-mtime",
    "--range",
    "1-50",
    "--write-metadata",
    ...galleryDlCookieArgs(),
    url,
  ];
  await exec(TOOLS.galleryDl, args, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
}

// Tries the platform's downloader strategies in order and returns every media
// file found in the target directory.
export async function download(
  url: string,
  platform: Platform,
  dir: string,
): Promise<MediaFile[]> {
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
