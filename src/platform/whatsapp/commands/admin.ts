import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const pingCommand: WaCommand = {
  name: "ping",
  adminOnly: true,
  free: true,
  run: async ({ message }) => {
    const sentAt = Date.now();
    const timestamp = Number(message.message.messageTimestamp ?? Math.floor(sentAt / 1000));
    const elapsed = Math.max(0, sentAt - timestamp * 1000);
    await sendText(replyTo(message), `Pong! Respons dalam ${elapsed} ms.`);
  },
};

export const groupinfoCommand: WaCommand = {
  name: "groupinfo",
  adminOnly: true,
  free: true,
  run: async ({ message }) => {
    const reply = replyTo(message);
    if (!message.isGroup) {
      await sendText(reply, "Perintah ini hanya dapat digunakan di grup.");
      return;
    }

    const metadata = await message.sock.groupMetadata(message.chatId);
    const lines = [
      "Info grup",
      `Nama: ${metadata.subject}`,
      `ID: ${metadata.id}`,
      `Anggota: ${metadata.participants.length}`,
    ];
    if (metadata.desc) lines.push(`Deskripsi: ${metadata.desc}`);
    await sendText(reply, lines.join("\n"));
  },
};
