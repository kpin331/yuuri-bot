import { readFile } from "node:fs/promises";
import { getCommandPrefix } from "../../../lib/config.js";
import { exceedsUploadLimit, uploadLimitError } from "../../../lib/media.js";
import {
  buildPlayCaption,
  formatSearchList,
  type PlayKind,
  type PlayMeta,
} from "../../../lib/play.js";
import { parsePlayLink, resolvePlayInput } from "../../../lib/playlink.js";
import { fetchPlayThumbnail } from "../../../lib/play-thumbnail.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { htmlToWhatsApp } from "../../../lib/text.js";
import { downloadAudio, downloadVideo, probeMeta, searchYouTube } from "../../../lib/youtube.js";
import { replyTo, sendAudio, sendImage, sendText, sendVideo } from "../reply.js";
import { WaPlaySessionStore, type WaPlaySession } from "../session.js";
import type { IncomingMessage, WaCommand } from "../types.js";

export const playStore = new WaPlaySessionStore();

function formatPrompt(meta: PlayMeta, note?: string): string {
  const caption = htmlToWhatsApp(buildPlayCaption(meta, "video"));
  const noteLine = note ? `\n\nℹ️ ${note}` : "";
  return `${caption}${noteLine}\n\nBalas *1* untuk audio atau *2* untuk video.`;
}

async function sendFormatPrompt(message: IncomingMessage, meta: PlayMeta, note?: string): Promise<void> {
  const reply = replyTo(message);
  if (meta.thumbnail) {
    const thumbnail = await fetchPlayThumbnail(meta.thumbnail);
    if (thumbnail) {
      let imageSent = false;
      try {
        const caption = htmlToWhatsApp(buildPlayCaption(meta, "video"));
        await sendImage(reply, thumbnail.data, caption, thumbnail.fileName);
        imageSent = true;
      } catch {
        // Keep the text prompt available when sending the preview image fails.
      }
      if (imageSent) {
        const noteLine = note ? `\n${note}\n` : "";
        await sendText(reply, `${noteLine}Balas *1* untuk audio atau *2* untuk video.`);
        return;
      }
    }
  }
  await sendText(reply, formatPrompt(meta, note));
}

async function deliver(message: IncomingMessage, session: WaPlaySession, kind: PlayKind): Promise<void> {
  const reply = replyTo(message);
  const url = session.selected?.url;
  if (!url) {
    await sendText(reply, `Pilihan itu kedaluwarsa. Mulai lagi dengan ${getCommandPrefix()}play.`);
    return;
  }

  const meta = session.meta;
  await sendText(reply, kind === "audio" ? "Sedang mengunduh audio…" : "Sedang mengunduh video…");

  const dir = await makeTempDir("wa-play");
  try {
    const result = kind === "audio" ? await downloadAudio(dir, url) : await downloadVideo(dir, url);
    if (!result) {
      await sendText(reply, "Pengunduhan gagal.");
      return;
    }

    const buffer = await readFile(result.path);
    if (exceedsUploadLimit(buffer.length)) {
      await sendText(reply, uploadLimitError(buffer.length));
      return;
    }

    if (kind === "audio") {
      await sendAudio(reply, buffer, meta?.duration);
    } else {
      const caption = meta ? htmlToWhatsApp(buildPlayCaption(meta, kind)) : undefined;
      await sendVideo(reply, buffer, caption);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await sendText(reply, `Pengunduhan gagal: ${reason}`);
  } finally {
    await removeDir(dir);
  }
}

export const playCommand: WaCommand = {
  name: "play",
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    const prefix = getCommandPrefix();
    const query = args.trim();

    if (!query) {
      await sendText(reply, `Cara pakai: ${prefix}play <judul lagu atau tautan>`);
      return;
    }

    const parsed = parsePlayLink(query);

    // Unsupported domain or a playlist/album link: reject without any network call.
    if (parsed.type === "error") {
      await sendText(reply, parsed.message);
      return;
    }

    if (parsed.type === "search") {
      await sendText(reply, "Sedang mencari di YouTube…");
      const results = await searchYouTube(query);
      if (results.length === 0) {
        await sendText(reply, "Tidak ada hasil yang ditemukan.");
        return;
      }

      playStore.create({
        chatId: message.chatId,
        userId: message.userId,
        stage: "choose",
        results,
      });
      await sendText(reply, htmlToWhatsApp(formatSearchList(results)));
      return;
    }

    await sendText(reply, "Sedang mengambil info media…");
    const resolved = await resolvePlayInput(query);
    if (resolved.type === "error") {
      await sendText(reply, resolved.message);
      return;
    }
    if (resolved.type !== "media") return;

    const { value } = resolved;
    const note = value.matchedFromYouTube ? `Hasil yang cocok dari YouTube: ${value.matchedQuery}` : undefined;

    playStore.create({
      chatId: message.chatId,
      userId: message.userId,
      stage: "format",
      results: [],
      selected: {
        index: 1,
        id: value.meta.id ?? "",
        title: value.meta.title,
        url: value.url,
        duration: value.meta.duration,
        uploader: value.meta.uploader,
      },
      meta: value.meta,
      note,
    });
    await sendFormatPrompt(message, value.meta, note);
  },
};

// Handles the plain-text follow-ups for an in-progress ".play" (a number to pick
// a result, then audio/video). Returns true when the message was consumed, so
// the router does not treat it as a new command.
export async function maybeHandlePlayReply(message: IncomingMessage): Promise<boolean> {
  const session = playStore.get(message.chatId, message.userId);
  if (!session) return false;

  const text = message.text.trim();
  const reply = replyTo(message);
  const prefix = getCommandPrefix();

  // Let real commands through instead of swallowing them.
  if (text.startsWith(prefix) || text.startsWith("$") || text.startsWith("!")) return false;

  if (session.stage === "choose") {
    const num = Number.parseInt(text, 10);
    if (!Number.isInteger(num) || num < 1 || num > session.results.length) {
      await sendText(
        reply,
        `Balas dengan angka 1 sampai ${session.results.length}, atau kirim ${prefix}play <kata kunci> untuk mencari lagi.`,
      );
      return true;
    }

    const selected = session.results[num - 1]!;
    const probed = await probeMeta(selected.url);
    const meta = probed
      ? { ...probed, thumbnail: probed.thumbnail ?? selected.thumbnail }
      : {
        title: selected.title,
        uploader: selected.uploader,
        duration: selected.duration,
        webpageUrl: selected.url,
        thumbnail: selected.thumbnail,
      };
    session.selected = selected;
    session.meta = meta;
    session.stage = "format";
    await sendFormatPrompt(message, meta);
    return true;
  }

  const choice = text.toLowerCase();
  const kind: PlayKind | null =
    choice === "1" || choice === "a" || choice === "audio"
      ? "audio"
      : choice === "2" || choice === "v" || choice === "video"
        ? "video"
        : null;

  if (!kind) {
    await sendText(reply, "Balas *1* untuk audio atau *2* untuk video.");
    return true;
  }

  playStore.delete(message.chatId, message.userId);
  await deliver(message, session, kind);
  return true;
}
