import type { Bot, Context } from "grammy";
import { registerOwnerCommand } from "../lib/command.js";
import { addPersonality, listPersonalities, switchPersonality } from "../lib/personality.js";
import { resetGeminiHistory } from "../lib/gemini-chat.js";

const MAX_MARKDOWN_BYTES = 32 * 1024;

async function readRepliedMarkdown(ctx: Context): Promise<string | null> {
  const document = ctx.message?.reply_to_message?.document;
  if (!document || !document.file_name?.toLowerCase().endsWith(".md")) return null;
  if (document.file_size && document.file_size > MAX_MARKDOWN_BYTES) throw new Error("File .md maksimal 32 KB.");

  const file = await ctx.api.getFile(document.file_id);
  if (!file.file_path) throw new Error("File Telegram tidak memiliki path unduhan.");
  const response = await fetch(`https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`);
  if (!response.ok) throw new Error(`Unduhan file .md gagal (${response.status}).`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > MAX_MARKDOWN_BYTES) throw new Error("File .md maksimal 32 KB.");
  return Buffer.from(data).toString("utf8");
}

async function addTelegramPersonality(ctx: Context): Promise<void> {
  const input = String(ctx.match ?? "").trim();
  const separator = input.indexOf("|");
  let name: string;
  let instructions: string;
  if (separator >= 0) {
    name = input.slice(0, separator).trim();
    instructions = input.slice(separator + 1).trim();
  } else {
    name = input;
    try {
      instructions = await readRepliedMarkdown(ctx) ?? "";
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : "File .md gagal dibaca.");
      return;
    }
  }
  if (!name || !instructions) {
    await ctx.reply("Cara pakai: $add-personality <nama> | <instruksi>, atau balas file .md dengan $add-personality <nama>.");
    return;
  }

  const result = await addPersonality(name, instructions);
  await ctx.reply(result.ok
    ? `Persona “${result.personality.name}” tersimpan. Aktifkan dengan $switch-personality ${result.personality.name}.`
    : result.error);
}

async function switchTelegramPersonality(ctx: Context): Promise<void> {
  const result = await switchPersonality(String(ctx.match ?? ""));
  if (!result.ok) {
    await ctx.reply(`${result.error}\nPersona tersedia: ${(await listPersonalities()).map(({ name }) => name).join(", ") || "belum ada"}.`);
    return;
  }
  await resetGeminiHistory("global");
  await ctx.reply(`Persona “${result.personality.name}” aktif. Riwayat AI semua chat sudah direset.`);
}

export function registerPersonalityCommands(bot: Bot): void {
  registerOwnerCommand(bot, "add-personality", addTelegramPersonality);
  registerOwnerCommand(bot, "switch-personality", switchTelegramPersonality);
}
