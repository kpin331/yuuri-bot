import { quotaPurchaseMessage } from "../../../lib/quota-economy.js";
import { getCommandPrefix } from "../../../lib/config.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const quotaCommand: WaCommand = {
  name: "quota",
  free: true,
  run: async ({ message, args, role }) => {
    const response = quotaPurchaseMessage("whatsapp", message.userId, role, message.name, args, getCommandPrefix());
    await sendText(replyTo(message), response);
  },
};
