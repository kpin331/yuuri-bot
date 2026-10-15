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
  isPlayUrl,
  PlaySessionStore,
  type PlayKind,
  type PlayMeta,
  type PlaySession,
} from "../lib/play.js";
import { makeTempDir, removeDir } from "../lib/temp.js";
import { downloadAudio, downloadVideo, probeMeta, searchYouTube } from "../lib/youtube.js";

const sessions = new PlaySessionStore();

function usage(): string {
  return "Usage: /play <search query or video link>";
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

function formatPrompt(meta: PlayMeta): string {
  const lines = [`<b>${escapeHtml(meta.title)}</b>`];
  if (meta.uploader) lines.push(`👤 ${escapeHtml(meta.uploader)}`);
  const time = formatTime(meta.duration);
  if (time) lines.push(`⏱ ${time}`);
  if (meta.isLive) lines.push("🔴 Live stream");
  lines.push("", "Choose a format:");
  return lines.join("\n");
}

async function sendMedia(
  ctx: Context,
  path: string,
  kind: PlayKind,
  meta: PlayMeta | undefined,
  caption: string | undefined,
): Promise<void> {
  const options = caption ? { caption, parse_mode: "HTML" as const } : {};

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

  if (isPlayUrl(input)) {
    const status = await ctx.reply("Fetching media info…");
    await ctx.replyWithChatAction("typing");
    const meta = await probeMeta(input);
    if (!meta) {
      await ctx.api.editMessageText(
        status.chat.id,
        status.message_id,
        "Could not read media from that link.",
      );
      return;
    }

    sessions.create({
      chatId,
      userId: user.id,
      messageId: status.message_id,
      query: input,
      stage: "format",
      results: [],
      selected: {
        index: 1,
        id: meta.id ?? "",
        title: meta.title,
        url: input,
        duration: meta.duration,
        uploader: meta.uploader,
      },
      meta,
    });

    await ctx.api.editMessageText(status.chat.id, status.message_id, formatPrompt(meta), {
      parse_mode: "HTML",
      reply_markup: formatKeyboard(),
    });
    return;
  }

  const status = await ctx.reply("Searching…");
  await ctx.replyWithChatAction("typing");
  const results = await searchYouTube(input);
  if (results.length === 0) {
    await ctx.api.editMessageText(
      status.chat.id,
      status.message_id,
      "No results found for that query.",
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
}

async function handlePick(ctx: Context, session: PlaySession, index: number): Promise<void> {
  const result = session.results.find((item) => item.index === index);
  if (!result) {
    await ctx.answerCallbackQuery({ text: "Invalid selection.", show_alert: true }).catch(() => undefined);
    return;
  }

  await ctx.answerCallbackQuery().catch(() => undefined);
  await ctx.editMessageText("Loading…").catch(() => undefined);

  const meta = await probeMeta(result.url);
  if (!meta) {
    session.stage = "choose";
    await ctx
      .editMessageText(formatSearchList(session.results), {
        parse_mode: "HTML",
        reply_markup: chooseKeyboard(session),
      })
      .catch(() => undefined);
    return;
  }

  session.selected = result;
  session.meta = meta;
  session.stage = "format";

  await ctx
    .editMessageText(formatPrompt(meta), { parse_mode: "HTML", reply_markup: formatKeyboard() })
    .catch(() => undefined);
}

async function handleFormat(ctx: Context, session: PlaySession, kind: PlayKind): Promise<void> {
  const url = session.selected?.url ?? session.query;
  const meta = session.meta;

  await ctx.answerCallbackQuery().catch(() => undefined);
  sessions.delete(session.chatId, session.userId);

  const label = kind === "audio" ? "audio" : "video";
  await ctx.editMessageText(`Downloading ${label}…`).catch(() => undefined);
  await ctx.replyWithChatAction(kind === "audio" ? "upload_voice" : "upload_video");

  const dir = await makeTempDir("play");
  try {
    if (!(await hasFreeSpace(dir, MAX_UPLOAD_BYTES))) {
      await ctx.editMessageText("Not enough free disk space to download safely.").catch(() => undefined);
      return;
    }

    const download = kind === "audio" ? await downloadAudio(dir, url) : await downloadVideo(dir, url);
    if (!download) {
      await ctx.editMessageText(`Could not download the ${label}.`).catch(() => undefined);
      return;
    }

    const size = (await stat(download.path)).size;
    if (exceedsUploadLimit(size)) {
      await ctx.editMessageText(uploadLimitError(size)).catch(() => undefined);
      return;
    }

    const caption = meta ? buildPlayCaption(meta, kind) : undefined;
    await sendMedia(ctx, download.path, kind, meta, caption);
    await ctx.deleteMessage().catch(() => undefined);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await ctx.editMessageText(`Download failed: ${reason}`).catch(() => undefined);
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
      .answerCallbackQuery({ text: "This command is currently disabled.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  const session = sessions.get(chatId, userId);
  if (!session) {
    await ctx
      .answerCallbackQuery({ text: "This request expired. Send /play again.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  const [, action, value] = data.split(":");

  if (action === "pick") {
    if (session.stage !== "choose") {
      await ctx
        .answerCallbackQuery({ text: "This selection is no longer available.", show_alert: true })
        .catch(() => undefined);
      return;
    }
    await handlePick(ctx, session, Number(value));
    return;
  }

  if (action === "audio" || action === "video") {
    if (session.stage !== "format") {
      await ctx
        .answerCallbackQuery({ text: "This request expired. Send /play again.", show_alert: true })
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
