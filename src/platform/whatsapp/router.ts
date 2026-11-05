import { checkRateLimit, consumeQuota, getQuota, resolveRole } from "../../core/access.js";
import { formatWait } from "../../core/time.js";
import {
  getAdminPrefix,
  getCommandPrefix,
  getOwnerPrefix,
  isEveryoneAllowed,
  isGroupAllowed,
} from "../../lib/config.js";
import { isCommandEnabled, isDatabaseReady, isWaBanned, recordWaIncoming } from "../../lib/db.js";
import { addXp } from "../../lib/xp-storage.js";
import { isBalanceFrozen } from "../../lib/casino-storage.js";
import { rollXp } from "../../lib/xp.js";
import { findCommand } from "./commands/index.js";
import { menuCommand } from "./commands/menu.js";
import { maybeHandlePlayReply } from "./commands/play.js";
import { maybeHandleWordleReply } from "./commands/wordle.js";
import { generateGeminiReply, geminiChatErrorMessage, type GeminiImage } from "../../lib/gemini-chat.js";
import { consumeStickerExplanation, findCatalogSticker, getStickerForName, getStickerOptions, requestStickerExplanation, whatsappStickerId } from "../../lib/sticker-catalog.js";
import { runOwnerToggle, runToggle } from "./commands/toggle.js";
import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { runtimeOptions, writeLog } from "../../lib/runtime.js";
import { replyTo, sendSticker, sendText, wasSentByBot } from "./reply.js";
import type { IncomingMessage } from "./types.js";
import { readFile } from "node:fs/promises";
import { handleShellMessage, isBotPaused, isShellResumeCommand } from "../shell.js";
import { downloadMedia } from "./message.js";

const MAX_AI_IMAGE_BYTES = 8 * 1024 * 1024;

interface ParsedCommand {
  prefix: string;
  name: string;
  args: string;
}

