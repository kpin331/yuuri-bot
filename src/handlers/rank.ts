import { type Bot, type Context } from "grammy";
import { registerCommand, registerOwnerCommand } from "../lib/command.js";
import { escapeHtml } from "../lib/info.js";
import { getLeaderboard, getXp, isXpStorageReady } from "../lib/xp-storage.js";
import { levelProgress } from "../lib/xp.js";

const NOT_CONFIGURED =
  "⚙️ Penyimpanan level dan peringkat belum siap. Pastikan database lokal dapat dibuka lalu mulai ulang bot.";

function bar(percent: number): string {
  const filled = Math.round(percent / 10);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, 10 - filled));
}

function displayNameOf(row: { displayName: string | null; userId: string }): string {
  return row.displayName?.trim() || row.userId;
}

export function registerRank(bot: Bot): void {
  const showRank = async (ctx: Context, ownerOverride = false): Promise<void> => {
    if (!ownerOverride && ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply("Fitur ini hanya untuk grup.");
      return;
    }
    const chat = ctx.chat;
    if (!chat) return;
    if (!isXpStorageReady()) {
      await ctx.reply(NOT_CONFIGURED);
      return;
    }

    const userId = ctx.from?.id;
    if (userId === undefined) return;

    const groupId = String(chat.id);
    const xp = await getXp("telegram", groupId, String(userId));
    const progress = levelProgress(xp);
    const name =
      [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ").trim() ||
      ctx.from?.username ||
      String(userId);

    const lines = [
      `🏅 <b>${escapeHtml(name)}</b>: Tingkat <b>${progress.level}</b>`,
      "",
      `Jumlah XP: <b>${progress.totalXp}</b>`,
      `Progres: ${bar(progress.percent)} ${progress.percent}%`,
      `Menuju tingkat ${progress.level + 1}: <b>${progress.intoLevel}</b> / ${progress.neededForLevel} XP`,
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  };
  registerCommand(bot, "rank", (ctx) => showRank(ctx));
  registerOwnerCommand(bot, "rank", (ctx) => showRank(ctx, true));

  const showLeaderboard = async (ctx: Context, ownerOverride = false): Promise<void> => {
    if (!ownerOverride && ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply("Fitur ini hanya untuk grup.");
      return;
    }
    const chat = ctx.chat;
    if (!chat) return;
    if (!isXpStorageReady()) {
      await ctx.reply(NOT_CONFIGURED);
      return;
    }

    const rows = await getLeaderboard("telegram", String(chat.id), 10);
    if (rows.length === 0) {
      await ctx.reply("Belum ada yang mendapat XP. Pakai perintah apa saja untuk mulai naik level!");
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines = ["<b>🏆 Peringkat XP</b>", ""];
    rows.forEach((row, index) => {
      const place = medals[index] ?? `${index + 1}.`;
      const progress = levelProgress(row.xp);
      lines.push(
        `${place} <b>${escapeHtml(displayNameOf(row))}</b>: Tingkat ${progress.level} (${row.xp} XP)`,
      );
    });

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  };
  registerCommand(bot, "leaderboard", (ctx) => showLeaderboard(ctx));
  registerOwnerCommand(bot, "leaderboard", (ctx) => showLeaderboard(ctx, true));
}
