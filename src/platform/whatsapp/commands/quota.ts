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
      await sendText(replyTo(message), "♾️ You have unlimited quota.");
      return;
    }

    const lines = [
      "*Your quota*",
      `Role: ${role}`,
      `Left today: ${quota.quotaLeft} / ${quota.total}`,
      `Resets in ${formatWait(quota.resetInSeconds)}`,
    ];
    await sendText(replyTo(message), lines.join("\n"));
  },
};
