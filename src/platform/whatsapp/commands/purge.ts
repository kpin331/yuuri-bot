import { purgeSavedMedia } from "../../../lib/runtime.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const purgeCommand: WaCommand = {
  name: "purge",
  ownerOnly: true,
  free: true,
  run: async ({ message }) => {
    const removed = await purgeSavedMedia();
    await sendText(replyTo(message), `Media dibersihkan: ${removed} file dihapus.`);
  },
};
