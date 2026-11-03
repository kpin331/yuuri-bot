import { createHash } from "node:crypto";
import { normalizeMessageContent, type WAMessage } from "@whiskeysockets/baileys";
import {
  getStickerCatalogEntry,
  listStickerCatalog,
  removeStickerCatalogEntry,
  saveStickerCatalogEntry,
  type StickerCatalogEntry,
} from "./db.js";

export interface StickerLabel {
  name: string;
  description: string;
}

export function parseStickerLabel(input: string): StickerLabel | null {
  const separator = input.indexOf("|");
  if (separator < 0) return null;
  const name = input.slice(0, separator).trim();
  const description = input.slice(separator + 1).trim();
  if (!name || !description || name.length > 40 || description.length > 240) return null;
  return { name, description };
}

export function telegramStickerId(uniqueId: string): string {
  return uniqueId;
}

export function whatsappStickerId(message: WAMessage, downloaded?: Uint8Array): string | null {
  const sticker = normalizeMessageContent(message.message)?.stickerMessage;
  if (!sticker) return null;
  const hash = sticker.fileSha256
    ? Buffer.from(sticker.fileSha256).toString("base64url")
    : downloaded
      ? createHash("sha256").update(downloaded).digest("base64url")
      : null;
  return hash;
}

export function upsertTelegramSticker(
  stickerId: string,
  fileId: string,
  label: StickerLabel,
): boolean {
  return saveStickerCatalogEntry({
    platform: "telegram",
    stickerId,
    name: label.name,
    description: label.description,
    telegramFileId: fileId,
    stickerData: null,
  });
}

export function upsertWhatsAppSticker(
  stickerId: string,
  media: Uint8Array,
  label: StickerLabel,
): boolean {
  return saveStickerCatalogEntry({
    platform: "whatsapp",
    stickerId,
    name: label.name,
    description: label.description,
    telegramFileId: null,
    stickerData: media,
  });
}

export function findCatalogSticker(
  platform: StickerCatalogEntry["platform"],
  stickerId: string,
): StickerCatalogEntry | null {
  return getStickerCatalogEntry(platform, stickerId);
}

export function getStickerOptions(platform: StickerCatalogEntry["platform"]): StickerLabel[] {
  return listStickerCatalog(platform).map(({ name, description }) => ({ name, description }));
}

export function getStickerForName(
  platform: StickerCatalogEntry["platform"],
  name: string,
): StickerCatalogEntry | null {
  return listStickerCatalog(platform).find((entry) => entry.name === name) ?? null;
}

export function removeSticker(name: string): number {
  return removeStickerCatalogEntry(name);
}

interface PendingStickerExplanation {
  expiresAt: number;
}

const pendingExplanations = new Map<string, PendingStickerExplanation>();
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 1000;

function pendingKey(platform: StickerCatalogEntry["platform"], chatId: string, userId: string): string {
  return `${platform}:${chatId}:${userId}`;
}

export function requestStickerExplanation(
  platform: StickerCatalogEntry["platform"],
  chatId: string,
  userId: string,
  now: number = Date.now(),
): void {
  const key = pendingKey(platform, chatId, userId);
  if (!pendingExplanations.has(key) && pendingExplanations.size >= MAX_PENDING) {
    const oldest = pendingExplanations.keys().next().value;
    if (oldest !== undefined) pendingExplanations.delete(oldest);
  }
  pendingExplanations.delete(key);
  pendingExplanations.set(key, { expiresAt: now + PENDING_TTL_MS });
}

export function consumeStickerExplanation(
  platform: StickerCatalogEntry["platform"],
  chatId: string,
  userId: string,
  now: number = Date.now(),
): boolean {
  const key = pendingKey(platform, chatId, userId);
  const pending = pendingExplanations.get(key);
  if (!pending) return false;
  pendingExplanations.delete(key);
  return pending.expiresAt > now;
}
