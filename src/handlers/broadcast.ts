import type { Bot, Context } from "grammy";
import { registerOwnerCommand } from "../lib/command.js";
import { getAllowedTelegramGroupIds } from "../lib/config.js";

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function broadcast(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("$bc hanya dapat digunakan di chat pribadi dengan bot.");
    return;
  }
  const source = ctx.message?.reply_to_message;
  const text = String(ctx.match ?? "").trim();
  if (source && source.from?.id !== ctx.from?.id) {
    await ctx.reply("Balas pesan milikmu sendiri untuk meneruskannya, atau kirim $bc <pesan>.");
    return;
  }
  if (!source && !text) {
    await ctx.reply("Cara pakai: $bc <pesan> atau balas pesanmu dengan $bc.");
    return;
  }

  const targets = getAllowedTelegramGroupIds();
  await ctx.reply(`Broadcast dimulai ke ${targets.length} grup Telegram dari ALLOWED_GROUPS.`);
  let sent = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      if (source && ctx.chat) {
        await ctx.api.forwardMessage(Number(target), ctx.chat.id, source.message_id);
      } else {
        await ctx.api.sendMessage(Number(target), text);
      }
      sent += 1;
    } catch {
      failed += 1;
    }
    await wait(40);
  }
  await ctx.reply(`Broadcast ke grup Telegram selesai. Terkirim: ${sent}; gagal: ${failed}.`);
}

export function registerBroadcast(bot: Bot): void {
  registerOwnerCommand(bot, "bc", broadcast);
  registerOwnerCommand(bot, "broadcast", broadcast);
}
