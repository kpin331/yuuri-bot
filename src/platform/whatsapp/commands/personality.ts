import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { addPersonality, listPersonalities, switchPersonality } from "../../../lib/personality.js";
import { resetGeminiHistory } from "../../../lib/gemini-chat.js";
import { downloadMedia } from "../message.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

const MAX_MARKDOWN_BYTES = 32 * 1024;

export const addPersonalityCommand: WaCommand = {
  name: "add-personality",
  ownerOnly: true,
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const separator = args.indexOf("|");
    let name: string;
    let instructions: string;
    if (separator >= 0) {
      name = args.slice(0, separator).trim();
      instructions = args.slice(separator + 1).trim();
    } else {
      name = args.trim();
      const document = message.quoted && normalizeMessageContent(message.quoted.message)?.documentMessage;
      if (!document || !document.fileName?.toLowerCase().endsWith(".md")) {
        await sendText(replyTo(message), "Balas file .md dengan $add-personality <nama>, atau gunakan $add-personality <nama> | <instruksi>.");
        return;
      }
      if (document.fileLength && Number(document.fileLength) > MAX_MARKDOWN_BYTES) {
        await sendText(replyTo(message), "File .md maksimal 32 KB.");
        return;
      }
      try {
        const data = await downloadMedia(message.quoted!, message.sock);
        if (data.byteLength > MAX_MARKDOWN_BYTES) {
          await sendText(replyTo(message), "File .md maksimal 32 KB.");
          return;
        }
        instructions = data.toString("utf8");
      } catch (error) {
        console.error("Gagal membaca file persona WhatsApp:", error);
        await sendText(replyTo(message), "File .md gagal dibaca. Coba kirim ulang, ya.");
        return;
      }
    }
    if (!name || !instructions) {
      await sendText(replyTo(message), "Cara pakai: $add-personality <nama> | <instruksi>, atau balas file .md dengan $add-personality <nama>.");
      return;
    }
    const result = await addPersonality(name, instructions);
    await sendText(replyTo(message), result.ok
      ? `Persona “${result.personality.name}” tersimpan. Aktifkan dengan $switch-personality ${result.personality.name}.`
      : result.error);
  },
};

export const switchPersonalityCommand: WaCommand = {
  name: "switch-personality",
  ownerOnly: true,
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const result = await switchPersonality(args);
    if (!result.ok) {
      const names = (await listPersonalities()).map(({ name }) => name).join(", ") || "belum ada";
      await sendText(replyTo(message), `${result.error}\nPersona tersedia: ${names}.`);
      return;
    }
    await resetGeminiHistory("global");
    await sendText(replyTo(message), `Persona “${result.personality.name}” aktif. Riwayat AI semua chat sudah direset.`);
  },
};
