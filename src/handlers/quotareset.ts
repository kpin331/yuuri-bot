import type { Bot, Context } from "grammy";
import { resetAllQuotas, type QuotaResetEntry } from "../core/access.js";
import { escapeHtml } from "../lib/info.js";
import { registerOwnerSlashCommand } from "../lib/command.js";

const PLATFORM_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

function labelFor(entry: QuotaResetEntry): string {
  return PLATFORM_LABELS[entry.platform] ?? entry.platform;
}

function describe(entry: QuotaResetEntry): string {
  const name = entry.displayName ?? entry.userId;
  return (
    `• <b>${escapeHtml(name)}</b> ` +
    `(<code>${escapeHtml(entry.userId)}</code>, ${labelFor(entry)}): ` +
    `<code>${entry.before} → ${entry.after}</code> (+${Math.abs(entry.restored)} restored)`
  );
}

// Owner-only maintenance command. Quotas live in the shared SQLite database and
// are only consumed by the WhatsApp side, so resetting here frees every user's
// daily allowance at once instead of waiting for the midnight reset.
export function registerQuotaReset(bot: Bot): void {
  registerOwnerSlashCommand(bot, "quota-reset", async (ctx: Context) => {
    const entries = resetAllQuotas();

    if (entries.length === 0) {
      await ctx.reply("No stored quota records to reset.").catch(() => undefined);
      return;
    }

    const total = entries.reduce((sum, entry) => sum + entry.restored, 0);
    const totalLabel = total >= 0 ? `+${total}` : `${total}`;

    const lines = [
      "🔄 <b>Quota reset</b>",
      `Reset <b>${entries.length}</b> user(s).`,
      "",
      ...entries.map(describe),
      "",
      `<b>Total restored: ${totalLabel}</b>`,
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" }).catch(() => undefined);
  });
}
