import { bankMessage, exchangePointsMessage } from "../../../lib/economy.js";
import { getCommandPrefix } from "../../../lib/config.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const economyCommands: WaCommand[] = [
  {
    name: "tukar",
    free: true,
    run: async ({ message, args }) => {
      await sendText(replyTo(message), exchangePointsMessage(message.userId, args, getCommandPrefix()));
    },
  },
  {
    name: "bank",
    free: true,
    run: async ({ message, args }) => {
      await sendText(replyTo(message), bankMessage(message.userId, args, getCommandPrefix()));
    },
  },
];
