import type { Bot } from "grammy";
import { registerCommand } from "../lib/command.js";
import { handleRpg } from "../lib/rpg-storage.js";

export function registerRpg(bot: Bot): void {
  registerCommand(bot, "rpg", async ctx => {
    if (!ctx.from || !ctx.chat || !ctx.message) return;
    await ctx.reply(handleRpg("telegram", String(ctx.from.id), typeof ctx.match === "string" ? ctx.match : "", "/", `${ctx.chat.id}:${ctx.message.message_id}`));
  }, { awardXp: false });
}
