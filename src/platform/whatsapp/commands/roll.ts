import { getCommandPrefix } from "../../../lib/config.js";
import { rollDice } from "../../../lib/roll.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const rollCommand: WaCommand = {
  name: "roll",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const prefix = getCommandPrefix();
    const result = rollDice(args.trim() || "d6");
    if (!result) {
      await sendText(replyTo(message), `Format: ${prefix}roll [jumlah]d<sisi> (contoh: ${prefix}roll 2d20). Batas 10 dadu, 2-1.000 sisi.`);
      return;
    }

    await sendText(replyTo(message), `🎲 ${result.count}d${result.sides}: ${result.values.join(", ")}\nTotal: ${result.total}`);
  },
};
