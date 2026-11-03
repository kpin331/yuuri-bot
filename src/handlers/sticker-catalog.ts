import type { Bot, Context } from "grammy";
import { registerOwnerCommand } from "../lib/command.js";
import { isDatabaseReady } from "../lib/db.js";
import { parseStickerLabel, removeSticker, upsertTelegramSticker } from "../lib/sticker-catalog.js";

function stickerUsage(): string {
  return "Balas sebuah stiker dengan $stickeradd <nama> | <deskripsi>. Nama maksimal 40 karakter, deskripsi 240 karakter.";
}

async function addSticker(ctx: Context): Promise<void> {
  const label = parseStickerLabel(String(ctx.match ?? ""));
  const sticker = ctx.message?.reply_to_message?.sticker;
  if (!label || !sticker) {
    await ctx.reply(stickerUsage());
    return;
  }
  if (!isDatabaseReady()) {
    await ctx.reply("Penyimpanan katalog stiker belum siap.");
    return;
  }
  if (!upsertTelegramSticker(sticker.file_unique_id, sticker.file_id, label)) {
    await ctx.reply("Nama itu sudah dipakai stiker lain di Telegram. Pilih nama yang berbeda.");
    return;
  }
  await ctx.reply(`Stiker “${label.name}” tersimpan untuk Telegram.`);
}

async function removeStickerCommand(ctx: Context): Promise<void> {
  const name = String(ctx.match ?? "").trim();
  if (!name) {
    await ctx.reply("Cara pakai: $stickerremove <nama>.");
    return;
  }
  const removed = removeSticker(name);
  await ctx.reply(removed > 0
    ? `Stiker “${name}” dihapus dari ${removed} platform.`
    : `Stiker “${name}” tidak ditemukan.`);
}

export function registerStickerCatalog(bot: Bot): void {
  registerOwnerCommand(bot, "stickeradd", addSticker);
  registerOwnerCommand(bot, "stickerremove", removeStickerCommand);
}
