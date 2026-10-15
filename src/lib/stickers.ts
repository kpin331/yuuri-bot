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

// WhatsApp shows a sticker's pack name and author from a JSON blob stored in a
// WebP EXIF chunk under TIFF tag 0x5741 (the layout WhatsApp's own stickers
// use), so we inject that chunk ourselves after ffmpeg has produced the WebP.
export interface StickerExifMetadata {
  packId: string;
  packName: string;
  publisher: string;
  emojis?: string[];
}

// VP8X feature byte: bit for "EXIF metadata present".
const VP8X_EXIF_FLAG = 0x08;

// Little-endian TIFF header with one IFD entry: tag 0x5741, type 7 (undefined),
// the JSON byte length, and the value offset 0x16 (22) pointing past the header.
function buildExifPayload(metadata: StickerExifMetadata): Buffer {
  const json = Buffer.from(
    JSON.stringify({
      "sticker-pack-id": metadata.packId,
      "sticker-pack-name": metadata.packName,
      "sticker-pack-publisher": metadata.publisher,
      emojis: metadata.emojis ?? [],
    }),
    "utf8",
  );

  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  header.writeUIntLE(json.length, 14, 4);
  return Buffer.concat([header, json]);
}

interface WebpChunk {
  fourcc: string;
  data: Buffer;
}

// Canvas size of a simple-format WebP (no VP8X header), read from the image
// chunk. Returns null when the bitstream cannot be parsed.
function readCanvasSize(chunks: WebpChunk[]): { width: number; height: number } | null {
  const vp8l = chunks.find((chunk) => chunk.fourcc === "VP8L");
  if (vp8l && vp8l.data.length >= 5 && vp8l.data[0] === 0x2f) {
    const bits = vp8l.data.readUInt32LE(1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }

  const vp8 = chunks.find((chunk) => chunk.fourcc === "VP8 ");
  if (
    vp8 &&
    vp8.data.length >= 10 &&
    vp8.data[3] === 0x9d &&
    vp8.data[4] === 0x01 &&
    vp8.data[5] === 0x2a
  ) {
    return {
      width: vp8.data.readUInt16LE(6) & 0x3fff,
      height: vp8.data.readUInt16LE(8) & 0x3fff,
    };
  }

  return null;
}

function buildVp8x(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data[0] = VP8X_EXIF_FLAG;
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return data;
}

function readWebpChunks(webp: Buffer): WebpChunk[] {
  if (
    webp.length < 12 ||
    webp.toString("ascii", 0, 4) !== "RIFF" ||
    webp.toString("ascii", 8, 12) !== "WEBP"
  ) {
    throw new Error("Not a WebP file");
  }

  const chunks: WebpChunk[] = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const fourcc = webp.toString("ascii", offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > webp.length) break;
    chunks.push({ fourcc, data: webp.subarray(start, end) });
    offset = end + (size % 2);
  }
  return chunks;
}

function writeWebpChunks(chunks: WebpChunk[]): Buffer {
  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    const header = Buffer.alloc(8);
    header.write(chunk.fourcc, 0, 4, "ascii");
    header.writeUInt32LE(chunk.data.length, 4);
    parts.push(header, chunk.data);
    if (chunk.data.length % 2 === 1) parts.push(Buffer.from([0]));
  }

  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write("WEBP", 8, 4, "ascii");
  return Buffer.concat([riff, body]);
}

// Adds (or replaces) the WhatsApp sticker metadata chunk and flags it in the
// VP8X header so WhatsApp shows the pack name and author.
export function addStickerExif(webp: Buffer, metadata: StickerExifMetadata): Buffer {
  const chunks = readWebpChunks(webp).filter((chunk) => chunk.fourcc !== "EXIF");

  const vp8x = chunks.find((chunk) => chunk.fourcc === "VP8X");
  if (vp8x && vp8x.data.length > 0) {
    const data = Buffer.from(vp8x.data);
    data[0] = (data[0] ?? 0) | VP8X_EXIF_FLAG;
    vp8x.data = data;
  } else {
    // Simple-format WebP (e.g. an opaque static sticker): promote it to the
    // extended format so the metadata chunk is valid and WhatsApp reads it.
    const size = readCanvasSize(chunks);
    if (size) chunks.unshift({ fourcc: "VP8X", data: buildVp8x(size.width, size.height) });
  }

  chunks.push({ fourcc: "EXIF", data: buildExifPayload(metadata) });
  return writeWebpChunks(chunks);
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
