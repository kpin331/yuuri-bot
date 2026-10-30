import type { Bot, Context } from "grammy";
import { isAdmin, isOwner } from "../lib/config.js";
import { quotaPurchaseMessage } from "../lib/quota-economy.js";
import { registerCommand } from "../lib/command.js";

export function registerQuota(bot: Bot): void {
  registerCommand(bot, "quota", async (ctx: Context) => {
    const user = ctx.from;
    if (!user) return;
    const role = isOwner(user.id) ? "owner" : isAdmin(user.id) ? "admin" : "member";
    const response = quotaPurchaseMessage(
      "telegram",
      String(user.id),
      role,
      user.first_name,
      String(ctx.match ?? ""),
      "/",
    );
    await ctx.reply(response);
  });
}
