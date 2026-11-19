import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "./exec.js";
import { TOOLS } from "./tools.js";

export const BRAT_PROMPT = "static or animated?";
export const BRAT_SESSION_TTL_MS = 2 * 60 * 1000;
export const BRAT_MAX_LINES = 4;
export const BRAT_LINE_LENGTH = 14;
export const BRAT_FONT_FILE = "ARIALNB.TTF";

const RENDER_TIMEOUT_MS = 60_000;
const CANVAS_SIZE = 640;
const BLUR_SIGMA = 2;
const BACKGROUND = "0x8ACE00";

export type BratFormat = "static" | "animated";

export interface BratSession {
  key: string;
  chatId: string;
  userId: string;
  text: string;
  createdAt: number;
}

export class BratSessionStore {
  private readonly sessions = new Map<string, BratSession>();

  constructor(
    private readonly ttlMs: number = BRAT_SESSION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private key(chatId: string, userId: string): string {
    return `${chatId}:${userId}`;
  }

  create(input: { chatId: string; userId: string; text: string }): BratSession {
    const session: BratSession = {
      key: this.key(input.chatId, input.userId),
      chatId: input.chatId,
      userId: input.userId,
      text: input.text,
      createdAt: this.now(),
    };
    this.sessions.set(session.key, session);
    return session;
  }

  get(chatId: string, userId: string): BratSession | null {
    const key = this.key(chatId, userId);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (this.now() - session.createdAt >= this.ttlMs) {
      this.sessions.delete(key);
      return null;
    }
    return session;
  }

  delete(chatId: string, userId: string): void {
    this.sessions.delete(this.key(chatId, userId));
  }
}

export function normalizeBratText(value: string): string | null {
  const text = value.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
  return wrapBratText(text) ? text : null;
}

export function parseBratChoice(value: string): BratFormat | null {
  const answer = value.trim().toLocaleLowerCase("id-ID");
  if (answer === "static" || answer === "1") return "static";
  if (answer === "animated" || answer === "2") return "animated";
  return null;
}

export function wrapBratText(text: string): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > BRAT_LINE_LENGTH) return null;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > BRAT_LINE_LENGTH) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length <= BRAT_MAX_LINES ? lines : null;
}

export function bratFontSize(lines: string[]): number {
  const longest = Math.max(...lines.map((line) => line.length));
  return Math.min(100, Math.max(36, Math.floor((CANVAS_SIZE * 0.84) / (longest * 0.5))));
}

export interface RenderBratOptions {
  text: string;
  format: BratFormat;
  workDir: string;
  fontPath?: string;
}

// Renders into a caller-owned temp directory. The font is copied next to the
// text file so ffmpeg never has to parse a Windows path with a drive colon.
export async function renderBrat(options: RenderBratOptions): Promise<string> {
  const lines = wrapBratText(options.text);
  if (!lines) throw new Error("Teks brat tidak valid.");

  const fontPath = options.fontPath
    ?? process.env.BRAT_FONT_PATH
    ?? join(process.env.WINDIR ?? "C:\\Windows", "Fonts", BRAT_FONT_FILE);
  await copyFile(fontPath, join(options.workDir, BRAT_FONT_FILE));
  await writeFile(join(options.workDir, "brat.txt"), lines.join("\n"), "utf8");

  const fontSize = bratFontSize(lines);
  const drawtext = [
    `drawtext=fontfile=${BRAT_FONT_FILE}`,
    "textfile=brat.txt",
    "fontcolor=black",
    `fontsize=${fontSize}`,
    "line_spacing=0",
  ];
  const blur = `gblur=sigma=${BLUR_SIGMA}`;
  const filters = options.format === "static"
    ? [...drawtext, "x=(w-text_w)/2", "y=(h-text_h)/2"].join(":") + `,${blur}`
    : [
        ...drawtext,
        "x=(w-text_w)/2+14*sin(2*PI*t/2)",
        "y=(h-text_h)/2+12*cos(2*PI*t/2)",
      ].join(":") + `,${blur}`;

  const outputName = options.format === "static" ? "brat.png" : "brat.mp4";
  const input = [
    "-hide_banner",
    "-loglevel", "error",
    "-f", "lavfi",
    "-i", `color=c=${BACKGROUND}:s=${CANVAS_SIZE}x${CANVAS_SIZE}:r=15:d=2`,
    "-vf", filters,
  ];
  const args = options.format === "static"
    ? [...input, "-frames:v", "1", "-y", outputName]
    : [
        ...input,
        "-t", "2",
        "-an",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-y",
        outputName,
      ];

  await runFfmpeg(args, options.workDir);
  return join(options.workDir, outputName);
}

async function runFfmpeg(args: string[], cwd: string): Promise<void> {
  const result = await exec(TOOLS.ffmpeg, args, {
    cwd,
    timeoutMs: RENDER_TIMEOUT_MS,
    maxOutputBytes: 256 * 1024,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim().split("\n").slice(-8).join(" ").trim();
    throw new Error(`ffmpeg gagal dengan kode ${result.code}${detail ? `: ${detail}` : "."}`);
  }
}
