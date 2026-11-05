import type { Bot } from "grammy";
import { registerCommand } from "../lib/command.js";
import { calculate, chooseOption, flipCoin } from "../lib/quick-tools.js";

export function registerQuickTools(bot: Bot): void {
  registerCommand(bot, "flip", async (ctx) => {
    if (typeof ctx.match === "string" && ctx.match.trim()) {
      await ctx.reply("Gunakan /flip tanpa argumen untuk melempar koin.");
      return;
    }
    await ctx.reply(`Hasil lemparan koin: ${flipCoin()}.`);
  }, { awardXp: false });

  registerCommand(bot, "choose", async (ctx) => {
    const result = chooseOption(typeof ctx.match === "string" ? ctx.match : "");
    if (!result) {
      await ctx.reply("Format: /choose opsi 1 | opsi 2 | ... (2-20 opsi, maksimal 120 karakter per opsi).");
      return;
    }
    await ctx.reply(`Pilihan acak: ${result.choice}`);
  }, { awardXp: false });

  registerCommand(bot, "calc", async (ctx) => {
    const input = typeof ctx.match === "string" ? ctx.match : "";
    const result = calculate(input);
    if (result === null) {
      await ctx.reply("Format: /calc <ekspresi>. Mendukung +, -, *, /, %, ^, dan tanda kurung; hasil dibatasi sampai 1.000.000.000.000.");
      return;
    }
    await ctx.reply(`Hasil: ${Number(result.toPrecision(12))}`);
  }, { awardXp: false });
}
