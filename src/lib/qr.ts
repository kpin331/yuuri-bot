import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { exec } from "./exec.js";
import { TOOLS } from "./tools.js";

// QR generation goes through the qrcode package. The image is a PNG because
// Telegram and WhatsApp both accept it without conversion.
export function generateQr(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    margin: 2,
    scale: 8,
    errorCorrectionLevel: "M",
  });
}

// Decodes one QR code from any image. ffmpeg converts the input (jpg, webp,
// sticker, whatever) to plain PNG first, since pngjs only reads PNG; when the
// first pass finds nothing we retry on a 3x upscale, which rescues small or
// distant codes.
export async function decodeQr(inputPath: string): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "qr-decode-"));
  try {
    const firstPass = join(dir, "pass1.png");
    if (!(await convertToPng(inputPath, firstPass))) return null;

    const direct = readQrFromPng(firstPass);
    if (direct !== null) return direct;

    const upscaled = join(dir, "pass2.png");
    if (!(await convertToPng(inputPath, upscaled, 3))) return null;
    return readQrFromPng(upscaled);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function convertToPng(
  inputPath: string,
  outputPath: string,
  scale = 1,
): Promise<boolean> {
  const args = ["-y", "-i", inputPath];
  if (scale > 1) args.push("-vf", `scale=iw*${scale}:ih*${scale}:flags=lanczos`);
  args.push("-frames:v", "1", outputPath);

  try {
    const { code } = await exec(TOOLS.ffmpeg, args, { timeoutMs: 30_000 });
    return code === 0;
  } catch {
    return false;
  }
}

// PNG.sync.read is synchronous, so the file read has to be too.
function readQrFromPng(path: string): string | null {
  try {
    const png = PNG.sync.read(readFileSync(path));
    const pixels = new Uint8ClampedArray(
      png.data.buffer,
      png.data.byteOffset,
      png.data.length,
    );
    const result = jsQR.default(pixels, png.width, png.height);
    return result && result.data.length > 0 ? result.data : null;
  } catch {
    return null;
  }
}
