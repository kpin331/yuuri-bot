import { getAllowedGroups } from "../../../lib/config.js";
import { canonicalUserId } from "../identity.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const broadcastCommand: WaCommand = {
  name: "bc",
  aliases: ["broadcast"],
  ownerOnly: true,
  free: true,
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    if (message.isGroup) {
      await sendText(reply, "$bc hanya dapat digunakan di chat pribadi dengan bot.");
      return;
    }
    const quoted = message.quoted;
    const quotedSender = quoted?.key.participant ? canonicalUserId(quoted.key.participant, null) : null;
    const senderIds = new Set([
      message.userId,
      canonicalUserId(message.senderJid, null),
      canonicalUserId(message.senderAlt, null),
    ].filter((value): value is string => value !== null));
    if (quoted && (!quotedSender || !senderIds.has(quotedSender))) {
      await sendText(reply, "Balas pesan milikmu sendiri untuk meneruskannya, atau kirim $bc <pesan>.");
      return;
    }
    const text = args.trim();
    if (!quoted && !text) {
      await sendText(reply, "Cara pakai: $bc <pesan> atau balas pesanmu dengan $bc.");
      return;
    }

    const targets = getAllowedGroups().filter((jid) => !jid.startsWith("-"));
    await sendText(reply, `Broadcast dimulai ke ${targets.length} grup WhatsApp dari ALLOWED_GROUPS.`);
    let sent = 0;
    let failed = 0;
    for (const jid of targets) {
      try {
        await message.sock.sendMessage(jid, quoted ? { forward: quoted, force: true } : { text });
        sent += 1;
      } catch {
        failed += 1;
      }
      await wait(400);
    }
    await sendText(reply, `Broadcast ke grup WhatsApp selesai. Terkirim: ${sent}; gagal: ${failed}.`);
  },
};
