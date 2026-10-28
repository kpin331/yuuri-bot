import { getLeaderboard, getXp, isPostgresReady } from "../../../lib/postgres.js";
import { levelProgress } from "../../../lib/xp.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

const NOT_CONFIGURED = "Fitur level dan peringkat belum dikonfigurasi. Atur POSTGRES_URL lalu mulai ulang bot.";
const GROUP_ONLY = "Fitur ini hanya untuk grup.";

function displayNameOf(row: { displayName: string | null; userId: string }): string {
  return row.displayName?.replace(/[\r\n]+/g, " ").trim() || row.userId;
}

export const rankCommands: WaCommand[] = [
  {
    name: "rank",
    free: true,
    groupOnly: true,
    run: async ({ message, ownerOverride }) => {
      const reply = replyTo(message);
      if (!message.isGroup && !ownerOverride) {
        await sendText(reply, GROUP_ONLY);
        return;
      }
      if (!isPostgresReady()) {
        await sendText(reply, NOT_CONFIGURED);
        return;
      }

      const xp = await getXp("whatsapp", message.chatId, message.userId);
      const progress = levelProgress(xp);
      const name = displayNameOf({ displayName: message.name, userId: message.userId });
      await sendText(
        reply,
        `🏅 ${name}: Tingkat ${progress.level}\nJumlah XP: ${progress.totalXp}\n` +
          `Progres: ${progress.percent}% (${progress.intoLevel}/${progress.neededForLevel} XP)`,
      );
    },
  },
  {
    name: "leaderboard",
    free: true,
    groupOnly: true,
    run: async ({ message, ownerOverride }) => {
      const reply = replyTo(message);
      if (!message.isGroup && !ownerOverride) {
        await sendText(reply, GROUP_ONLY);
        return;
      }
      if (!isPostgresReady()) {
        await sendText(reply, NOT_CONFIGURED);
        return;
      }

      const rows = await getLeaderboard("whatsapp", message.chatId, 10);
      if (rows.length === 0) {
        await sendText(reply, "Belum ada XP di grup ini. Gunakan perintah bot untuk mulai mengumpulkannya.");
        return;
      }

      const medals = ["🥇", "🥈", "🥉"];
      const lines = ["🏆 Peringkat XP", ""];
      rows.forEach((row, index) => {
        const place = medals[index] ?? `${index + 1}.`;
        const progress = levelProgress(row.xp);
        lines.push(`${place} ${displayNameOf(row)} - Tingkat ${progress.level} (${row.xp} XP)`);
      });
      await sendText(reply, lines.join("\n"));
    },
  },
];
