import type { Bot } from "grammy";
import { parseToggleInput, applyCommandToggle } from "../lib/commandcontrol.js";
import { isAuthorized } from "../lib/config.js";

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
    if (!trimmed.startsWith("!")) return next();

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
        .reply("🚫 Only admins and the owner can change command states.")
        .catch(() => undefined);
      return;
    }

    const result = applyCommandToggle(parsed.command, parsed.state, ctx.from?.id ?? null);
    await ctx.reply(result.ok ? result.message : result.error).catch(() => undefined);
  });
}
