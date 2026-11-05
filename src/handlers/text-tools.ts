import type { Bot } from "grammy";
import { getTimezone } from "../lib/config.js";
import { registerCommand } from "../lib/command.js";
import { convertBase64, createUuid, currentTime, sha256, splitModeInput } from "../lib/text-tools.js";

export function registerTextTools(bot: Bot): void {
  registerCommand(bot, "time", async (ctx) => {
    const timezone = getTimezone();
    const value = currentTime(timezone);
    await ctx.reply(value ? `Waktu (${timezone}): ${value}` : "Zona waktu di konfigurasi tidak valid.");
  }, { awardXp: false });

  registerCommand(bot, "uuid", async (ctx) => {
    if (typeof ctx.match === "string" && ctx.match.trim()) {
      await ctx.reply("Gunakan /uuid tanpa argumen untuk membuat UUID.");
      return;
    }
    await ctx.reply(createUuid());
  }, { awardXp: false });

  registerCommand(bot, "hash", async (ctx) => {
    const result = sha256(typeof ctx.match === "string" ? ctx.match : "");
    await ctx.reply(result ? `SHA-256: ${result}` : "Format: /hash <teks> (maksimal 10.000 karakter).");
  }, { awardXp: false });

  registerCommand(bot, "base64", async (ctx) => {
    const input = typeof ctx.match === "string" ? ctx.match : "";
    const parsed = splitModeInput(input);
    const result = parsed ? convertBase64(parsed.mode, parsed.text) : null;
    if (result === null) {
      await ctx.reply("Format: /base64 encode|decode <teks>. Batas data 2.900 byte; hasil decode harus UTF-8.");
      return;
    }
    await ctx.reply(result);
  }, { awardXp: false });
}
