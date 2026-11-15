import { getCommandPrefix } from "../../../lib/config.js";
import { handleRpg } from "../../../lib/rpg-storage.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const rpgCommand: WaCommand = {
  name: "rpg",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const id = message.message.key.id;
    if (!id) return;
    await sendText(replyTo(message), handleRpg("whatsapp", message.userId, args, getCommandPrefix(), `${message.chatId}:${id}`));
  },
};
