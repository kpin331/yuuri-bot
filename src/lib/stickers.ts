import { stat } from "node:fs/promises";
import { exec } from "./exec.js";
import { TOOLS } from "./tools.js";

// Telegram/WhatsApp sticker size budgets.
const STATIC_LIMIT = 512 * 1024;
const VIDEO_LIMIT = 256 * 1024;
// WhatsApp animated stickers are animated WebP, capped at 1 MB.
const WA_ANIMATED_LIMIT = 1024 * 1024;

async function sizeOf(path: string): Promise<number> {
  return (await stat(path)).size;
}

// Converts an image into a 512x512 WebP sticker, lowering quality until it fits.
export async function makeStaticSticker(input: string, output: string): Promise<void> {
  const qualities = ["85", "65", "45", "25"];
  for (const quality of qualities) {
    const { code, stderr } = await exec(TOOLS.ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-vf",
      "scale=512:512,format=rgba",
      "-frames:v",
      "1",
      "-c:v",
      "libwebp",
      "-q:v",
      quality,
      "-compression_level",
      "6",
      "-loop",
      "0",
      "-an",
      "-pix_fmt",
      "yuva420p",
      output,
    ]);
    if (code !== 0) {
      throw new Error(`ffmpeg failed to build sticker: ${stderr.trim()}`);
    }
    if ((await sizeOf(output)) <= STATIC_LIMIT) return;
  }
}

// Converts a short video into a 512x512 animated WebP sticker, lowering the
// bitrate until it fits the size budget.
export async function makeVideoSticker(input: string, output: string): Promise<void> {
  const presets = [
    { bitrate: "700k", crf: "30" },
    { bitrate: "450k", crf: "33" },
    { bitrate: "320k", crf: "36" },
    { bitrate: "220k", crf: "40" },
  ];
  for (const preset of presets) {
    const { code, stderr } = await exec(TOOLS.ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-t",
      "3",
      "-an",
      "-vf",
      "scale=512:512:force_original_aspect_ratio=decrease,format=yuva420p,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=30",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      preset.bitrate,
      "-crf",
      preset.crf,
      "-deadline",
      "good",
      "-cpu-used",
      "2",
      "-auto-alt-ref",
      "0",
      "-row-mt",
      "1",
      "-pix_fmt",
      "yuva420p",
      "-f",
      "webm",
      output,
    ]);
    if (code !== 0) {
      throw new Error(`ffmpeg failed to build sticker: ${stderr.trim()}`);
    }
    if ((await sizeOf(output)) <= VIDEO_LIMIT) return;
  }
}

// Converts a short video into a 512x512 animated WebP sticker for WhatsApp
// (WhatsApp stickers are always WebP, unlike Telegram's WebM), lowering quality
// until it fits the size budget.
export async function makeAnimatedSticker(input: string, output: string): Promise<void> {
  const qualities = ["70", "55", "40", "25", "12"];
  for (const quality of qualities) {
    const { code, stderr } = await exec(TOOLS.ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input,
      "-t",
      "3",
      "-an",
      "-vf",
      "scale=512:512:force_original_aspect_ratio=decrease,format=yuva420p,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=15",
      "-c:v",
      "libwebp",
      "-q:v",
      quality,
      "-loop",
      "0",
      "-f",
      "webp",
      output,
    ]);
    if (code !== 0) {
      throw new Error(`ffmpeg failed to build sticker: ${stderr.trim()}`);
    }
    if ((await sizeOf(output)) <= WA_ANIMATED_LIMIT) return;
  }
}

// Renders the first frame of a sticker (WebP or WebM) as a PNG image.
export async function stickerToPng(input: string, output: string): Promise<void> {
  const { code, stderr } = await exec(TOOLS.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-frames:v",
    "1",
    output,
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg failed to convert the sticker: ${stderr.trim()}`);
  }
}
