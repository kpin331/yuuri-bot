import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputFile, type Api, type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { isCommandEnabled } from "../lib/db.js";

const TITLE = "Yuuri Bot V1.0✨";
const SUBTITLE = "Daftar perintah yang tersedia";
const MENU_PHOTO_CAPTION_LIMIT = 900;

interface MenuItem {
  command: string;
  label: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const SECTIONS: MenuSection[] = [
  {
    title: "Umum",
    items: [
      { command: "start", label: "/start — Tampilkan menu ini" },
      { command: "menu", label: "/menu — Tampilkan menu ini" },
      { command: "userinfo", label: "/userinfo — Tampilkan statistik pengguna" },
      { command: "d", label: "/d — Hapus pesan yang dibalas" },
      { command: "ping", label: "!ping — Cek respons bot (admin grup)" },
      { command: "groupinfo", label: "!groupinfo — Tampilkan info grup (admin grup)" },
      { command: "rank", label: "/rank — Tampilkan level dan XP-mu di grup ini" },
      { command: "leaderboard", label: "/leaderboard — Tampilkan peringkat XP grup ini" },
      { command: "wallet", label: "/wallet — Tampilkan saldo virtual dan Point" },
      { command: "quota", label: "/quota — Lihat, beli kuota, atau upgrade batas harian" },
      { command: "cara_pakai", label: "/cara_pakai <command> — Cari cara kerja dan cara pakai command" },
    ],
  },
  {
    title: "Game",
    items: [
      { command: "tebakkata", label: "/tebakkata (COMING SOON)" },
      { command: "rpg", label: "/rpg (COMING SOON)" },
      { command: "monopoly", label: "/monopoly (COMING SOON)" },
      { command: "wordle", label: "/wordle Tebak kata 5 huruf" },
      { command: "ulartangga", label: "/ulartangga (COMING SOON)" },
    ],
  },
  {
    title: "Stiker",
    items: [
      { command: "s", label: "/s — Balas gambar atau video untuk menjadikannya stiker" },
      { command: "smeme", label: "/smeme — Tambahkan teks meme pada gambar atau stiker (atas | bawah)" },
      { command: "toimg", label: "/toimg — Balas stiker untuk mengubahnya menjadi gambar PNG" },
    ],
  },
  {
    title: "Alat",
    items: [
      { command: "qr", label: "/qr — Buat kode QR atau baca QR dari gambar" },
      { command: "roll", label: "/roll [NdS] — Lempar dadu" },
    ],
  },
  {
    title: "Multimedia",
    items: [{ command: "play", label: "/play — Cari lagu atau video dan unduh dari YouTube" }],
  },
  {
    title: "Kasino virtual",
    items: [
      { command: "slot", label: "/slot <taruhan> — Main slot virtual" },
      { command: "coinflip", label: "/coinflip <taruhan> cara|angka — Lempar koin" },
      { command: "roulette", label: "/roulette <taruhan> merah|hitam|0-36 — Roulette" },
      { command: "blackjack", label: "/blackjack <taruhan> — Mulai blackjack; lanjutkan hit atau stand" },
    ],
  },
  {
    title: "Keuangan virtual",
    items: [
      { command: "tukar", label: "/tukar [jumlah Point 1-50] â€” Tukar Point menjadi saldo wallet" },
      { command: "bank", label: "/bank [deposit|tarik jumlah] â€” Kelola saldo bank virtual" },
      { command: "tf", label: "/tf <target> <jumlah> - Transfer saldo wallet" },
      { command: "pinjam", label: "/pinjam <jumlah> - Pinjaman saldo virtual" },
      { command: "lunas", label: "/lunas - Lunasi semua pinjaman aktif" },
    ],
  },
  {
    title: "Pengunduh",
    items: [
      { command: "dl", label: "/dl — Unduh media dari tautan yang didukung" },
      { command: "ig", label: "/ig — Unduh media dari Instagram" },
      { command: "x", label: "/x — Unduh media dari X (Twitter)" },
      { command: "fb", label: "/fb — Unduh media dari Facebook" },
    ],
  },
  {
    title: "Pencarian Gambar",
    items: [
      { command: "pin", label: "/pin — Cari gambar Pinterest (kata kunci atau tautan)" },
      { command: "pixiv", label: "/pixiv — Cari ilustrasi Pixiv (kata kunci saja)" },
    ],
  },
  {
    title: "Moderasi",
    items: [
      { command: "ban", label: "/ban — Blokir pengguna (admin)" },
      { command: "unban", label: "/unban — Buka blokir pengguna (admin)" },
    ],
  },
];

const FOOTER: string[] = [
  "- $purge - Hapus file media di folder Media (khusus pemilik)",
    "- $addmoney <target> <jumlah> - Tambah saldo wallet (khusus pemilik)",
    "- $bc <pesan> - Siarkan ke grup ALLOWED_GROUPS (khusus pemilik, chat pribadi)",
    "- #git - Tinjau perubahan, lalu commit dan push (khusus pemilik)",
  "- $sys — Tampilkan informasi sistem (khusus pemilik bot)",
  "- POWERSHELL: {perintah} - Jalankan di sesi baru (khusus pemilik bot)",
  "- !&lt;perintah&gt; on|off — Aktifkan atau nonaktifkan perintah (admin)",
  "- $toggle &lt;perintah&gt; on|off — Ubah status command (khusus pemilik)",
];

function renderItem(item: MenuItem): string {
  // Informational only. The real enforcement happens in the command dispatch.
  return `- ${isCommandEnabled(item.command) ? item.label : `${item.label} (NONAKTIF)`}`;
}

export function buildMenu(): string {
  const lines = [`<b>${TITLE}</b>`, `<i>${SUBTITLE}</i>`];
  for (const [index, section] of SECTIONS.entries()) {
    lines.push("", ...(index > 0 ? ["================"] : []), `<b>&lt;${section.title}&gt;</b>`, ...section.items.map(renderItem));
  }
  lines.push("", "================", "<b>&lt;Sistem&gt;</b>", ...FOOTER);
  return lines.join("\n");
}

// Shared helper: returns the largest available profile-photo file_id for a user
// (the last entry in the first photo set), or null when none is available.
export async function getProfilePhotoFileId(api: Api, userId: number): Promise<string | null> {
  try {
    const photos = await api.getUserProfilePhotos(userId, { limit: 1 });
    const first = photos.photos[0];
    return first?.[first.length - 1]?.file_id ?? null;
  } catch (error) {
    console.error("Gagal mengambil foto profil pengguna:", error);
    return null;
  }
}

async function downloadProfilePhoto(api: Api, fileId: string): Promise<string | null> {
  const file = await api.getFile(fileId);
  if (!file.file_path) return null;
  const response = await fetch(`https://api.telegram.org/file/bot${api.token}/${file.file_path}`);
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  const dest = join(tmpdir(), `yuuri-profile-${Date.now()}.jpg`);
  await writeFile(dest, buffer);
  return dest;
}

async function trySendMenuPhoto(
  ctx: Context,
  photo: string | InputFile,
  caption: string,
): Promise<boolean> {
  const separateCaption = caption.length > MENU_PHOTO_CAPTION_LIMIT;
  try {
    await ctx.replyWithPhoto(photo, {
      ...(separateCaption ? {} : { caption, parse_mode: "HTML" as const }),
    });
  } catch (error) {
    console.error("Gagal mengirim foto menu:", error);
    return false;
  }

  if (separateCaption) {
    await ctx.reply(caption, { parse_mode: "HTML" }).catch((error: unknown) => {
      console.error("Gagal mengirim teks menu:", error);
    });
  }
  return true;
}

export function registerCommands(bot: Bot): void {
  const showMenu = async (ctx: Context): Promise<void> => {
    const caption = buildMenu();
    const fileId = await getProfilePhotoFileId(ctx.api, ctx.me.id);

    if (fileId) {
      if (await trySendMenuPhoto(ctx, fileId, caption)) return;

      try {
        const downloaded = await downloadProfilePhoto(ctx.api, fileId);
        if (downloaded && (await trySendMenuPhoto(ctx, new InputFile(downloaded), caption))) return;
      } catch (error) {
        console.error("Gagal mengunduh foto profil bot:", error);
      }
    }

    await ctx.reply(caption, { parse_mode: "HTML" });
  };

  bot.on("message", async (ctx, next) => {
    const text = ctx.message.text ?? ctx.message.caption ?? "";
    if (text.trim().toLowerCase() !== "jarvis") return next();

    await ctx.reply("siap,pak");
    await showMenu(ctx);
  });

  registerCommand(bot, "start", showMenu);
  registerCommand(bot, "menu", showMenu);
}
