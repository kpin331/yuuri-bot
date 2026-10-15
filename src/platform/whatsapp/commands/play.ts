import { readFile } from "node:fs/promises";
import { getCommandPrefix } from "../../../lib/config.js";
import { exceedsUploadLimit, uploadLimitError } from "../../../lib/media.js";
import {
  buildPlayCaption,
  formatSearchList,
  isPlayUrl,
  type PlayKind,
  type PlayMeta,
} from "../../../lib/play.js";
import { makeTempDir, removeDir } from "../../../lib/temp.js";
import { htmlToWhatsApp } from "../../../lib/text.js";
import { downloadAudio, downloadVideo, probeMeta, searchYouTube } from "../../../lib/youtube.js";
import { replyTo, sendAudio, sendText, sendVideo } from "../reply.js";
import { WaPlaySessionStore, type WaPlaySession } from "../session.js";
import type { IncomingMessage, WaCommand } from "../types.js";

export const playStore = new WaPlaySessionStore();

function formatPrompt(meta: PlayMeta): string {
  const caption = htmlToWhatsApp(buildPlayCaption(meta, "video"));
  return `${caption}\n\nReply *1* for audio or *2* for video.`;
}

async function deliver(message: IncomingMessage, session: WaPlaySession, kind: PlayKind): Promise<void> {
  const reply = replyTo(message);
  const url = session.selected?.url;
  if (!url) {
    await sendText(reply, `That selection expired. Start again with ${getCommandPrefix()}play.`);
    return;
  }

  const meta = session.meta;
  await sendText(reply, kind === "audio" ? "Downloading audio…" : "Downloading video…");

  const dir = await makeTempDir("wa-play");
  try {
    const result = kind === "audio" ? await downloadAudio(dir, url) : await downloadVideo(dir, url);
    if (!result) {
      await sendText(reply, "Download failed.");
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
    await sendText(reply, `Download failed: ${reason}`);
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
      await sendText(reply, `Usage: ${prefix}play <song name or link>`);
      return;
    }

    if (isPlayUrl(query)) {
      const meta = await probeMeta(query);
      if (!meta) {
        await sendText(reply, "Could not read that link.");
        return;
      }
      playStore.create({
        chatId: message.chatId,
        userId: message.userId,
        stage: "format",
        results: [],
        selected: {
          index: 1,
          id: meta.id ?? "",
          title: meta.title,
          url: query,
          duration: meta.duration,
          uploader: meta.uploader,
        },
        meta,
      });
      await sendText(reply, formatPrompt(meta));
      return;
    }

    await sendText(reply, "Searching YouTube…");
    const results = await searchYouTube(query);
    if (results.length === 0) {
      await sendText(reply, "No results found.");
      return;
    }

    playStore.create({
      chatId: message.chatId,
      userId: message.userId,
      stage: "choose",
      results,
    });
    await sendText(reply, htmlToWhatsApp(formatSearchList(results)));
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
        `Reply with a number between 1 and ${session.results.length}, or ${prefix}play <query> to search again.`,
      );
      return true;
    }

    const selected = session.results[num - 1]!;
    const meta =
      (await probeMeta(selected.url)) ?? {
        title: selected.title,
        uploader: selected.uploader,
        duration: selected.duration,
        webpageUrl: selected.url,
      };
    session.selected = selected;
    session.meta = meta;
    session.stage = "format";
    await sendText(reply, formatPrompt(meta));
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
    await sendText(reply, "Reply *1* for audio or *2* for video.");
    return true;
  }

  playStore.delete(message.chatId, message.userId);
  await deliver(message, session, kind);
  return true;
}
