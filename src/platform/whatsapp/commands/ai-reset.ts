import { resetGeminiHistory } from "../../../lib/gemini-chat.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const aiResetCommand: WaCommand = {
  name: "aireset",
  ownerOnly: true,
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const scope = args.trim().toLowerCase();
    if (scope !== "global" && scope !== "private") {
      await sendText(replyTo(message), "Cara pakai: $aireset global atau $aireset private.");
      return;
    }
    if (scope === "private" && message.isGroup) {
      await sendText(replyTo(message), "Mode private hanya bisa dipakai di chat pribadi dengan bot.");
      return;
    }
    if (scope === "global") {
      await resetGeminiHistory("global");
      await sendText(replyTo(message), "Riwayat AI global sudah direset.");
      return;
    }

    await resetGeminiHistory("private", "whatsapp", message.userId, message.chatId);
    await sendText(replyTo(message), "Riwayat AI pribadi di WhatsApp sudah direset.");
  },
};
