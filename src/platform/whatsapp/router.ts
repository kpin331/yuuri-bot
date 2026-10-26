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
import { addXp } from "../../lib/postgres.js";
import { rollXp } from "../../lib/xp.js";
import { findCommand } from "./commands/index.js";
import { maybeHandlePlayReply } from "./commands/play.js";
import { runToggle } from "./commands/toggle.js";
import { writeLog } from "../../lib/runtime.js";
import { replyTo, sendText } from "./reply.js";
import type { IncomingMessage } from "./types.js";

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
  const match = /^([A-Za-z0-9_]+)(?:\s+([\s\S]*))?$/.exec(rest);
  if (!match) return null;

  return { prefix: first, name: (match[1] ?? "").toLowerCase(), args: (match[2] ?? "").trim() };
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
  if (!message.text) return;

  // We use the number-based role for these cheap, offline gates (the group-admin
  // role needs a metadata lookup and cannot be banned anyway).
  const baseRole = resolveRole(message.phone, false);

  // Group allowlist: with GROUP_ONLY on, members may only use the bot in listed
  // groups. Owner and admins (by number) are never restricted, which also lets
  // them run ".userinfo" in a group to read its id and add it later. Ignored
  // groups are dropped silently so the bot never replies where it is not wanted.
  if (message.isGroup && baseRole === "member" && !isGroupAllowed(message.chatId)) return;

  const reply = replyTo(message);

  // Banned members are ignored silently; admins and the owner are never blocked.
  if (baseRole === "member" && isWaBanned(message.userId)) return;

  // Let an in-progress ".play" consume a plain number/format reply first.
  if (await maybeHandlePlayReply(message)) return;

  const parsed = parseCommand(message.text);
  if (!parsed) return;

  const adminUtility =
    parsed.prefix === getAdminPrefix() &&
    parsed.args === "" &&
    (parsed.name === "ping" || parsed.name === "groupinfo");
  let groupAdmin = adminUtility ? await isGroupAdmin(message) : false;

  // Private-bot mode still lets verified group admins use the admin utilities.
  if (!isEveryoneAllowed() && baseRole === "member" && !(adminUtility && message.isGroup && groupAdmin)) {
    await sendText(reply, "🚫 Bot ini bersifat privat. Hanya pemilik yang dapat menggunakannya.");
    return;
  }

  if (!adminUtility) groupAdmin = await isGroupAdmin(message);

  // Group admins gain the admin role for command gating.
  const role = resolveRole(message.phone, groupAdmin);

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
    await sendText(reply, "🚫 Perintah ini hanya untuk admin grup dan pemilik bot.");
    return;
  }
  if (adminPrefixCommand && parsed.name === "groupinfo" && !message.isGroup) {
    await sendText(reply, "Perintah ini hanya dapat digunakan di grup.");
    return;
  }

  // "$command" — explicit owner-only invocation.
  if (parsed.prefix === getOwnerPrefix()) {
    if (!command || !command.ownerOnly) {
      await sendText(reply, "Perintah tidak dikenal.");
      return;
    }
    if (role !== "owner") {
      await sendText(reply, "🚫 Perintah ini hanya dapat digunakan pemilik bot.");
      return;
    }
  } else if (!command) {
    await sendText(reply, `Perintah tidak dikenal. Kirim ${commandPrefix}menu untuk melihat daftar perintah.`);
    return;
  }

  if (!command) return;

  if (command.ownerOnly && role !== "owner") {
    await sendText(reply, "🚫 Perintah ini hanya dapat digunakan pemilik bot.");
    return;
  }
  if (command.adminOnly && role === "member") {
    await sendText(reply, "🚫 Hanya admin dan pemilik bot yang dapat menggunakan perintah ini.");
    return;
  }

  if (!isCommandEnabled(command.name)) {
    await sendText(reply, "⚠️ Perintah ini sedang dinonaktifkan.");
    return;
  }

  const rate = checkRateLimit("whatsapp", message.userId);
  if (!rate.allowed) {
    await sendText(reply, `⏳ Terlalu banyak permintaan. Coba lagi dalam ${formatWait(rate.retryAfterSeconds)}.`);
    return;
  }

  const quotaFree = command.free === true;
  if (!quotaFree && role !== "owner") {
    const quota = getQuota("whatsapp", message.userId, role, message.name);
    if (quota.quotaLeft <= 0) {
      await sendText(reply, `🚫 Kuota harian habis. Diatur ulang dalam ${formatWait(quota.resetInSeconds)}.`);
      return;
    }
  }

  try {
    writeLog("COMMAND", `whatsapp ${parsed.prefix}${parsed.name} started`);
    await command.run({ message, args: parsed.args, role });
    await addXp({
      platform: "whatsapp",
      chatId: message.chatId,
      userId: message.userId,
      displayName: message.name,
      amount: rollXp(),
    });
    writeLog("COMMAND", `whatsapp ${parsed.prefix}${parsed.name} status=success`);
  } catch (error) {
    writeLog("ERROR", `whatsapp ${parsed.prefix}${command.name} status=failed`);
    console.error(`Perintah WhatsApp .${command.name} gagal:`, error);
    await sendText(
      reply,
      `Perintah gagal: ${error instanceof Error ? error.message : String(error)}`,
    ).catch(() => undefined);
  }

  if (!quotaFree && role !== "owner") consumeQuota("whatsapp", message.userId);
}
