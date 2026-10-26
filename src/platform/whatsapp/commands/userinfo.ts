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
    const roleName = role === "owner" ? "pemilik" : role === "admin" ? "admin" : "anggota";
    const lines = ["*Profil*", `Nama: ${escapeWhatsApp(message.name ?? "tidak diketahui")}`];
    lines.push(`Nomor: ${message.phone ? `+${message.phone}` : "tersembunyi (LID)"}`);
    lines.push(`Peran: ${roleName}`);
    // The group id is what goes into ALLOWED_GROUPS when GROUP_ONLY is on.
    if (message.isGroup) lines.push(`ID grup: ${message.chatId}`);

    const quota = getQuota("whatsapp", message.userId, role, message.name);
    lines.push("", "*Kuota*");
    if (quota.unlimited) {
      lines.push("Tidak terbatas");
    } else {
      lines.push(
        `Sisa ${quota.quotaLeft} / ${quota.total} — diatur ulang dalam ${formatWait(quota.resetInSeconds)}`,
      );
    }

    lines.push("", "*Aktivitas*");
    const stats = getWaStats(message.userId);
    if (!stats) {
      lines.push("Belum ada data yang tercatat.");
    } else {
      lines.push(`Pesan: ${stats.messages}`);
      lines.push(`Hari aktif: ${stats.activeDays}`);
      lines.push(`Perintah digunakan: ${stats.commandCount}`);
      lines.push(`Perintah teratas: ${stats.topCommand ? `.${stats.topCommand}` : "—"}`);
      lines.push(`Pertama terlihat: ${formatDate(stats.firstSeen)}`);
      lines.push(`Terakhir terlihat: ${formatDate(stats.lastSeen)}`);
    }

    await sendText(replyTo(message), lines.join("\n"));
  },
};
