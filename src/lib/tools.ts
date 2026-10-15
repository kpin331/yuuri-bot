import { getImpersonateTarget } from "./config.js";
import { exec } from "./exec.js";

export const TOOLS = {
  get ffmpeg(): string {
    return process.env.FFMPEG_PATH ?? "ffmpeg";
  },
  get ffprobe(): string {
    return process.env.FFPROBE_PATH ?? "ffprobe";
  },
  get ytDlp(): string {
    return process.env.YTDLP_PATH ?? "yt-dlp";
  },
  get galleryDl(): string {
    return process.env.GALLERYDL_PATH ?? "gallery-dl";
  },
};

export type ToolName = keyof typeof TOOLS;

// Shared yt-dlp flag that makes it impersonate a browser fingerprint, which
// gets past some bot/403 checks. Empty when impersonation is disabled.
export function impersonateArgs(): string[] {
  const target = getImpersonateTarget();
  return target ? ["--impersonate", target] : [];
}

// Netscape-format cookies file for yt-dlp, used for age-restricted/private
// content. Empty when YTDLP_COOKIES is not set.
export function ytDlpCookieArgs(): string[] {
  const file = process.env.YTDLP_COOKIES?.trim();
  return file ? ["--cookies", file] : [];
}

// Same for gallery-dl.
export function galleryDlCookieArgs(): string[] {
  const file = process.env.GALLERYDL_COOKIES?.trim();
  return file ? ["--cookies", file] : [];
}

// ffmpeg/ffprobe use a single dash, yt-dlp/gallery-dl use two.
const VERSION_ARGS: Record<ToolName, string[]> = {
  ffmpeg: ["-version"],
  ffprobe: ["-version"],
  ytDlp: ["--version"],
  galleryDl: ["--version"],
};

export async function isToolAvailable(name: ToolName): Promise<boolean> {
  try {
    const { code } = await exec(TOOLS[name], VERSION_ARGS[name], { timeoutMs: 15_000 });
    return code === 0;
  } catch {
    return false;
  }
}

export async function checkRequiredTools(): Promise<ToolName[]> {
  const names = Object.keys(TOOLS) as ToolName[];
  const results = await Promise.all(
    names.map(async (name) => ((await isToolAvailable(name)) ? null : name)),
  );
  return results.filter((name): name is ToolName => name !== null);
}
