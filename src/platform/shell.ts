import { randomInt, timingSafeEqual } from "node:crypto";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { InputFile, type Bot } from "grammy";
import { setRemainingQuotaForKnownUsers } from "../core/access.js";
import { getAdminQuota, getDefaultQuota, isOwner } from "../lib/config.js";
import { exec } from "../lib/exec.js";
import { writeLog } from "../lib/runtime.js";
import { splitStatusMessage } from "../lib/system-status.js";

export type ShellPlatform = "telegram" | "whatsapp";

export interface ShellMessageContext {
  platform: ShellPlatform;
  userId: string;
  chatId: string;
  isOwner: boolean;
  isPrivate: boolean;
  text: string;
  reply: (text: string) => Promise<void>;
  sendSecretPhoto: (path: string, index: number, total: number) => Promise<void>;
}

type PendingAction = {
  platform: ShellPlatform;
  userId: string;
  chatId: string;
  expiresAt: number;
} & (
  | { kind: "secret"; pin: string; attempts: number }
  | { kind: "git"; status: string; branch: string }
);

const ACTION_TIMEOUT_MS = 5 * 60 * 1000;
const POWERSHELL_TIMEOUT_MS = 120_000;
const POWERSHELL_OUTPUT_LIMIT = 512 * 1024;
const POWERSHELL_REPLY_LIMIT = 16_000;
const ALLOWED_PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
let paused = false;
let pending: PendingAction | null = null;

export function isBotPaused(): boolean {
  return paused;
}

export function isShellResumeCommand(text: string): boolean {
  return /^\$SHELL\s+-E\s+resume\s*$/i.test(text.trim());
}

export function registerShell(bot: Bot): void {
  bot.on("message", async (ctx, next) => {
    const message = ctx.message;
    const text = message.text ?? message.caption;
    if (text === undefined) return next();
    const chat = ctx.chat;
    if (!chat) return next();

    const handled = await handleShellMessage({
      platform: "telegram",
      userId: String(ctx.from?.id ?? ""),
      chatId: String(chat.id),
      isOwner: isOwner(ctx.from?.id),
      isPrivate: chat.type === "private",
      text,
      reply: async (value) => {
        await ctx.reply(value);
      },
      sendSecretPhoto: async (path, index, total) => {
        await ctx.api.sendPhoto(chat.id, new InputFile(path), { caption: `Foto ${index}/${total}` });
      },
    });
    if (!handled) await next();
  });
}

