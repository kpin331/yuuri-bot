import { resolveRole } from "../../../core/access.js";
import { formatDuration, parseBanArgs } from "../../../lib/ban.js";
import { getCommandPrefix } from "../../../lib/config.js";
import { addWaBan, isDatabaseReady, removeWaBan } from "../../../lib/db.js";
import { canonicalUserId, isLidId } from "../identity.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

interface Resolved {
  userId: string;
  label: string;
}

function labelFor(id: string): string {
  return isLidId(id) ? id : `+${id}`;
}

// Resolves the ban target: an explicit number/@number, or the sender of the
// message being replied to. The reply path is the most reliable because it uses
// the exact id WhatsApp gave us (phone number or LID).
function resolveTarget(
  token: string | null,
  quotedUserId: string | null,
): Resolved | null {
  if (token === null) {
    return quotedUserId ? { userId: quotedUserId, label: labelFor(quotedUserId) } : null;
  }
  const digits = token.replace(/^@/, "").replace(/\D/g, "");
  if (digits.length === 0) return null;
  return { userId: digits, label: `+${digits}` };
}

function quotedSenderId(message: Parameters<WaCommand["run"]>[0]["message"]): string | null {
  const quoted = message.quoted;
  if (!quoted) return null;
  const jid = quoted.key.participant ?? quoted.key.remoteJid ?? null;
  return canonicalUserId(jid, null);
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

const banCommand: WaCommand = {
  name: "ban",
  adminOnly: true,
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    const prefix = getCommandPrefix();

    if (!isDatabaseReady()) {
      await sendText(reply, "Storage is unavailable, so bans can't be saved.");
      return;
    }

    const parsed = parseBanArgs(args);
    if (!parsed.ok) {
      await sendText(reply, `Usage: ${prefix}ban <number> [-d<days>|-h<hours>|<seconds>] — ${parsed.error}`);
      return;
    }

    const target = resolveTarget(parsed.target, quotedSenderId(message));
    if (!target) {
      await sendText(
        reply,
        "Reply to the user's message, or provide a number (e.g. 6281234567890).",
      );
      return;
    }

    if (resolveRole(target.userId.startsWith("lid:") ? null : target.userId, false) !== "member") {
      await sendText(reply, "🚫 You can't ban an admin or the owner.");
      return;
    }

    const now = Date.now();
    const expiresAt = now + parsed.seconds * 1000;
    addWaBan({ userId: target.userId, bannedBy: message.userId, createdAt: now, expiresAt });

    await sendText(
      reply,
      `✅ Banned ${target.label} (${target.userId}) for ${formatDuration(parsed.seconds)} — until ${formatDate(expiresAt)}.`,
    );
  },
};

const unbanCommand: WaCommand = {
  name: "unban",
  adminOnly: true,
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    const prefix = getCommandPrefix();

    if (!isDatabaseReady()) {
      await sendText(reply, "Storage is unavailable, so bans can't be changed.");
      return;
    }

    const tokens = args.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      await sendText(reply, `Usage: ${prefix}unban <number> (or reply to the user's message).`);
      return;
    }

    const target = resolveTarget(tokens[0] ?? null, quotedSenderId(message));
    if (!target) {
      await sendText(reply, "Reply to the user's message, or provide a number to unban.");
      return;
    }

    if (removeWaBan(target.userId)) {
      await sendText(reply, `✅ Unbanned ${target.label} (${target.userId}).`);
    } else {
      await sendText(reply, `${target.label} (${target.userId}) is not currently banned.`);
    }
  },
};

export const banCommands: WaCommand[] = [banCommand, unbanCommand];
