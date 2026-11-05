import { getCommandPrefix, getTimezone } from "../../../lib/config.js";
import { convertBase64, createUuid, currentTime, sha256, splitModeInput } from "../../../lib/text-tools.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const timeCommand: WaCommand = {
  name: "time",
  free: true,
  awardXp: false,
  run: async ({ message }) => {
    const timezone = getTimezone();
    const value = currentTime(timezone);
    await sendText(replyTo(message), value ? `Waktu (${timezone}): ${value}` : "Zona waktu di konfigurasi tidak valid.");
  },
};

export const uuidCommand: WaCommand = {
  name: "uuid",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    if (args.trim()) {
      await sendText(replyTo(message), `Gunakan ${getCommandPrefix()}uuid tanpa argumen untuk membuat UUID.`);
      return;
    }
    await sendText(replyTo(message), createUuid());
  },
};

export const hashCommand: WaCommand = {
  name: "hash",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const result = sha256(args);
    await sendText(replyTo(message), result ? `SHA-256: ${result}` : `Format: ${getCommandPrefix()}hash <teks> (maksimal 10.000 karakter).`);
  },
};

export const base64Command: WaCommand = {
  name: "base64",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const parsed = splitModeInput(args);
    const result = parsed ? convertBase64(parsed.mode, parsed.text) : null;
    if (result === null) {
      await sendText(replyTo(message), `Format: ${getCommandPrefix()}base64 encode|decode <teks>. Batas data 2.900 byte; hasil decode harus UTF-8.`);
      return;
    }
    await sendText(replyTo(message), result);
  },
};
