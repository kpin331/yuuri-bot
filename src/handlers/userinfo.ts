import type { Bot, Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { findUserByUsername, getStats, isDatabaseReady } from "../lib/db.js";
import { escapeHtml } from "../lib/info.js";
import { getProfilePhotoFileId } from "./commands.js";

interface Target {
  userId: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  isSelf: boolean;
}

function displayName(target: Target): string {
  const name = [target.firstName, target.lastName].filter(Boolean).join(" ").trim();
  return name || target.username || String(target.userId);
}

function maskId(id: number): string {
  const value = String(id);
  return "•".repeat(Math.max(0, value.length - 4)) + value.slice(-4);
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function resolveTarget(ctx: Context): Target | null | "unknown-username" {
  const from = ctx.from;
  const arg = typeof ctx.match === "string" ? ctx.match.trim() : "";
  const replied = ctx.message?.reply_to_message?.from;

  if (arg.startsWith("@")) {
    if (!isDatabaseReady()) return null;
    const record = findUserByUsername(arg);
    if (!record) return "unknown-username";
    return {
      userId: record.userId,
      firstName: record.firstName ?? undefined,
      lastName: record.lastName ?? undefined,
      username: record.username ?? undefined,
      isSelf: record.userId === from?.id,
    };
  }

  if (/^\d+$/.test(arg)) {
    return {
      userId: Number(arg),
      isSelf: Number(arg) === from?.id,
    };
  }

  if (replied) {
    return {
      userId: replied.id,
      firstName: replied.first_name,
      lastName: replied.last_name,
      username: replied.username,
      isSelf: replied.id === from?.id,
    };
  }

  if (from) {
    return {
      userId: from.id,
      firstName: from.first_name,
      lastName: from.last_name,
      username: from.username,
      isSelf: true,
    };
  }

  return null;
}

function buildReport(ctx: Context, target: Target): string {
  const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
  const canSeeId = target.isSelf || !isGroup;

  const lines = [`👤 <b>${escapeHtml(displayName(target))}</b>`];
  if (target.username) lines.push(`@${escapeHtml(target.username)}`);
  lines.push(`ID: <code>${canSeeId ? target.userId : maskId(target.userId)}</code>`);

  lines.push("", "<b>Aktivitas</b>");
  const stats = getStats(target.userId);
  if (!stats) {
    lines.push("Belum ada data yang tercatat.");
  } else {
    lines.push(`Pesan: <b>${stats.messages}</b>`);
    lines.push(`Hari aktif: <b>${stats.activeDays}</b>`);
    lines.push(`Perintah digunakan: <b>${stats.commandCount}</b>`);
    lines.push(`Perintah teratas: ${stats.topCommand ? `/${escapeHtml(stats.topCommand)}` : "—"}`);
    lines.push(`Pertama terlihat: ${formatDate(stats.firstSeen)}`);
    lines.push(`Terakhir terlihat: ${formatDate(stats.lastSeen)}`);
  }

  lines.push("", "Nomor telepon tidak dapat diakses melalui Bot API.");
  return lines.join("\n");
}

export function registerUserinfo(bot: Bot): void {
  registerCommand(bot, "userinfo", async (ctx: Context) => {
    if (!isDatabaseReady()) {
      await ctx.reply("Penyimpanan tidak tersedia, jadi statistik tidak dapat ditampilkan.");
      return;
    }

    const target = resolveTarget(ctx);
    if (target === "unknown-username") {
      const arg = typeof ctx.match === "string" ? ctx.match.trim() : "";
      await ctx.reply(
        `Belum ada data untuk ${escapeHtml(arg)}. Bot hanya mengenali pengguna yang pernah berinteraksi dengannya.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    if (!target) {
      await ctx.reply("Tidak dapat menentukan pengguna yang ingin dilihat.");
      return;
    }

    const report = buildReport(ctx, target);

    // Header: the target's profile picture when one is available. Falls back to
    // a plain text report if the user has no photo or the send fails (e.g. the
    // report exceeds the 1024-character caption limit).
    const fileId = await getProfilePhotoFileId(ctx.api, target.userId);
    if (fileId) {
      try {
        await ctx.replyWithPhoto(fileId, { caption: report, parse_mode: "HTML" });
        return;
      } catch (error) {
        console.error("Gagal mengirim foto profil untuk info pengguna:", error);
      }
    }

    await ctx.reply(report, { parse_mode: "HTML" });
  });
}
