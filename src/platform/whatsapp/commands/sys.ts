import { buildSystemReport } from "../../../lib/system.js";
import { htmlToWhatsApp } from "../../../lib/text.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const sysCommand: WaCommand = {
  name: "sys",
  ownerOnly: true,
  free: true,
  run: async ({ message }) => {
    const report = await buildSystemReport();
    await sendText(replyTo(message), htmlToWhatsApp(report));
  },
};
