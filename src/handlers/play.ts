import { stat } from "node:fs/promises";
import { InlineKeyboard, InputFile, type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { isCommandEnabled } from "../lib/db.js";
import { escapeHtml } from "../lib/info.js";
import {
  exceedsUploadLimit,
  hasFreeSpace,
  MAX_UPLOAD_BYTES,
  uploadLimitError,
} from "../lib/media.js";
import {
  buildPlayCaption,
  formatSearchList,
  formatTime,
  PlaySessionStore,
  type PlayKind,
  type PlayMeta,
  type PlaySession,
} from "../lib/play.js";
import { parsePlayLink, resolvePlayInput } from "../lib/playlink.js";
import { fetchPlayThumbnail } from "../lib/play-thumbnail.js";
import { makeTempDir, removeDir } from "../lib/temp.js";
import { downloadAudio, downloadVideo, probeMeta, searchYouTube } from "../lib/youtube.js";
import { archiveMediaFile } from "../lib/runtime.js";

const sessions = new PlaySessionStore();

function usage(): string {
  return "Cara pakai: /play <kata kunci atau tautan video>";
}

function chooseKeyboard(session: PlaySession): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  session.results.forEach((result, i) => {
    keyboard.text(String(result.index), `play:pick:${result.index}`);
    if ((i + 1) % 5 === 0 && i + 1 < session.results.length) keyboard.row();
  });
  return keyboard;
}

function formatKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🎵 Audio", "play:audio").text("🎬 Video", "play:video");
}

function formatPrompt(meta: PlayMeta, note?: string): string {
  const lines = [`<b>${escapeHtml(meta.title)}</b>`];
  if (meta.uploader) lines.push(`👤 ${escapeHtml(meta.uploader)}`);
  const time = formatTime(meta.duration);
  if (time) lines.push(`⏱ ${time}`);
  if (meta.isLive) lines.push("🔴 Siaran langsung");
  if (note) lines.push("", `ℹ️ ${escapeHtml(note)}`);
  lines.push("", "Pilih format:");
  return lines.join("\n");
}

async function showFormatPrompt(
  ctx: Context,
  meta: PlayMeta,
  note: string | undefined,
  chatId: number,
  messageId: number,
): Promise<void> {
  const caption = formatPrompt(meta, note);
  if (meta.thumbnail) {
    const thumbnail = await fetchPlayThumbnail(meta.thumbnail);
    if (thumbnail) {
      try {
        await ctx.api.sendPhoto(chatId, new InputFile(thumbnail.data, thumbnail.fileName), {
          caption,
          parse_mode: "HTML",
          reply_markup: formatKeyboard(),
        });
        await ctx.api.deleteMessage(chatId, messageId).catch(() => undefined);
        return;
      } catch {
        // If the thumbnail cannot be sent, keep the existing text prompt.
      }
    }
  }
  await ctx.api.editMessageText(chatId, messageId, caption, {
    parse_mode: "HTML",
    reply_markup: formatKeyboard(),
  }).catch(() => undefined);
}

async function updateFormatProgress(ctx: Context, text: string): Promise<void> {
  const message = ctx.callbackQuery?.message;
  if (message && "photo" in message) {
    await ctx.api.editMessageCaption(message.chat.id, message.message_id, { caption: text }).catch(() => undefined);
    return;
  }
  await ctx.editMessageText(text).catch(() => undefined);
}

async function sendMedia(
  ctx: Context,
  path: string,
  kind: PlayKind,
  meta: PlayMeta | undefined,
  caption: string | undefined,
): Promise<void> {
  const options = caption ? { caption, parse_mode: "HTML" as const } : {};
  await archiveMediaFile(path);

  try {
    if (kind === "audio") {
      await ctx.replyWithAudio(new InputFile(path), {
        ...(caption ? { caption, parse_mode: "HTML" as const } : {}),
        title: meta?.title ? meta.title.slice(0, 64) : undefined,
        performer: meta?.uploader ? meta.uploader.slice(0, 64) : undefined,
        duration: meta?.duration && meta.duration > 0 ? Math.round(meta.duration) : undefined,
      });
    } else {
      await ctx.replyWithVideo(new InputFile(path), options);
    }
  } catch {
    await ctx.replyWithDocument(new InputFile(path), options);
  }
}

