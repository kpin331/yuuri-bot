import { readFile } from "node:fs/promises";
import {
  BRAT_PROMPT,
  BratSessionStore,
  normalizeBratText,
  parseBratChoice,
  renderBrat,
  type BratFormat,
  type BratSession,
} from "../../../lib/brat.js";
import { getCommandPrefix } from "../../../lib/config.js";
import { isCommandEnabled } from "../../../lib/db.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { replyTo, sendImage, sendLoopVideo, sendText } from "../reply.js";
import type { IncomingMessage, WaCommand } from "../types.js";

export const bratStore = new BratSessionStore();

async function deliver(message: IncomingMessage, session: BratSession, format: BratFormat): Promise<void> {
  const reply = replyTo(message);
  const dir = await makeTempDir("brat");
  try {
    const path = await renderBrat({ text: session.text, format, workDir: dir });
    const buffer = await readFile(path);
    if (format === "static") {
      await sendImage(reply, buffer, undefined, "brat.png");
    } else {
      await sendLoopVideo(reply, buffer, undefined, "brat.mp4");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await sendText(reply, `Gagal membuat brat: ${reason}`);
  } finally {
    await removeDir(dir);
  }
}

export const bratCommand: WaCommand = {
  name: "brat",
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    const text = normalizeBratText(args);
    if (!text) {
      await sendText(reply, `Cara pakai: ${getCommandPrefix()}brat <teks>`);
      return;
    }

    bratStore.create({ chatId: message.chatId, userId: message.userId, text });
    await sendText(reply, BRAT_PROMPT);
    await sendText(reply, "1. static\n2. animated");
  },
};

export async function maybeHandleBratReply(message: IncomingMessage): Promise<boolean> {
  const session = bratStore.get(message.chatId, message.userId);
  if (!session) return false;
  if (!isCommandEnabled("brat")) {
    bratStore.delete(message.chatId, message.userId);
    return false;
  }

  const text = message.text.trim();
  if (text.startsWith(getCommandPrefix()) || text.startsWith("$") || text.startsWith("!")) return false;

  const format = parseBratChoice(text);
  if (!format) {
    await sendText(replyTo(message), "Balas *1* untuk static atau *2* untuk animated.");
    return true;
  }

  bratStore.delete(message.chatId, message.userId);
  await deliver(message, session, format);
  return true;
}
