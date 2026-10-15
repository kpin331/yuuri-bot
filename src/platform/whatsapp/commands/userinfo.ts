import { getQuota } from "../../../core/access.js";
import { formatWait } from "../../../core/time.js";
import { getWaStats } from "../../../lib/db.js";
import { escapeWhatsApp } from "../../../lib/text.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const userinfoCommand: WaCommand = {
  name: "userinfo",
  free: true,
  run: async ({ message, role }) => {
    const lines = ["*Profile*", `Name: ${escapeWhatsApp(message.name ?? "unknown")}`];
    lines.push(`Number: ${message.phone ? `+${message.phone}` : "hidden (LID)"}`);
    lines.push(`Role: ${role}`);

    const quota = getQuota("whatsapp", message.userId, role, message.name);
    lines.push("", "*Quota*");
    if (quota.unlimited) {
      lines.push("Unlimited");
    } else {
      lines.push(
        `${quota.quotaLeft} / ${quota.total} left — resets in ${formatWait(quota.resetInSeconds)}`,
      );
    }

    lines.push("", "*Activity*");
    const stats = getWaStats(message.userId);
    if (!stats) {
      lines.push("No data recorded.");
    } else {
      lines.push(`Messages: ${stats.messages}`);
      lines.push(`Active days: ${stats.activeDays}`);
      lines.push(`Commands used: ${stats.commandCount}`);
      lines.push(`Top command: ${stats.topCommand ? `.${stats.topCommand}` : "—"}`);
      lines.push(`First seen: ${formatDate(stats.firstSeen)}`);
      lines.push(`Last seen: ${formatDate(stats.lastSeen)}`);
    }

    await sendText(replyTo(message), lines.join("\n"));
  },
};
