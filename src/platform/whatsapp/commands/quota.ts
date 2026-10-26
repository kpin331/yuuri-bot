import { getQuota } from "../../../core/access.js";
import { formatWait } from "../../../core/time.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const quotaCommand: WaCommand = {
  name: "quota",
  free: true,
  run: async ({ message, role }) => {
    const quota = getQuota("whatsapp", message.userId, role, message.name);
    if (quota.unlimited) {
      await sendText(replyTo(message), "♾️ Kuota Anda tidak terbatas.");
      return;
    }

    const lines = [
      "*Kuota Anda*",
      `Peran: ${role === "owner" ? "pemilik" : role === "admin" ? "admin" : "anggota"}`,
      `Sisa hari ini: ${quota.quotaLeft} / ${quota.total}`,
      `Diatur ulang dalam ${formatWait(quota.resetInSeconds)}`,
    ];
    await sendText(replyTo(message), lines.join("\n"));
  },
};
