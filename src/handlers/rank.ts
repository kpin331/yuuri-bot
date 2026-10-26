import { type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { escapeHtml } from "../lib/info.js";
import { getLeaderboard, getXp, isPostgresReady } from "../lib/postgres.js";
import { levelProgress } from "../lib/xp.js";

const NOT_CONFIGURED =
  "⚙️ Fitur level dan peringkat belum dikonfigurasi. Atur POSTGRES_URL di environment bot lalu mulai ulang.";

function bar(percent: number): string {
  const filled = Math.round(percent / 10);
  return "▰".repeat(filled) + "▱".repeat(Math.max(0, 10 - filled));
}

function displayNameOf(row: { displayName: string | null; userId: string }): string {
  return row.displayName?.trim() || row.userId;
}

export function registerRank(bot: Bot): void {
  registerCommand(bot, "rank", async (ctx: Context) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply("Fitur ini hanya untuk grup.");
      return;
    }
    if (!isPostgresReady()) {
      await ctx.reply(NOT_CONFIGURED);
      return;
    }

    const userId = ctx.from?.id;
    if (userId === undefined) return;

    const groupId = String(ctx.chat.id);
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
  });

  registerCommand(bot, "leaderboard", async (ctx: Context) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply("Fitur ini hanya untuk grup.");
      return;
    }
    if (!isPostgresReady()) {
      await ctx.reply(NOT_CONFIGURED);
      return;
    }

    const rows = await getLeaderboard("telegram", String(ctx.chat.id), 10);
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
  });
}