async function handlePlay(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const user = ctx.from;
  if (chatId === undefined || !user) return;

  const replied = ctx.message?.reply_to_message;
  const arg = typeof ctx.match === "string" ? ctx.match.trim() : "";
  const input = arg || (replied?.text ?? replied?.caption ?? "").trim();

  if (!input) {
    await ctx.reply(usage());
    return;
  }

  sessions.delete(chatId, user.id);

  const parsed = parsePlayLink(input);

  // Plain text (or anything that is not a link) keeps the original search flow.
  if (parsed.type === "search") {
    const status = await ctx.reply("Sedang mencari…");
    await ctx.replyWithChatAction("typing");
    const results = await searchYouTube(input);
    if (results.length === 0) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        "Tidak ada hasil untuk pencarian tersebut.",
      );
      return;
    }

    const session = sessions.create({
      chatId,
      userId: user.id,
      messageId: status.message_id,
      query: input,
      stage: "choose",
      results,
    });

    await ctx.api.editMessageText(status.chat.id, status.message_id, formatSearchList(results), {
      parse_mode: "HTML",
      reply_markup: chooseKeyboard(session),
    });
    return;
  }

  // Unsupported domain or a playlist/album link: reject without any network call.
  if (parsed.type === "error") {
    await ctx.reply(parsed.message);
    return;
  }

  const status = await ctx.reply("Sedang mengambil info media…");
  await ctx.replyWithChatAction("typing");
  const resolved = await resolvePlayInput(input);
  if (resolved.type === "error") {
    await ctx.api.editMessageText(status.chat.id, status.message_id, resolved.message);
    return;
  }
  if (resolved.type !== "media") return;

  const { value } = resolved;
  const note = value.matchedFromYouTube ? `Hasil yang cocok dari YouTube: ${value.matchedQuery}` : undefined;

  sessions.create({
    chatId,
    userId: user.id,
    messageId: status.message_id,
    query: input,
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

  await showFormatPrompt(ctx, value.meta, note, status.chat.id, status.message_id);
}

async function handlePick(ctx: Context, session: PlaySession, index: number): Promise<void> {
  const result = session.results.find((item) => item.index === index);
  if (!result) {
    await ctx.answerCallbackQuery({ text: "Pilihan tidak valid.", show_alert: true }).catch(() => undefined);
    return;
  }

  await ctx.answerCallbackQuery().catch(() => undefined);
  await ctx.editMessageText("Memuat…").catch(() => undefined);

  const probed = await probeMeta(result.url);
  const meta = probed
    ? { ...probed, thumbnail: probed.thumbnail ?? result.thumbnail }
    : {
      id: result.id,
      title: result.title,
      uploader: result.uploader,
      duration: result.duration,
      webpageUrl: result.url,
      thumbnail: result.thumbnail,
    };

  session.selected = result;
  session.meta = meta;
  session.stage = "format";

  const message = ctx.callbackQuery?.message;
  if (message) await showFormatPrompt(ctx, meta, undefined, message.chat.id, message.message_id);
}

async function handleFormat(ctx: Context, session: PlaySession, kind: PlayKind): Promise<void> {
  const url = session.selected?.url ?? session.query;
  const meta = session.meta;

  await ctx.answerCallbackQuery().catch(() => undefined);
  sessions.delete(session.chatId, session.userId);

  const label = kind === "audio" ? "audio" : "video";
  await updateFormatProgress(ctx, `Sedang mengunduh ${label}…`);
  await ctx.replyWithChatAction(kind === "audio" ? "upload_voice" : "upload_video");

  const dir = await makeTempDir("play");
  try {
    if (!(await hasFreeSpace(dir, MAX_UPLOAD_BYTES))) {
      await updateFormatProgress(ctx, "Ruang penyimpanan tidak cukup untuk mengunduh dengan aman.");
      return;
    }

    const download = kind === "audio" ? await downloadAudio(dir, url) : await downloadVideo(dir, url);
    if (!download) {
      await updateFormatProgress(ctx, `Tidak dapat mengunduh ${label}.`);
      return;
    }

    const size = (await stat(download.path)).size;
    if (exceedsUploadLimit(size)) {
      await updateFormatProgress(ctx, uploadLimitError(size));
      return;
    }

    const caption = meta ? buildPlayCaption(meta, kind) : undefined;
    await sendMedia(ctx, download.path, kind, meta, caption);
    await ctx.deleteMessage().catch(() => undefined);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await updateFormatProgress(ctx, `Pengunduhan gagal: ${reason}`);
  } finally {
    await removeDir(dir);
  }
}

async function handleCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const message = ctx.callbackQuery?.message;
  const chatId = message?.chat.id;
  const userId = ctx.callbackQuery?.from.id;

  if (chatId === undefined || userId === undefined) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }

  // A disabled command must not be runnable through its inline buttons either.
  if (!isCommandEnabled("play")) {
    await ctx
      .answerCallbackQuery({ text: "Perintah ini sedang dinonaktifkan.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  const session = sessions.get(chatId, userId);
  if (!session) {
    await ctx
      .answerCallbackQuery({ text: "Permintaan ini kedaluwarsa. Kirim /play lagi.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  const [, action, value] = data.split(":");

  if (action === "pick") {
    if (session.stage !== "choose") {
      await ctx
        .answerCallbackQuery({ text: "Pilihan ini sudah tidak tersedia.", show_alert: true })
        .catch(() => undefined);
      return;
    }
    await handlePick(ctx, session, Number(value));
    return;
  }

  if (action === "audio" || action === "video") {
    if (session.stage !== "format") {
      await ctx
        .answerCallbackQuery({ text: "Permintaan ini kedaluwarsa. Kirim /play lagi.", show_alert: true })
        .catch(() => undefined);
      return;
    }
    await handleFormat(ctx, session, action);
    return;
  }

  await ctx.answerCallbackQuery().catch(() => undefined);
}

export function registerPlay(bot: Bot): void {
  registerCommand(bot, "play", handlePlay);
  bot.callbackQuery(/^play:/, handleCallback);
}
