import type { Bot, Context } from "grammy";
import { registerOwnerCommand } from "../lib/command.js";
import { purgeSavedMedia } from "../lib/runtime.js";

export function registerPurge(bot: Bot): void {
  registerOwnerCommand(bot, "purge", async (ctx: Context) => {
    const removed = await purgeSavedMedia();
    await ctx.reply(`Media dibersihkan: ${removed} file dihapus.`);
  });
}