export async function handleShellMessage(context: ShellMessageContext): Promise<boolean> {
  const text = context.text.trim();
  const shellCommand = /^\$SHELL\s+-E(?:\s+([\s\S]*))?$/i.exec(text);
  const powershellCommand = /^POWERSHELL\s*:\s*([\s\S]*)$/i.exec(text);
  const gitCommand = /^#git$/i.test(text);

  if (pending && pending.expiresAt <= Date.now()) pending = null;

  if (powershellCommand) {
    if (!context.isOwner) {
      await context.reply("Hanya pemilik bot yang dapat menjalankan PowerShell.");
      return true;
    }
    let command = (powershellCommand[1] ?? "").trim();
    if (command.startsWith("{") && command.endsWith("}")) command = command.slice(1, -1).trim();
    if (!command) {
      await context.reply("Format: POWERSHELL: {perintah PowerShell}");
      return true;
    }
    if (process.platform !== "win32") {
      await context.reply("PowerShell hanya tersedia di server Windows.");
      return true;
    }

    await context.reply("running...");
    try {
      const result = await exec("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
        timeoutMs: POWERSHELL_TIMEOUT_MS,
        maxOutputBytes: POWERSHELL_OUTPUT_LIMIT,
      });
      const output = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n");
      const clipped = output.length > POWERSHELL_REPLY_LIMIT
        ? `${output.slice(0, POWERSHELL_REPLY_LIMIT)}\n… output dipotong.`
        : output;
      const response = `Selesai (exit code ${result.code}).${clipped ? `\n${clipped}` : "\nPerintah selesai tanpa output."}`;
      for (const chunk of splitStatusMessage(response)) await context.reply(chunk);
      writeLog("SHELL", `action=powershell status=finished exit_code=${result.code} output_chars=${output.length}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const timeout = message.includes("batas waktu");
      writeLog("SHELL", `action=powershell status=${timeout ? "timeout" : "failed"}`);
      await context.reply(timeout
        ? "Sesi PowerShell dihentikan karena melewati batas waktu 120 detik."
        : "Sesi PowerShell gagal dijalankan atau keluarannya melewati batas.");
    }
    return true;
  }

  if (gitCommand) {
    if (!context.isOwner) {
      await context.reply("Hanya pemilik bot yang dapat menggunakan #git.");
      return true;
    }
    if (pending && sameContext(pending, context)) {
      pending = null;
      await context.reply("Proses sebelumnya dibatalkan.");
    }
    await startGitCommit(context);
    return true;
  }

  if (shellCommand) {
    if (!context.isOwner) {
      await context.reply("🚫 Hanya pemilik bot yang dapat menggunakan `$SHELL`.");
      return true;
    }
    if (pending && sameContext(pending, context)) {
      pending = null;
      await context.reply("Proses sebelumnya dibatalkan.");
    }
    try {
      await runShellAction(context, (shellCommand[1] ?? "").trim());
    } catch {
      pending = null;
      writeLog("ERROR", `SHELL platform=${context.platform} action=command failed`);
      await context.reply("Perintah SHELL gagal dijalankan.");
    }
    return true;
  }

  if (pending && sameContext(pending, context) && context.isOwner) {
    try {
      await handlePendingAction(context, pending);
    } catch {
      pending = null;
      writeLog("ERROR", `SHELL platform=${context.platform} action=pending failed`);
      await context.reply("Proses SHELL gagal dijalankan.");
    }
    return true;
  }

  return false;
}

function sameContext(action: PendingAction, context: ShellMessageContext): boolean {
  return action.platform === context.platform && action.userId === context.userId && action.chatId === context.chatId;
}

async function runShellAction(context: ShellMessageContext, input: string): Promise<void> {
  const [action = "", ...args] = input.split(/\s+/).filter(Boolean);
  const name = action.toLowerCase();

  if (name === "pause" || name === "resume") {
    if (args.length > 0) {
      await context.reply("Format: `$SHELL -E pause` atau `$SHELL -E resume`.");
      return;
    }
    paused = name === "pause";
    process.stdout.write(`[BOT] Status: ${paused ? "dijeda" : "berjalan kembali"} oleh owner.\n`);
    writeLog("SHELL", `action=${name} status=success`);
    await context.reply(paused ? "Bot dijeda. Hanya `$SHELL -E resume` dari owner yang akan diproses." : "Bot berjalan kembali.");
    return;
  }

  if (name === "setquota") {
    if (args.length !== 1 || !/^\d+$/.test(args[0] ?? "")) {
      await context.reply("Format: `$SHELL -E SetQuota <angka>`.");
      return;
    }
    const amount = Number(args[0]);
    const maximum = Math.min(getDefaultQuota(), getAdminQuota());
    if (!Number.isSafeInteger(amount) || amount > maximum) {
      await context.reply(`Jumlah kuota harus berupa angka bulat dari 0 sampai ${maximum}.`);
      return;
    }
    const affected = setRemainingQuotaForKnownUsers(amount);
    if (affected === null) {
      await context.reply("Penyimpanan kuota tidak tersedia.");
      return;
    }
    writeLog("SHELL", `action=setquota amount=${amount} affected=${affected}`);
    await context.reply(`Sisa kuota disetel menjadi ${amount} untuk ${affected} catatan pengguna sampai reset harian.`);
    return;
  }

  if (name === "secret") {
    if (args.length > 0) {
      await context.reply("Format: `$SHELL -E secret`.");
      return;
    }
    if (!context.isPrivate) {
      await context.reply("Gunakan perintah secret di chat pribadi dengan bot.");
      return;
    }
    startSecretChallenge(context);
    await context.reply("Masukkan PIN yang dicetak di terminal. PIN berlaku selama 5 menit.");
    return;
  }

  await context.reply(
    "Perintah tersedia: `$SHELL -E SetQuota <angka>`, `$SHELL -E pause`, `$SHELL -E resume`, `$SHELL -E secret`.",
  );
}

function startSecretChallenge(context: ShellMessageContext): void {
  const length = randomInt(5, 16);
  const pin = Array.from({ length }, (_, index) => String(randomInt(index === 0 ? 1 : 0, 10))).join("");
  pending = {
    kind: "secret",
    platform: context.platform,
    userId: context.userId,
    chatId: context.chatId,
    expiresAt: Date.now() + ACTION_TIMEOUT_MS,
    attempts: 3,
    pin,
  };
  process.stdout.write(`[SECRET] PIN owner: ${pin}\n`);
  writeLog("SHELL", "action=secret challenge=issued pin=omitted");
}

async function handlePendingAction(context: ShellMessageContext, action: PendingAction): Promise<void> {
  if (action.kind === "secret") {
    const supplied = Buffer.from(context.text.trim());
    const expected = Buffer.from(action.pin);
    const matches = supplied.length === expected.length && timingSafeEqual(supplied, expected);
    if (!matches) {
      action.attempts -= 1;
      if (action.attempts <= 0) {
        pending = null;
        await context.reply("PIN salah. Permintaan secret dibatalkan.");
      } else {
        await context.reply(`PIN salah. Sisa percobaan: ${action.attempts}.`);
      }
      return;
    }

    pending = null;
    await sendSecretPhotos(context);
    return;
  }

  const message = context.text.trim();
  if (!message || message.length > 250 || /[\r\n]/.test(message)) {
    await context.reply("Pesan commit harus satu baris dan maksimal 250 karakter.");
    return;
  }

  const current = await gitStatus();
  if (!current.ok || current.status !== action.status) {
    pending = null;
    await context.reply("Daftar perubahan repo berubah. Jalankan #git lagi untuk meninjau ulang.");
    return;
  }

  pending = null;
  const add = await runGit(["add", "--all", "--", "."]);
  if (add.code !== 0) {
    await context.reply("Gagal menyiapkan perubahan untuk commit.");
    return;
  }
  const commit = await runGit(["commit", "-m", message]);
  if (commit.code !== 0) {
    await context.reply("Commit gagal. Periksa konfigurasi Git di komputer bot.");
    return;
  }
  const push = await runGit(["push", "origin", action.branch]);
  if (push.code !== 0) {
    writeLog("SHELL", `action=git commit=success push=failed branch=${action.branch}`);
    await context.reply("Commit berhasil dibuat, tetapi push gagal. Periksa koneksi dan akses remote origin.");
    return;
  }
  writeLog("SHELL", `action=git commit=success push=success branch=${action.branch}`);
  await context.reply("Commit dan push ke origin berhasil.");
}

async function startGitCommit(context: ShellMessageContext): Promise<void> {
  try {
    const current = await gitStatus();
    if (!current.ok) {
      await context.reply("Gagal membaca status repo Git.");
      return;
    }
    if (!current.status.trim()) {
      await context.reply("bot belum di comit!");
      return;
    }

    const branch = await runGit(["branch", "--show-current"]);
    const remote = await runGit(["remote", "get-url", "origin"]);
    if (branch.code !== 0 || !branch.stdout.trim() || remote.code !== 0 || !remote.stdout.trim()) {
      await context.reply("Branch aktif atau remote origin tidak tersedia.");
      return;
    }

    pending = {
      kind: "git",
      platform: context.platform,
      userId: context.userId,
      chatId: context.chatId,
      expiresAt: Date.now() + ACTION_TIMEOUT_MS,
      status: current.status,
      branch: branch.stdout.trim(),
    };
    const preview = current.status.trim().split("\n").slice(0, 30).join("\n");
    const more = current.status.trim().split("\n").length > 30 ? "\n…" : "";
    await context.reply(`Perubahan repo:\n${preview}${more}\nKirim pesan commit satu baris untuk membuat commit dan push ke origin.`);
  } catch {
    await context.reply("Pemeriksaan Git gagal.");
  }
}

async function gitStatus(): Promise<{ ok: boolean; status: string }> {
  const result = await runGit(["status", "--porcelain=v1"]);
  return { ok: result.code === 0, status: result.stdout };
}

async function runGit(args: string[]) {
  return exec("git", args, {
    cwd: process.cwd(),
    timeoutMs: 120_000,
    maxOutputBytes: 1_000_000,
    env: { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
  });
}

async function sendSecretPhotos(context: ShellMessageContext): Promise<void> {
  const directory = join(process.cwd(), "secrets");
  let files: string[];
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    files = entries
      .filter((entry) => entry.isFile() && ALLOWED_PHOTO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    await context.reply("Folder secrets tidak ditemukan atau tidak dapat dibaca.");
    return;
  }
  if (files.length === 0) {
    await context.reply("Tidak ada foto di folder secrets.");
    return;
  }

  let sent = 0;
  for (let index = 0; index < files.length; index += 1) {
    try {
      await context.sendSecretPhoto(files[index]!, index + 1, files.length);
      sent += 1;
    } catch {
      writeLog("SHELL", `action=secret photo_send=failed index=${index + 1}`);
    }
  }
  writeLog("SHELL", `action=secret photos=${files.length} sent=${sent}`);
  await context.reply(`Foto secret terkirim: ${sent}/${files.length}.`);
}
