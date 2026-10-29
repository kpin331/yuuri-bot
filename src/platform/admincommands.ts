import type { Bot, Context } from "grammy";
import { isOwner } from "../lib/config.js";
import { writeLog } from "../lib/runtime.js";
import { registerKnownCommand } from "../lib/command.js";
import { isCommandEnabled } from "../lib/db.js";
import { formatSystemDiagnostics, getSystemDiagnostics, splitStatusMessage } from "../lib/system-status.js";

function isGroup(chatType: string | undefined): boolean {
  return chatType === "group" || chatType === "supergroup";
}

async function isTelegramGroupAdmin(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (chatId === undefined || userId === undefined || !isGroup(ctx.chat?.type)) return false;
  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch (error) {
    writeLog("WARN", "telegram group admin lookup failed");
    return false;
  }
}

export async function registerAdminCommandText(ctx: Context, text: string): Promise<boolean> {
  const match = /^!(ping|groupinfo)$/i.exec(text);
  if (!match) return false;
  const name = (match[1] ?? "").toLowerCase();
  const owner = isOwner(ctx.from?.id);
  const allowed = owner || (await isTelegramGroupAdmin(ctx));
  if (!allowed) {
    if (ctx.chat && isGroup(ctx.chat.type)) await ctx.reply("🚫 Perintah ini hanya untuk admin grup dan pemilik bot.");
    return true;
  }
  if (!isCommandEnabled(name)) {
    await ctx.reply("⚠️ Perintah ini sedang dinonaktifkan.");
    return true;
  }

  const chat = ctx.chat;
  if (!chat) return true;
  if (name === "groupinfo" && !isGroup(chat.type)) {
    await ctx.reply("Perintah ini hanya dapat digunakan di grup.");
    return true;
  }

  if (name === "ping") {
    const elapsedMs = Math.max(0, Date.now() - (ctx.message?.date ?? Math.floor(Date.now() / 1000)) * 1000);
    const diagnostics = await getSystemDiagnostics();
    for (const chunk of splitStatusMessage(formatSystemDiagnostics(elapsedMs, diagnostics))) {
      await ctx.reply(chunk);
    }
    writeLog("COMMAND", `telegram ping status=success`);
    return true;
  }

  const title = "title" in chat ? chat.title : undefined;
  const description = await ctx.api.getChat(chat.id).then((info) => info.description).catch(() => undefined);
  const count = await ctx.api.getChatMemberCount(chat.id).catch(() => undefined);
  const lines = ["Info grup", `Nama: ${title ?? "tidak tersedia"}`, `ID: ${chat.id}`];
  if (typeof count === "number") lines.push(`Anggota: ${count}`);
  if (description) lines.push(`Deskripsi: ${description}`);
  await ctx.reply(lines.join("\n"));
  writeLog("COMMAND", "telegram groupinfo status=success");
  return true;
}

export function registerAdminCommands(bot: Bot): void {
  registerKnownCommand("ping");
  registerKnownCommand("groupinfo");
  bot.on("message", async (ctx, next) => {
    const text = (ctx.message.text ?? ctx.message.caption ?? "").trim();
    if (!(await registerAdminCommandText(ctx, text))) return next();
  });
}

