import {
  downloadMediaMessage,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  normalizeMessageContent,
  type proto,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { canonicalUserId, resolvePhone } from "./identity.js";
import { logger } from "./logger.js";
import type { IncomingMessage } from "./types.js";

// Pulls the first piece of usable text out of a message: a plain text body or
// the caption of an image/video/document.
export function extractText(message: WAMessage): string {
  const content = normalizeMessageContent(message.message);
  if (!content) return "";
  const raw =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedDisplayText ??
    content.listResponseMessage?.title ??
    "";
  return raw.trim();
}

// The contextInfo that tells us a message is a reply, checking every content
// type that can carry one.
function contextOf(content: proto.IMessage): proto.IContextInfo | null {
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.stickerMessage?.contextInfo ??
    content.buttonsResponseMessage?.contextInfo ??
    content.listResponseMessage?.contextInfo ??
    null
  );
}

// Rebuilds the quoted message as a WAMessage so it can be downloaded or replied
// to. Baileys only hands us the inner content, so we reconstruct a minimal key.
export function extractQuoted(message: WAMessage): WAMessage | null {
  const content = normalizeMessageContent(message.message);
  if (!content) return null;

  const context = contextOf(content);
  const quoted = context?.quotedMessage;
  const stanzaId = context?.stanzaId;
  if (!quoted || !stanzaId) return null;

  return {
    key: {
      remoteJid: message.key.remoteJid ?? undefined,
      id: stanzaId,
      participant: context?.participant ?? undefined,
      fromMe: false,
    },
    message: quoted,
  };
}

// Turns a raw Baileys message into the normalized form used by the command
// layer, or null when it is not an ordinary user message we should handle
// (broadcasts, status updates, our own messages, empty content).
export function extractIncoming(sock: WASocket, message: WAMessage): IncomingMessage | null {
  const key = message.key;
  const remote = key.remoteJid;
  if (!remote) return null;
  if (key.fromMe) return null;
  if (isJidBroadcast(remote) || isJidStatusBroadcast(remote) || isJidNewsletter(remote)) {
    return null;
  }
  if (!message.message) return null;

  const isGroup = isJidGroup(remote) === true;
  const senderJid = (isGroup ? key.participant : remote) ?? remote;
  const senderAlt = (isGroup ? key.participantAlt : key.remoteJidAlt) ?? null;

  const userId = canonicalUserId(senderJid, senderAlt);
  if (!userId) return null;

  return {
    sock,
    chatId: remote,
    isGroup,
    senderJid,
    senderAlt,
    userId,
    phone: resolvePhone(senderJid, senderAlt),
    name: message.pushName?.trim() || null,
    text: extractText(message),
    message,
    quoted: extractQuoted(message),
  };
}

export type MediaSourceKind = "image" | "video";

export interface MediaSource {
  kind: MediaSourceKind;
  ext: string;
}

// Describes the media on a message so the sticker commands know how to convert
// it: a still image, a video, or a static/animated sticker.
export function mediaSourceOf(message: WAMessage): MediaSource | null {
  const content = normalizeMessageContent(message.message);
  if (!content) return null;
  if (content.imageMessage) return { kind: "image", ext: ".jpg" };
  if (content.videoMessage) return { kind: "video", ext: ".mp4" };
  if (content.stickerMessage) {
    return content.stickerMessage.isAnimated
      ? { kind: "video", ext: ".webm" }
      : { kind: "image", ext: ".webp" };
  }
  const doc = content.documentMessage;
  if (doc) {
    const mime = doc.mimetype ?? "";
    if (mime.startsWith("video/")) return { kind: "video", ext: ".mp4" };
    if (mime.startsWith("image/")) return { kind: "image", ext: ".jpg" };
  }
  return null;
}

export function isStickerMessage(message: WAMessage): boolean {
  const content = normalizeMessageContent(message.message);
  return content?.stickerMessage !== undefined && content.stickerMessage !== null;
}

// Downloads (and decrypts) the media attached to a message into a buffer.
export function downloadMedia(message: WAMessage, sock: WASocket): Promise<Buffer> {
  return downloadMediaMessage(
    message,
    "buffer",
    {},
    { logger, reuploadRequest: sock.updateMediaMessage },
  );
}
