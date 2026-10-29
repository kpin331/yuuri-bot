import type { Bot, Context } from "grammy";
import { bankMessage, exchangePointsMessage } from "../lib/economy.js";
import { registerCommand } from "../lib/command.js";

export function registerEconomy(bot: Bot): void {
  registerCommand(bot, "tukar", async (ctx: Context) => {
    await ctx.reply(exchangePointsMessage(String(ctx.from?.id ?? ""), String(ctx.match ?? ""), "/"));
  });
  registerCommand(bot, "bank", async (ctx: Context) => {
    await ctx.reply(bankMessage(String(ctx.from?.id ?? ""), String(ctx.match ?? ""), "/"));
  });
}