// Splits ".<name> <args>" (or "$"/"!") into its parts. Returns null when the
// text is not a command, so ordinary chat is never answered.
function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  const first = trimmed.charAt(0);
  const prefixes = [getCommandPrefix(), getOwnerPrefix(), getAdminPrefix()];
  if (!prefixes.includes(first)) return null;

  const rest = trimmed.slice(1).trim();
  const match = /^([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(rest);
  if (!match) return null;

  return { prefix: first, name: (match[1] ?? "").toLowerCase(), args: (match[2] ?? "").trim() };
}

function whatsappMentionsBot(message: IncomingMessage): boolean {
  const content = normalizeMessageContent(message.message.message);
  if (!content) return false;
  const mentioned = [
    ...(content.extendedTextMessage?.contextInfo?.mentionedJid ?? []),
    ...(content.imageMessage?.contextInfo?.mentionedJid ?? []),
    ...(content.videoMessage?.contextInfo?.mentionedJid ?? []),
    ...(content.documentMessage?.contextInfo?.mentionedJid ?? []),
  ].map(normalizeJid);
  const botIds = [message.sock.user?.id, message.sock.user?.lid]
    .filter((id): id is string => typeof id === "string")
    .map(normalizeJid);
  return mentioned.some((id) => botIds.includes(id));
}

function removeWhatsAppBotMention(text: string, message: IncomingMessage): string {
  const botId = message.sock.user?.id ?? message.sock.user?.lid;
  const number = botId?.split("@")[0]?.split(":")[0];
  const mention = number && /^\d+$/.test(number)
    ? new RegExp(`(^|\\s)@${number}(?=$|[\\s,.:!?])`, "g")
    : /(^|\s)@[\d.()+ -]+(?=$|[\s,.:!?])/g;
  return text.replace(mention, "$1").trim();
}

async function runWhatsAppAiReply(
  message: IncomingMessage,
  role: "owner" | "admin" | "member",
  prompt: string,
  image?: GeminiImage,
): Promise<void> {
  const reply = replyTo(message);
  const quota = getQuota("whatsapp", message.userId, role, message.name);
  if (role !== "owner" && quota.quotaLeft < 1) {
    await sendText(reply, `Kuota harian habis. Diatur ulang dalam ${formatWait(quota.resetInSeconds)}.`);
    return;
  }
  const rate = checkRateLimit("whatsapp", message.userId);
  if (!rate.allowed) {
    await sendText(reply, `Terlalu banyak permintaan. Coba lagi dalam ${formatWait(rate.retryAfterSeconds)}.`);
    return;
  }

  const pending = consumeStickerExplanation("whatsapp", message.chatId, message.userId);
  const contextualPrompt = pending
    ? `Konteks: pengguna baru saja menjelaskan arti stiker yang belum dikenal. Gunakan penjelasan ini sekali saja.\nPenjelasan pengguna: ${prompt}`
    : prompt;
  try {
    const response = await generateGeminiReply(
      "whatsapp",
      message.userId,
      contextualPrompt,
      message.chatId,
      role === "owner",
      getStickerOptions("whatsapp"),
      message.name ?? "",
      image,
    );
    if (role !== "owner") consumeQuota("whatsapp", message.userId);
    await sendText(reply, response.text);
    if (response.stickerName) {
      const sticker = getStickerForName("whatsapp", response.stickerName);
      if (sticker?.stickerData) await sendSticker(reply, Buffer.from(sticker.stickerData)).catch(() => undefined);
    }
  } catch (error) {
    await sendText(reply, geminiChatErrorMessage(error));
  }
}

async function handleWhatsAppSticker(message: IncomingMessage): Promise<void> {
  const content = normalizeMessageContent(message.message.message);
  if (!content?.stickerMessage) return;
  let stickerId = whatsappStickerId(message.message);
  let stickerData: Uint8Array | undefined;
  if (!stickerId) {
    stickerData = await downloadMedia(message.message, message.sock);
    stickerId = whatsappStickerId(message.message, stickerData);
  }
  const entry = stickerId ? findCatalogSticker("whatsapp", stickerId) : null;
  if (!entry) {
    const rate = checkRateLimit("whatsapp", message.userId);
    const reply = replyTo(message);
    if (!rate.allowed) {
      await sendText(reply, `Terlalu banyak permintaan. Coba lagi dalam ${formatWait(rate.retryAfterSeconds)}.`);
      return;
    }
    requestStickerExplanation("whatsapp", message.chatId, message.userId);
    await sendText(reply, "Stiker ini belum Mommy kenal. Jelasin artinya dong, biar Mommy bisa nanggepin dengan benar?");
    return;
  }

  await runWhatsAppAiReply(
    message,
    resolveRole(message.phone, false),
    `Pengguna mengirim stiker bernama “${entry.name}”. Deskripsi: ${entry.description}. Tanggapi makna atau reaksinya secara alami.`,
  );
}

async function handleWhatsAppImage(message: IncomingMessage, prompt: string): Promise<void> {
  const imageMessage = normalizeMessageContent(message.message.message)?.imageMessage;
  if (!imageMessage) return;
  try {
    const data = await downloadMedia(message.message, message.sock);
    if (data.byteLength > MAX_AI_IMAGE_BYTES) {
      await sendText(replyTo(message), "Gambarnya terlalu besar untuk Mommy lihat. Coba kirim gambar yang lebih kecil, ya?");
      return;
    }
    await runWhatsAppAiReply(
      message,
      resolveRole(message.phone, false),
      prompt || "Lihat gambar yang kukirim dan tanggapi secara alami.",
      { mimeType: imageMessage.mimetype || "image/jpeg", data },
    );
  } catch (error) {
    console.error("Gagal mengunduh gambar WhatsApp untuk AI:", error);
    await sendText(replyTo(message), "Mommy gagal membuka gambarnya. Coba kirim ulang, ya?");
  }
}

// Group admin status, cached briefly because we only need it to grant the admin
// role and fetching metadata on every message would be wasteful.
const groupAdminCache = new Map<string, { value: boolean; expires: number }>();
const GROUP_ADMIN_CACHE_MS = 5 * 60 * 1000;

async function isGroupAdmin(message: IncomingMessage): Promise<boolean> {
  if (!message.isGroup) return false;

  const key = `${message.chatId}:${message.senderJid}`;
  const now = Date.now();
  const cached = groupAdminCache.get(key);
  if (cached && cached.expires > now) return cached.value;

  let value = false;
  try {
    const metadata = await message.sock.groupMetadata(message.chatId);
    const wanted = new Set(
      [message.senderJid, message.senderAlt].filter((id): id is string => typeof id === "string"),
    );
    for (const participant of metadata.participants) {
      const ids = [participant.id, participant.phoneNumber, participant.lid].filter(
        (id): id is string => typeof id === "string",
      );
      if (ids.some((id) => wanted.has(id))) {
        value = participant.admin === "admin" || participant.admin === "superadmin";
        break;
      }
    }
  } catch (error) {
    console.error("Gagal mengambil metadata grup WhatsApp:", error);
  }

  groupAdminCache.set(key, { value, expires: now + GROUP_ADMIN_CACHE_MS });
  return value;
}

// The main entry point: decides the sender's role, applies the shared anti-abuse
// rules (ban, rate limit, daily quota), then runs the matching command.
export async function handleIncoming(message: IncomingMessage): Promise<void> {
  const commandName = parseCommand(message.text)?.name ?? "none";
  const sender = message.phone ? `+${message.phone}` : message.userId;
  writeLog(
    "INTERACTION",
    `platform=whatsapp message_id=${message.message?.key?.id ?? "unknown"} sender=${sender} sender_ip=not_exposed_by_platform chat_id=${message.chatId}${message.isGroup ? ` group_id=${message.chatId}` : ""} chat_type=${message.isGroup ? "group" : "private"} command=${commandName}`,
  );
  const hasSticker = Boolean(normalizeMessageContent(message.message.message)?.stickerMessage);
  const hasImage = Boolean(normalizeMessageContent(message.message.message)?.imageMessage);

  // We use the number-based role for these cheap, offline gates (the group-admin
  // role needs a metadata lookup and cannot be banned anyway).
  const baseRole = resolveRole(message.phone, false);
  if (isBotPaused() && !(baseRole === "owner" && isShellResumeCommand(message.text))) return;

  if (baseRole === "member" && isWaBanned(message.userId)) {
    const messageKey = message.message.key;
    if (message.isGroup && messageKey.id) {
      await message.sock.sendMessage(message.chatId, {
        delete: { ...messageKey, participant: message.senderJid, fromMe: false },
      }).catch(() => undefined);
    }
    return;
  }
  if (!message.text && !hasSticker && !hasImage) return;

  const shellHandled = message.text ? await handleShellMessage({
    platform: "whatsapp",
    userId: message.userId,
    chatId: message.chatId,
    isOwner: baseRole === "owner",
    isPrivate: !message.isGroup,
    text: message.text,
    reply: (text) => sendText(replyTo(message), text),
    sendSecretPhoto: async (path, index, total) => {
      await message.sock.sendMessage(message.chatId, {
        image: await readFile(path),
        caption: `Foto ${index}/${total}`,
      });
    },
  }) : false;
  if (shellHandled) return;

  // Group allowlist: with GROUP_ONLY on, members may only use the bot in listed
  // groups. Owner and admins (by number) are never restricted, which also lets
  // them run ".userinfo" in a group to read its id and add it later. Ignored
  // groups are dropped silently so the bot never replies where it is not wanted.
  if (message.isGroup && baseRole === "member" && !isGroupAllowed(message.chatId)) return;

  const reply = replyTo(message);

  if (message.text.trim().toLowerCase() === "jarvis") {
    if (!isEveryoneAllowed() && baseRole === "member") {
      return;
    }
    await sendText(reply, "siap,pak");
    await menuCommand.run({ message, args: "", role: baseRole });
    return;
  }

  // Let an in-progress ".play" consume a plain number/format reply first.
  if (await maybeHandlePlayReply(message)) return;

  const parsed = parseCommand(message.text);
  if (!parsed) {
    if (!isEveryoneAllowed() && baseRole === "member") return;
    if (message.text && await maybeHandleWordleReply(message)) return;
    if (!isCommandEnabled("ai")) return;
    if (message.isGroup) {
      if (!whatsappMentionsBot(message)) return;
      const prompt = message.text ? removeWhatsAppBotMention(message.text, message) : "";
      if (hasImage) await handleWhatsAppImage(message, prompt);
      else if (prompt) await runWhatsAppAiReply(message, baseRole, prompt);
      return;
    }
    if (hasImage) {
      await handleWhatsAppImage(message, message.text.trim());
      return;
    }
    if (hasSticker) {
      await handleWhatsAppSticker(message);
      return;
    }
    if (message.text.trim()) await runWhatsAppAiReply(message, baseRole, message.text.trim());
    return;
  }

  const adminUtility =
    parsed.prefix === getAdminPrefix() &&
    parsed.args === "" &&
    (parsed.name === "ping" || parsed.name === "groupinfo");
  let groupAdmin = adminUtility ? await isGroupAdmin(message) : false;

  // Private-bot mode still lets verified group admins use the admin utilities.
  if (!isEveryoneAllowed() && baseRole === "member" && !(adminUtility && message.isGroup && groupAdmin)) {
    return;
  }

  if (!adminUtility) groupAdmin = await isGroupAdmin(message);

  // Group admins gain the admin role for command gating.
  const role = resolveRole(message.phone, groupAdmin);

  if (parsed.prefix === getOwnerPrefix() && parsed.name === "toggle") {
    await runOwnerToggle(message, parsed.args, role);
    return;
  }

  if (parsed.prefix === getCommandPrefix() && parsed.name === "d") {
    await deleteRepliedMessage(message, parsed.args);
    return;
  }

  if (isDatabaseReady()) {
    try {
      recordWaIncoming({
        userId: message.userId,
        displayName: message.name,
        command: parsed.name,
      });
    } catch (error) {
      console.error("Gagal mencatat aktivitas WhatsApp:", error);
    }
  }

  const commandPrefix = getCommandPrefix();

  let command = findCommand(parsed.name);
  let adminPrefixCommand = false;

  // Keep the existing toggle syntax while allowing the two admin utilities.
  if (parsed.prefix === getAdminPrefix()) {
    if (parsed.args === "" && (parsed.name === "ping" || parsed.name === "groupinfo")) {
      adminPrefixCommand = true;
    } else {
      await runToggle(message, `${parsed.name} ${parsed.args}`.trim(), role);
      return;
    }
  }

  if (adminPrefixCommand && role !== "owner" && (!message.isGroup || !groupAdmin)) {
    await sendText(reply, "Ã°Å¸Å¡Â« Perintah ini hanya untuk admin grup dan pemilik bot.");
    return;
  }
  if (adminPrefixCommand && parsed.name === "groupinfo" && !message.isGroup) {
    await sendText(reply, "Perintah ini hanya dapat digunakan di grup.");
    return;
  }

  // "$command" Ã¢â‚¬â€ explicit owner-only invocation.
  if (parsed.prefix === getOwnerPrefix()) {
    if (!command || (!command.ownerOnly && !command.groupOnly)) {
      await sendText(reply, "Perintah tidak dikenal.");
      return;
    }
    if (role !== "owner") {
      await sendText(reply, "Ã°Å¸Å¡Â« Perintah ini hanya dapat digunakan pemilik bot.");
      return;
    }
  } else if (!command) {
    await sendText(reply, `Perintah tidak dikenal. Kirim ${commandPrefix}menu untuk melihat daftar perintah.`);
    return;
  }

  if (!command) return;

  if (command.ownerOnly && role !== "owner") {
    await sendText(reply, "Ã°Å¸Å¡Â« Perintah ini hanya dapat digunakan pemilik bot.");
    return;
  }
  if (command.adminOnly && role === "member") {
    await sendText(reply, "Ã°Å¸Å¡Â« Hanya admin dan pemilik bot yang dapat menggunakan perintah ini.");
    return;
  }

  if (command.groupOnly && !message.isGroup && !(parsed.prefix === getOwnerPrefix() && role === "owner")) {
    await sendText(reply, "Fitur ini hanya untuk grup.");
    return;
  }

  if (!isCommandEnabled(command.name)) {
    await sendText(reply, "Ã¢Å¡Â Ã¯Â¸Â Perintah ini sedang dinonaktifkan.");
    return;
  }

  if (command.validate) {
    const validationError = command.validate(parsed.args, message.userId);
    if (validationError) {
      await sendText(reply, validationError);
      return;
    }
  }

  if (command.quotaCost && isBalanceFrozen(message.userId)) {
    await sendText(reply, "Saldo wallet dibekukan karena ada pinjaman jatuh tempo. Lunasi pinjaman terlebih dahulu.");
    return;
  }

  if (command.quotaCost && role !== "owner") {
    const quota = getQuota("whatsapp", message.userId, role, message.name);
    if (quota.quotaLeft < command.quotaCost) {
      await sendText(reply, `⚠️ Kuota harian tidak cukup. Kasino memakai ${command.quotaCost} kuota per aksi.`);
      return;
    }
  }

  const rate = checkRateLimit("whatsapp", message.userId);
  if (!rate.allowed) {
    await sendText(reply, `Ã¢ÂÂ³ Terlalu banyak permintaan. Coba lagi dalam ${formatWait(rate.retryAfterSeconds)}.`);
    return;
  }

  const quotaFree = command.free === true;
  if (!quotaFree && !command.quotaCost && role !== "owner") {
    const quota = getQuota("whatsapp", message.userId, role, message.name);
    if (quota.quotaLeft < (command.quotaCost ?? 1)) {
      await sendText(reply, `Ã°Å¸Å¡Â« Kuota harian habis. Diatur ulang dalam ${formatWait(quota.resetInSeconds)}.`);
      return;
    }
  }

  try {
    writeLog("COMMAND", `whatsapp ${parsed.prefix}${parsed.name} started`);
    if (command.quotaCost && role !== "owner") consumeQuota("whatsapp", message.userId, command.quotaCost);
    await command.run({
      message,
      args: parsed.args,
      role,
      ownerOverride: parsed.prefix === getOwnerPrefix() && role === "owner" && command.groupOnly === true,
    });
    if (command.awardXp !== false) {
      await addXp({
        platform: "whatsapp",
        chatId: message.chatId,
        userId: message.userId,
        displayName: message.name,
        amount: rollXp(),
      });
    }
    writeLog("COMMAND", `whatsapp ${parsed.prefix}${parsed.name} status=success`);
  } catch (error) {
    writeLog("ERROR", `whatsapp ${parsed.prefix}${command.name} status=failed`);
    console.error(`Perintah WhatsApp .${command.name} gagal:`, error);
    await sendText(
      reply,
      `Perintah gagal: ${error instanceof Error ? error.message : String(error)}`,
    ).catch(() => undefined);
  }

  if (!quotaFree && !command.quotaCost && role !== "owner") consumeQuota("whatsapp", message.userId);
}

function normalizeJid(jid: string): string {
  const [user, server] = jid.split("@");
  return `${user?.split(":")[0] ?? ""}@${server ?? ""}`;
}

async function isWhatsAppBotGroupAdmin(message: IncomingMessage): Promise<boolean> {
  if (!message.isGroup) return false;
  try {
    const botIds = [message.sock.user?.id, message.sock.user?.lid]
      .filter((id): id is string => typeof id === "string")
      .map(normalizeJid);
    const metadata = await message.sock.groupMetadata(message.chatId);
    return metadata.participants.some((participant) => {
      const ids = [participant.id, participant.phoneNumber, participant.lid]
        .filter((id): id is string => typeof id === "string")
        .map(normalizeJid);
      return ids.some((id) => botIds.includes(id)) &&
        (participant.admin === "admin" || participant.admin === "superadmin");
    });
  } catch {
    return false;
  }
}

async function deleteRepliedMessage(message: IncomingMessage, args: string): Promise<void> {
  const reply = replyTo(message);
  if (args) {
    await sendText(reply, "Format: balas pesan dengan .d tanpa argumen.");
    return;
  }
  if (!isCommandEnabled("d")) {
    await sendText(reply, "Perintah ini sedang dinonaktifkan.");
    return;
  }

  const target = message.quoted;
  if (!target?.key.id) {
    await sendText(reply, "Balas pesan yang ingin dihapus dengan .d.");
    return;
  }

  const isBotMessage = target.key.fromMe === true || wasSentByBot(message.chatId, target.key.id);

  if (!isBotMessage) {
    if (!message.isGroup) {
      await sendText(reply, "Perintah ini hanya bisa menghapus pesan bot di chat pribadi.");
      return;
    }
    if (!(await isWhatsAppBotGroupAdmin(message))) {
      await sendText(reply, "Bot ini hanya bisa hapus pesan yang dikirim bot, untuk hapus pesan anggota, jadikan bot ini sebagai admin");
      return;
    }
  }

  await message.sock.sendMessage(message.chatId, {
    delete: { ...target.key, fromMe: isBotMessage },
  });
  writeLog("COMMAND", `whatsapp .d deleted_message_id=${target.key.id} bot_message=${isBotMessage}`);
}
