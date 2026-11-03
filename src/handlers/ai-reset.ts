import type { Bot, Context } from "grammy";
import { registerOwnerCommand } from "../lib/command.js";
import { resetGeminiHistory } from "../lib/gemini-chat.js";

async function resetAi(ctx: Context): Promise<void> {
  const scope = String(ctx.match ?? "").trim().toLowerCase();
  if (scope !== "global" && scope !== "private") {
    await ctx.reply("Cara pakai: $aireset global atau $aireset private.");
    return;
  }
  if (scope === "private" && ctx.chat?.type !== "private") {
    await ctx.reply("Mode private hanya bisa dipakai di chat pribadi dengan bot.");
    return;
  }

  if (scope === "global") {
    await resetGeminiHistory("global");
    await ctx.reply("Riwayat AI global sudah direset.");
    return;
  }

  if (!ctx.chat || !ctx.from) return;
  await resetGeminiHistory("private", "telegram", String(ctx.from.id), String(ctx.chat.id));
  await ctx.reply("Riwayat AI pribadi di Telegram sudah direset.");
}

export function registerAiReset(bot: Bot): void {
  registerOwnerCommand(bot, "aireset", resetAi);
}
