import { formatCommandHelp } from "../../../lib/command-help.js";
import { getCommandPrefix } from "../../../lib/config.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const commandHelpCommand: WaCommand = {
  name: "cara-pakai",
  aliases: ["cara_pakai"],
  free: true,
  run: async ({ message, args }) => {
    await sendText(replyTo(message), formatCommandHelp(args, "whatsapp", getCommandPrefix()));
  },
};
