import type { Bot } from "grammy";
import { parseToggleInput, applyCommandToggle } from "../lib/commandcontrol.js";
import { isAuthorized, isOwner } from "../lib/config.js";
import { registerAdminCommandText } from "../platform/admincommands.js";
import { writeLog } from "../lib/runtime.js";

// Matches the administrative `!<command> on|off` syntax. `!` is not a
// Telegram command prefix, so this is plain-text based and is deliberately not
// affected by the disabled-state check — it is the mechanism that turns
// commands back on.
export function registerCommandControl(bot: Bot): void {
  bot.on("message", async (ctx, next) => {
    const message = ctx.message;
    const text = message.text ?? message.caption;
    if (text === undefined) return next();

    const trimmed = text.trim();
    const ownerToggle = /^\$toggle(?:\s+([\s\S]*))?$/i.exec(trimmed);
    if (ownerToggle) {
      if (!isOwner(ctx.from?.id)) {
        await ctx.reply("🚫 Hanya pemilik bot yang dapat menggunakan $toggle.").catch(() => undefined);
        return;
      }

      const raw = ownerToggle[1] ?? "";
      const parsed = parseToggleInput(raw);
      if (!raw.trim()) {
        await ctx.reply("Cara pakai: $toggle <perintah> on|off").catch(() => undefined);
        return;
      }
      if (!parsed.ok) {
        await ctx.reply(parsed.error.replace("!<perintah> on|off", "$toggle <perintah> on|off")).catch(() => undefined);
        return;
      }

      const result = applyCommandToggle(parsed.command, parsed.state, ctx.from?.id ?? null);
      writeLog("COMMAND", `telegram $toggle ${parsed.command} state=${parsed.state ? "on" : "off"} status=${result.ok ? "success" : "failed"}`);
      await ctx.reply(result.ok ? result.message : result.error).catch(() => undefined);
      return;
    }

    if (!trimmed.startsWith("!")) return next();

    if (await registerAdminCommandText(ctx, trimmed)) return;

    const parsed = parseToggleInput(trimmed.slice(1));
    const authorized = isAuthorized(ctx.from?.id);

    if (!parsed.ok) {
      // Only guide administrators; never spam ordinary chat that happens to
      // start with "!".
      if (authorized) await ctx.reply(parsed.error).catch(() => undefined);
      return;
    }

    if (!authorized) {
      await ctx
        .reply("🚫 Hanya admin dan pemilik bot yang dapat mengubah status perintah.")
        .catch(() => undefined);
      return;
    }

    const result = applyCommandToggle(parsed.command, parsed.state, ctx.from?.id ?? null);
    writeLog("COMMAND", `telegram toggle ${parsed.command} state=${parsed.state ? "on" : "off"} status=${result.ok ? "success" : "failed"}`);
    await ctx.reply(result.ok ? result.message : result.error).catch(() => undefined);
  });
}
