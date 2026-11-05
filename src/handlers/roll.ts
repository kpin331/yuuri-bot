import type { Bot } from "grammy";
import { registerCommand } from "../lib/command.js";
import { rollDice } from "../lib/roll.js";

const USAGE = "Format: /roll [jumlah]d<sisi> (contoh: /roll 2d20). Batas 10 dadu, 2-1.000 sisi.";

export function registerRoll(bot: Bot): void {
  registerCommand(bot, "roll", async (ctx) => {
    const input = typeof ctx.match === "string" ? ctx.match.trim() : "";
    const result = rollDice(input || "d6");
    if (!result) {
      await ctx.reply(USAGE);
      return;
    }

    await ctx.reply(`🎲 ${result.count}d${result.sides}: ${result.values.join(", ")}\nTotal: ${result.total}`);
  }, { awardXp: false });
}
