import type { Bot, Context } from "grammy";
import { registerKnownCommand } from "../lib/command.js";
import { isCommandEnabled } from "../lib/db.js";
import { writeLog } from "../lib/runtime.js";

export function registerDelete(bot: Bot): void {
  registerKnownCommand("d");
  bot.command("d", async (ctx) => {
    const commandMessage = ctx.message;
    const chat = ctx.chat;
    if (!commandMessage || !chat) return;
    const target = commandMessage.reply_to_message;
    if (!target) {
      await ctx.reply("Balas pesan yang ingin dihapus dengan /d.");
      return;
    }
    if (!isCommandEnabled("d")) {
      await ctx.reply("Perintah ini sedang dinonaktifkan.");
      return;
    }

    const isBotMessage = target.from?.id === ctx.me.id;

    if (!isBotMessage) {
      if (chat.type !== "group" && chat.type !== "supergroup") {
        await ctx.reply("Perintah ini hanya bisa menghapus pesan bot di chat pribadi.");
        return;
      }
      const member = await ctx.api.getChatMember(chat.id, ctx.me.id).catch(() => undefined);
      if (member?.status !== "administrator" && member?.status !== "creator") {
        await ctx.reply("Bot ini hanya bisa hapus pesan yang dikirim bot, untuk hapus pesan anggota, jadikan bot ini sebagai admin");
        return;
      }
    }

    await ctx.api.deleteMessage(chat.id, target.message_id);
    writeLog("COMMAND", `telegram /d deleted_message_id=${target.message_id} bot_message=${isBotMessage}`);
  });
}
