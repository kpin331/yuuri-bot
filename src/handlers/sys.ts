import type { Bot, Context } from "grammy";
import { registerOwnerCommand } from "../lib/command.js";
import { buildSystemReport } from "../lib/system.js";

export function registerSys(bot: Bot): void {
  registerOwnerCommand(bot, "sys", async (ctx: Context) => {
    const report = await buildSystemReport();
    await ctx.reply(report, { parse_mode: "HTML" });
  });
}
