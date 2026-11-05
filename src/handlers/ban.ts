import type { Bot, Context } from "grammy";
import type { User } from "grammy/types";
import { formatDuration, parseBanArgs } from "../lib/ban.js";
import { registerCommand } from "../lib/command.js";
import { isAuthorized } from "../lib/config.js";
import { addBan, findUserByUsername, isBanned, isDatabaseReady, removeBan } from "../lib/db.js";
import { escapeHtml } from "../lib/info.js";

type Resolved =
  | { ok: true; userId: number; label: string }
  | { ok: false; error: string };

function displayName(user: Pick<User, "first_name" | "last_name" | "username" | "id">): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return String(user.id);
}

function resolveTarget(ctx: Context, token: string | null): Resolved {
  if (token === null) {
    const replied = ctx.message?.reply_to_message?.from;
    if (!replied) {
      return {
        ok: false,
        error: "Balas pesan pengguna, atau masukkan @username maupun ID pengguna.",
      };
    }
    return { ok: true, userId: replied.id, label: displayName(replied) };
  }

  if (token.startsWith("@")) {
    const record = findUserByUsername(token);
    if (!record) {
      return {
        ok: false,
        error:
          `${token} tidak dapat ditemukan. Bot hanya mengenali pengguna yang pernah berinteraksi dengannya. ` +
          "Balas salah satu pesannya atau masukkan ID Telegram pengguna tersebut.",
      };
    }
    const name = [record.firstName, record.lastName].filter(Boolean).join(" ").trim();
    const label = name || (record.username ? `@${record.username}` : String(record.userId));
    return { ok: true, userId: record.userId, label };
  }

  if (/^\d+$/.test(token)) {
    const id = Number(token);
    if (!Number.isSafeInteger(id)) return { ok: false, error: "ID pengguna tidak valid." };
    return { ok: true, userId: id, label: `user ${id}` };
  }

  return {
    ok: false,
    error: "Masukkan @username, ID pengguna, atau balas pesan pengguna tersebut.",
  };
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// Runs early (before tracking/commands) and silently ignores messages from
// actively banned users who are not admins or the owner. No notice is sent on
// every interaction, and no ordinary statistics are collected for them.
export function registerBanGuard(bot: Bot): void {
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId === undefined) return next();
    if (isAuthorized(userId)) return next();
    if (isBanned(userId)) {
      const chat = ctx.chat;
      const message = ctx.message;
      if ((chat?.type === "group" || chat?.type === "supergroup") && message) {
        await ctx.api.deleteMessage(chat.id, message.message_id).catch(() => undefined);
      }
      return;
    }
    return next();
  });
}

async function requireAuthorized(ctx: Context): Promise<boolean> {
  if (isAuthorized(ctx.from?.id)) return true;
  await ctx.reply("🚫 Hanya admin dan pemilik bot yang dapat menggunakan perintah ini.").catch(() => undefined);
  return false;
}

async function handleBan(ctx: Context, commandName: "ban" | "bangroup" = "ban"): Promise<void> {
  if (!(await requireAuthorized(ctx))) return;
  if (!isDatabaseReady()) {
    await ctx.reply("Penyimpanan tidak tersedia. Pemblokiran tidak dapat disimpan.");
    return;
  }

  const raw = typeof ctx.match === "string" ? ctx.match : "";
  const parsed = parseBanArgs(raw);
  if (!parsed.ok) {
    await ctx.reply(`Cara pakai: /${commandName} <@username|id> [-d<hari>|-h<jam>|<detik>] — ${parsed.error}`);
    return;
  }

  const resolved = resolveTarget(ctx, parsed.target);
  if (!resolved.ok) {
    await ctx.reply(resolved.error);
    return;
  }

  if (isAuthorized(resolved.userId)) {
    await ctx.reply("🚫 Admin dan pemilik bot tidak dapat diblokir.");
    return;
  }

  const now = Date.now();
  const expiresAt = now + parsed.seconds * 1000;
  addBan({ userId: resolved.userId, bannedBy: ctx.from?.id ?? null, createdAt: now, expiresAt });

  await ctx.reply(
    `✅ <b>${escapeHtml(resolved.label)}</b> (<code>${resolved.userId}</code>) diblokir ` +
      `selama ${formatDuration(parsed.seconds)} — sampai ${formatDate(expiresAt)}.`,
    { parse_mode: "HTML" },
  );
}

async function handleUnban(ctx: Context): Promise<void> {
  if (!(await requireAuthorized(ctx))) return;
  if (!isDatabaseReady()) {
    await ctx.reply("Penyimpanan tidak tersedia. Status blokir tidak dapat diubah.");
    return;
  }

  const raw = typeof ctx.match === "string" ? ctx.match : "";
  // An unban takes only a target; reject stray duration tokens.
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    await ctx.reply("Cara pakai: /unban <@username|id> atau balas pesan pengguna.");
    return;
  }

  const resolved = resolveTarget(ctx, tokens[0] ?? null);
  if (!resolved.ok) {
    await ctx.reply(resolved.error);
    return;
  }

  const removed = removeBan(resolved.userId);
  if (removed) {
    await ctx.reply(
      `✅ Blokir untuk <b>${escapeHtml(resolved.label)}</b> (<code>${resolved.userId}</code>) dibuka.`,
      { parse_mode: "HTML" },
    );
  } else {
    await ctx.reply(
      `<b>${escapeHtml(resolved.label)}</b> (<code>${resolved.userId}</code>) tidak sedang diblokir.`,
      { parse_mode: "HTML" },
    );
  }
}

export function registerBan(bot: Bot): void {
  registerCommand(bot, "ban", (ctx) => handleBan(ctx, "ban"));
  registerCommand(bot, "bangroup", (ctx) => handleBan(ctx, "bangroup"));
  registerCommand(bot, "unban", handleUnban);
}
