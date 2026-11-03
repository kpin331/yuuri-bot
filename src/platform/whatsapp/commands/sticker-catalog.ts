import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { isDatabaseReady } from "../../../lib/db.js";
import { parseStickerLabel, removeSticker, upsertWhatsAppSticker, whatsappStickerId } from "../../../lib/sticker-catalog.js";
import { downloadMedia } from "../message.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const stickerAddCommand: WaCommand = {
  name: "stickeradd",
  ownerOnly: true,
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const label = parseStickerLabel(args);
    const source = message.quoted;
    const sticker = source && normalizeMessageContent(source.message)?.stickerMessage;
    if (!label || !source || !sticker) {
      await sendText(replyTo(message), "Balas sebuah stiker dengan $stickeradd <nama> | <deskripsi>. Nama maksimal 40 karakter, deskripsi 240 karakter.");
      return;
    }
    if (!isDatabaseReady()) {
      await sendText(replyTo(message), "Penyimpanan katalog stiker belum siap.");
      return;
    }

    const data = await downloadMedia(source, message.sock);
    if (data.byteLength > 1024 * 1024) {
      await sendText(replyTo(message), "Berkas stiker terlalu besar untuk disimpan di katalog.");
      return;
    }
    const stickerId = whatsappStickerId(source, data);
    if (!stickerId) {
      await sendText(replyTo(message), "Identitas stiker tidak dapat dibaca.");
      return;
    }
    if (!upsertWhatsAppSticker(stickerId, data, label)) {
      await sendText(replyTo(message), "Nama itu sudah dipakai stiker lain di WhatsApp. Pilih nama yang berbeda.");
      return;
    }
    await sendText(replyTo(message), `Stiker “${label.name}” tersimpan untuk WhatsApp.`);
  },
};

export const stickerRemoveCommand: WaCommand = {
  name: "stickerremove",
  ownerOnly: true,
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const name = args.trim();
    if (!name) {
      await sendText(replyTo(message), "Cara pakai: $stickerremove <nama>.");
      return;
    }
    const removed = removeSticker(name);
    await sendText(replyTo(message), removed > 0
      ? `Stiker “${name}” dihapus dari ${removed} platform.`
      : `Stiker “${name}” tidak ditemukan.`);
  },
};
