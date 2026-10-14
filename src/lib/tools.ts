import { exec } from "./exec.js";

export const TOOLS = {
  ffmpeg: process.env.FFMPEG_PATH ?? "ffmpeg",
  ffprobe: process.env.FFPROBE_PATH ?? "ffprobe",
  ytDlp: process.env.YTDLP_PATH ?? "yt-dlp",
  galleryDl: process.env.GALLERYDL_PATH ?? "gallery-dl",
} as const;

export type ToolName = keyof typeof TOOLS;

export async function isToolAvailable(name: ToolName): Promise<boolean> {
  try {
    const { code } = await exec(TOOLS[name], ["--version"], { timeoutMs: 15_000 });
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
