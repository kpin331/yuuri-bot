import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { detectPlatform, extractUrl, type Platform } from "./downloader.js";
import { exec } from "./exec.js";
import type { MediaFile } from "./media.js";
import { TOOLS } from "./tools.js";

export function parseWaDownload(text: string, quoted: string, platform: Platform | null) {
  const url = extractUrl(text) ?? extractUrl(quoted);
  const resolved = platform ?? (url ? detectPlatform(url) : "auto");
  const beforeUrl = text.split(/https?:\/\//i)[0] ?? text;
  const hd = /(?:^|\s)-hd(?=\s|$)/i.test(beforeUrl);
  return { url, platform: resolved, resolution: resolved === "fb" || resolved === "ig" ? (hd ? 1080 : 720) : null };
}

interface Stream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

function frameRate(value?: string): number {
  const [n, d = 1] = (value ?? "").split("/").map(Number);
  return n && d ? n / d : 0;
}

function compatible(video: Stream, resolution: number): boolean {
  const width = video.width ?? 0;
  const height = video.height ?? 0;
  const fps = Math.max(frameRate(video.avg_frame_rate), frameRate(video.r_frame_rate));
  return video.codec_name === "h264" && video.pix_fmt === "yuv420p"
    && width > 0 && height > 0 && width % 2 === 0 && height % 2 === 0
    && Math.min(width, height) <= resolution && Math.max(width, height) <= resolution * 16 / 9
    && fps > 0 && fps <= 30;
}

export async function normalizeWaDownloadVideo(
  file: MediaFile,
  dir: string,
  resolution: number,
  run = exec,
): Promise<MediaFile> {
  async function probe(path: string): Promise<Stream[]> {
    const result = await run(TOOLS.ffprobe, ["-v", "error", "-show_streams", "-of", "json", path], { timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error("Video tidak dapat diperiksa.");
    const data = JSON.parse(result.stdout) as { streams?: Stream[] };
    if (!Array.isArray(data.streams)) throw new Error("Informasi video tidak tersedia.");
    return data.streams;
  }

  const streams = await probe(file.path);
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("File tidak memiliki video.");
  const copyVideo = compatible(video, resolution);
  const longEdge = Math.floor(resolution * 16 / 9);
  const scale = `scale=w='if(gte(iw,ih),min(iw,${longEdge}),min(iw,${resolution}))':h='if(gte(iw,ih),min(ih,${resolution}),min(ih,${longEdge}))':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const output = join(dir, `wa-${randomUUID()}.mp4`);
  const result = await run(TOOLS.ffmpeg, [
    "-nostdin", "-y", "-v", "error", "-i", file.path,
    "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
    ...(copyVideo ? ["-c:v", "copy"] : [
      "-vf", `${scale},format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-fpsmax", "30", "-maxrate", resolution === 1080 ? "8M" : "5M", "-bufsize", "10M",
    ]),
    ...(audio?.codec_name === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "128k", "-ac", "2"]),
    "-movflags", "+faststart", output,
  ], { timeoutMs: 5 * 60_000 });
  if (result.code !== 0) throw new Error("Konversi video gagal.");
  const verified = await probe(output);
  const outputVideo = verified.find((s) => s.codec_type === "video");
  if (!outputVideo || !compatible(outputVideo, resolution)
    || verified.some((s) => s.codec_type === "audio" && s.codec_name !== "aac")
    || (audio && !verified.some((s) => s.codec_type === "audio"))) {
    throw new Error("Hasil konversi video tidak sesuai format.");
  }
  const size = (await stat(output)).size;
  if (size === 0) throw new Error("Hasil konversi video kosong.");
  return { ...file, path: output, name: `${basename(file.name, extname(file.name))}.mp4`, size };
}
