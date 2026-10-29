import type { Bot } from "grammy";
import { formatCommandHelp } from "../lib/command-help.js";
import { registerCommand } from "../lib/command.js";

export function registerCommandHelp(bot: Bot): void {
  registerCommand(bot, "cara_pakai", async (ctx) => {
    const target = typeof ctx.match === "string" ? ctx.match : "";
    await ctx.reply(formatCommandHelp(target, "telegram", "/"));
  });
}
