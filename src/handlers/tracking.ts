import type { Bot } from "grammy";
import { recordIncoming } from "../lib/db.js";

let lastUpdateId = 0;

function extractCommand(text: string | undefined): string | null {
  if (!text) return null;
  const match = /^[/$]([A-Za-z0-9_]+)/.exec(text.trimStart());
  return match ? (match[1] ?? null) : null;
}

export function registerTracking(bot: Bot): void {
  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    if (updateId <= lastUpdateId) return next();
    lastUpdateId = updateId;

    const message = ctx.message;
    const from = ctx.from;

    if (message && from && !from.is_bot) {
      const text = message.text ?? message.caption;
      try {
        recordIncoming({
          user: {
            id: from.id,
            firstName: from.first_name,
            lastName: from.last_name,
            username: from.username,
          },
          command: extractCommand(text),
          at: (message.date ?? Math.floor(Date.now() / 1000)) * 1000,
        });
      } catch (error) {
        console.error("Failed to record activity:", error);
      }
    }

    return next();
  });
}
