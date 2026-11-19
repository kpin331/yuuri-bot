import { getDb } from "./db.js";

export function isPixivNsfwEnabled(): boolean {
  return getDb()?.prepare("SELECT value FROM bot_settings WHERE name = ?").get("pixiv_nsfw")?.value === "true";
}

export function setPixivNsfw(enabled: boolean): boolean {
  const db = getDb();
  if (!db) return false;
  db.prepare("INSERT INTO bot_settings(name, value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value")
    .run("pixiv_nsfw", String(enabled));
  return true;
}

export function isPixivSettingInput(raw: string): boolean {
  return /^nsfw(?:\s|$)/i.test(raw.trim());
}

export function pixivSettingReply(raw: string): string | null {
  if (!isPixivSettingInput(raw)) return null;
  if (!/^nsfw\s+(true|false)$/i.test(raw)) return "Cara pakai: !pixiv nsfw true|false";
  const enabled = /true$/i.test(raw);
  if (!setPixivNsfw(enabled)) return "Penyimpanan belum siap. Pengaturan Pixiv belum diubah.";
  return `Mode NSFW Pixiv ${enabled ? "aktif" : "nonaktif (hanya SFW)"}.`;
}
