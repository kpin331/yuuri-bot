import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "./exec.js";
import { exceedsUploadLimit } from "./media.js";
import {
  DOWNLOAD_TIMEOUT_MS,
  extractPlayMeta,
  parseSearchEntries,
  PROBE_TIMEOUT_MS,
  SEARCH_COUNT,
  SEARCH_TIMEOUT_MS,
  type PlayMeta,
  type SearchResult,
} from "./play.js";
import { TOOLS } from "./tools.js";

export interface Download {
  path: string;
}

// Scans a directory for the file yt-dlp just produced, skipping its side files.
async function findOutput(dir: string): Promise<string | null> {
  const entries = await readdir(dir);
  for (const name of entries) {
    if (name.endsWith(".part") || name.endsWith(".json") || name.endsWith(".ytdl")) continue;
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isFile() && info.size > 0) return full;
  }
  return null;
}

async function runYtDlp(dir: string, url: string, extra: string[]): Promise<Download | null> {
  const args = [
    "--no-warnings",
    "--no-progress",
    "--no-mtime",
    ...extra,
    "-o",
    join(dir, "media.%(ext)s"),
  ];
  if (process.env.YTDLP_COOKIES) args.push("--cookies", process.env.YTDLP_COOKIES);
  args.push(url);

  try {
    const { code } = await exec(TOOLS.ytDlp, args, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
    if (code !== 0) return null;
  } catch {
    return null;
  }

  const path = await findOutput(dir);
  return path ? { path } : null;
}

// Runs a YouTube search through yt-dlp and parses the flat playlist into results.
export async function searchYouTube(query: string): Promise<SearchResult[]> {
  try {
    const { code, stdout } = await exec(
      TOOLS.ytDlp,
      [
        "--no-warnings",
        "--no-progress",
        "--dump-single-json",
        "--flat-playlist",
        `ytsearch${SEARCH_COUNT}:${query}`,
      ],
      { timeoutMs: SEARCH_TIMEOUT_MS },
    );
    if (code !== 0) return [];
    return parseSearchEntries(JSON.parse(stdout), SEARCH_COUNT);
  } catch {
    return [];
  }
}

// Reads metadata for a single media URL without downloading it.
export async function probeMeta(url: string): Promise<PlayMeta | null> {
  try {
    const { code, stdout } = await exec(
      TOOLS.ytDlp,
      ["--no-warnings", "--no-progress", "--dump-single-json", "--no-playlist", url],
      { timeoutMs: PROBE_TIMEOUT_MS },
    );
    if (code !== 0) return null;
    return extractPlayMeta(JSON.parse(stdout));
  } catch {
    return null;
  }
}

// Downloads the best audio track and converts it to m4a.
export function downloadAudio(dir: string, url: string): Promise<Download | null> {
  return runYtDlp(dir, url, ["-f", "ba", "-x", "--audio-format", "m4a", "--audio-quality", "0"]);
}

// Downloads video, preferring the best quality but falling back to <=480p when
// the high-quality file exceeds the upload limit.
export async function downloadVideo(dir: string, url: string): Promise<Download | null> {
  const first = await runYtDlp(dir, url, ["-f", "bv*+ba/b", "--merge-output-format", "mp4"]);
  if (first) {
    const size = (await stat(first.path)).size;
    if (!exceedsUploadLimit(size)) return first;
    await rm(first.path, { force: true });
  }
  return runYtDlp(dir, url, [
    "-f",
    "b[height<=480]/bv*[height<=480]+ba/b[height<=480]",
    "--merge-output-format",
    "mp4",
  ]);
}
