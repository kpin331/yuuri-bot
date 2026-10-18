import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { exec } from "./exec.js";
import { TOOLS } from "./tools.js";

// Meme caption split: top line and/or bottom line. A single line with no "|"
// goes to the bottom, which is where a lone meme caption reads naturally.
export interface MemeText {
  top: string | null;
  bottom: string | null;
}

export function parseMemeText(raw: string): MemeText | null {
  const text = raw.trim();
  if (!text) return null;

  const split = text.indexOf("|");
  if (split === -1) return { top: null, bottom: text };

  const top = text.slice(0, split).trim();
  const bottom = text.slice(split + 1).trim();
  if (!top && !bottom) return null;
  return { top: top || null, bottom: bottom || null };
}

export interface MemeFontMetrics {
  fontSize: number;
  borderW: number;
}

// One font size shared by both lines so the sticker reads as a single meme.
// The estimate (0.58 of the font size per character) is an average advance
// width for bold sans fonts; long captions shrink instead of overflowing.
export function fitMemeFont(width: number, lines: (string | null)[]): MemeFontMetrics {
  let fontSize = Math.max(16, Math.round(width * 0.1));
  for (const line of lines) {
    if (!line) continue;
    const longest = Math.max(...line.split("\n").map((part) => part.trim().length));
    if (longest === 0) continue;
    fontSize = Math.min(fontSize, Math.floor((width * 0.94) / (longest * 0.58)));
  }
  fontSize = Math.max(fontSize, 12);

  // White text needs a black outline to stay readable on any photo; kept at
  // ~7.5% of the font size, thick enough to separate, thin enough to not blob.
  const borderW = Math.max(2, Math.round(fontSize * 0.075));
  return { fontSize, borderW };
}

// No font ships with the repo, so the first system candidate wins.
// MEME_FONT_PATH overrides it, same pattern as FFMPEG_PATH.
const FONT_CANDIDATES = [
  "C:\\Windows\\Fonts\\impact.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Impact.ttf",
];

export function resolveMemeFont(): string {
  const override = process.env.MEME_FONT_PATH?.trim();
  if (override) return override;
  for (const candidate of FONT_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No system font found for meme text. Set MEME_FONT_PATH to a .ttf file.");
}

// The font and text files are copied next to the output and ffmpeg runs with
// its cwd set there, so the filtergraph only sees plain relative names. That
// sidesteps filtergraph escaping for Windows paths (colons, backslashes).
export async function renderMeme(
  input: string,
  output: string,
  options: MemeText & { kind: "image" | "video" },
): Promise<void> {
  const { top, bottom, kind } = options;
  if (!top && !bottom) throw new Error("No meme text to draw.");

  const dir = dirname(output);
  copyFileSync(resolveMemeFont(), join(dir, "font.ttf"));

  const width = await probeWidth(input);
  const { fontSize, borderW } = fitMemeFont(width, [top, bottom]);

  const filters: string[] = [];
  for (const [file, text, y] of [
    ["top.txt", top, "h*0.02"],
    ["bottom.txt", bottom, "h-text_h-h*0.02"],
  ] as const) {
    if (!text) continue;
    writeFileSync(join(dir, file), text, "utf8");
    filters.push(
      `drawtext=fontfile=font.ttf:textfile=${file}:fontsize=${fontSize}:fontcolor=white:` +
        `borderw=${borderW}:bordercolor=black:expansion=none:` +
        `x=(w-text_w)/2:y=${y}:fix_bounds=1`,
    );
  }
  const vf = filters.join(",");

  const args =
    kind === "image"
      ? ["-frames:v", "1"]
      : ["-t", "3", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an"];

  const { code, stderr } = await exec(
    TOOLS.ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", vf, ...args, output],
    { cwd: dir },
  );
  if (code !== 0) throw new Error(`ffmpeg failed to draw meme text: ${stderr.trim()}`);
}

async function probeWidth(path: string): Promise<number> {
  const { code, stdout, stderr } = await exec(TOOLS.ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width",
    "-of",
    "csv=p=0",
    path,
  ]);
  const width = Number.parseInt(stdout.trim(), 10);
  if (code !== 0 || !Number.isFinite(width) || width <= 0) {
    throw new Error(`Could not read media dimensions: ${stderr.trim() || "unknown format"}`);
  }
  return width;
}
