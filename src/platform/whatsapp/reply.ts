import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { AnyMessageContent, WASocket, WAMessage } from "@whiskeysockets/baileys";
import type { MediaFile } from "../../lib/media.js";
import type { IncomingMessage } from "./types.js";

// Everything needed to answer a message: the socket, where to send, and the
// message to quote so replies stay threaded.
export interface ReplyTarget {
  sock: WASocket;
  jid: string;
  quoted?: WAMessage | null;
}

// Builds a ReplyTarget that quotes the message being answered.
export function replyTo(message: IncomingMessage): ReplyTarget {
  return { sock: message.sock, jid: message.chatId, quoted: message.message };
}

async function send(target: ReplyTarget, content: AnyMessageContent): Promise<void> {
  await target.sock.sendMessage(
    target.jid,
    content,
    target.quoted ? { quoted: target.quoted } : {},
  );
}

export function sendText(target: ReplyTarget, text: string): Promise<void> {
  return send(target, { text });
}

export function sendImage(target: ReplyTarget, image: Buffer, caption?: string): Promise<void> {
  return send(target, caption ? { image, caption } : { image });
}

export function sendVideo(target: ReplyTarget, video: Buffer, caption?: string): Promise<void> {
  return send(target, caption ? { video, caption } : { video });
}

export function sendAudio(target: ReplyTarget, audio: Buffer, seconds?: number): Promise<void> {
  const content: AnyMessageContent = {
    audio,
    mimetype: "audio/mp4",
    ptt: false,
    ...(seconds !== undefined ? { seconds } : {}),
  };
  return send(target, content);
}

export function sendSticker(target: ReplyTarget, sticker: Buffer): Promise<void> {
  return send(target, { sticker });
}

export function sendDocument(
  target: ReplyTarget,
  document: Buffer,
  fileName: string,
  caption?: string,
): Promise<void> {
  const mimetype = guessMime(fileName);
  return send(target, {
    document,
    mimetype,
    fileName,
    ...(caption ? { caption } : {}),
  });
}

// Formats WhatsApp renders as an inline photo/video. Anything else (e.g. an
// HEIC image or an MKV video) is sent as a document so it still arrives.
const INLINE_IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const INLINE_VIDEO = new Set([".mp4", ".mov", ".m4v", ".3gp"]);

// Sends a downloaded media file (photo or video) as a native WhatsApp message,
// falling back to a document when the extension is not an image/video WhatsApp
// renders inline.
export async function sendMediaFile(
  target: ReplyTarget,
  file: MediaFile,
  caption?: string,
): Promise<void> {
  const buffer = await readFile(file.path);
  const ext = extname(file.path).toLowerCase();
  if (file.kind === "photo" && INLINE_IMAGE.has(ext)) {
    await sendImage(target, buffer, caption);
  } else if (file.kind === "video" && INLINE_VIDEO.has(ext)) {
    await sendVideo(target, buffer, caption);
  } else {
    await sendDocument(target, buffer, file.name, caption);
  }
}

function guessMime(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".m4a":
      return "audio/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
