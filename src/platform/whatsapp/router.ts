import { checkRateLimit, consumeQuota, getQuota, resolveRole } from "../../core/access.js";
import { formatWait } from "../../core/time.js";
import {
  getAdminPrefix,
  getCommandPrefix,
  getOwnerPrefix,
  isEveryoneAllowed,
} from "../../lib/config.js";
import { isCommandEnabled, isDatabaseReady, isWaBanned, recordWaIncoming } from "../../lib/db.js";
import { findCommand } from "./commands/index.js";
import { maybeHandlePlayReply } from "./commands/play.js";
import { runToggle } from "./commands/toggle.js";
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
    console.error("WhatsApp group metadata lookup failed:", error);
  }

  groupAdminCache.set(key, { value, expires: now + GROUP_ADMIN_CACHE_MS });
  return value;
}

// The main entry point: decides the sender's role, applies the shared anti-abuse
// rules (ban, rate limit, daily quota), then runs the matching command.
export async function handleIncoming(message: IncomingMessage): Promise<void> {
  if (!message.text) return;

  const reply = replyTo(message);

  // Banned members are ignored silently; admins and the owner are never blocked.
  // We use the number-based role here so this stays a cheap, offline check (the
  // group-admin role needs a metadata lookup and cannot be banned anyway).
  const baseRole = resolveRole(message.phone, false);
  if (baseRole === "member" && isWaBanned(message.userId)) return;

  // Let an in-progress ".play" consume a plain number/format reply first.
  if (await maybeHandlePlayReply(message)) return;

  const parsed = parseCommand(message.text);
  if (!parsed) return;

  // Private-bot mode, mirroring the Telegram EVERYONE switch. Only configured
  // owner/admins (by number) count here, not group admins.
  if (!isEveryoneAllowed() && baseRole === "member") {
    await sendText(reply, "🚫 This bot is private. Only the owner can use it.");
    return;
  }

  // Group admins gain the admin role for command gating.
  const groupAdmin = await isGroupAdmin(message);
  const role = resolveRole(message.phone, groupAdmin);

  if (isDatabaseReady()) {
    try {
      recordWaIncoming({
        userId: message.userId,
        displayName: message.name,
        command: parsed.name,
      });
    } catch (error) {
      console.error("Failed to record WhatsApp activity:", error);
    }
  }

  const commandPrefix = getCommandPrefix();

  // "!command on|off" — administrative toggle, handled before normal lookup.
  if (parsed.prefix === getAdminPrefix()) {
    await runToggle(message, `${parsed.name} ${parsed.args}`.trim(), role);
    return;
  }

  const command = findCommand(parsed.name);

  // "$command" — explicit owner-only invocation.
  if (parsed.prefix === getOwnerPrefix()) {
    if (!command || !command.ownerOnly) {
      await sendText(reply, "Unknown command.");
      return;
    }
    if (role !== "owner") {
      await sendText(reply, "🚫 This command is owner-only.");
      return;
    }
  } else if (!command) {
    await sendText(reply, `Unknown command. Send ${commandPrefix}menu for the list.`);
    return;
  }

  if (!command) return;

  if (command.ownerOnly && role !== "owner") {
    await sendText(reply, "🚫 This command is owner-only.");
    return;
  }
  if (command.adminOnly && role === "member") {
    await sendText(reply, "🚫 Only admins and the owner can use this command.");
    return;
  }

  if (!isCommandEnabled(command.name)) {
    await sendText(reply, "⚠️ This command is currently disabled.");
    return;
  }

  const rate = checkRateLimit("whatsapp", message.userId);
  if (!rate.allowed) {
    await sendText(reply, `⏳ Too many requests. Try again in ${formatWait(rate.retryAfterSeconds)}.`);
    return;
  }

  const quotaFree = command.free === true;
  if (!quotaFree && role !== "owner") {
    const quota = getQuota("whatsapp", message.userId, role, message.name);
    if (quota.quotaLeft <= 0) {
      await sendText(reply, `🚫 Daily quota reached. Resets in ${formatWait(quota.resetInSeconds)}.`);
      return;
    }
  }

  try {
    await command.run({ message, args: parsed.args, role });
  } catch (error) {
    console.error(`WhatsApp command .${command.name} failed:`, error);
    await sendText(
      reply,
      `Command failed: ${error instanceof Error ? error.message : String(error)}`,
    ).catch(() => undefined);
  }

  if (!quotaFree && role !== "owner") consumeQuota("whatsapp", message.userId);
}
