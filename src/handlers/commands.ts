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
      { command: "ping", label: "!ping — Cek respons bot (admin grup)" },
      { command: "groupinfo", label: "!groupinfo — Tampilkan info grup (admin grup)" },
      { command: "rank", label: "/rank — Tampilkan level dan XP-mu di grup ini" },
      { command: "leaderboard", label: "/leaderboard — Tampilkan peringkat XP grup ini" },
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
    items: [{ command: "qr", label: "/qr — Buat kode QR atau baca QR dari gambar" }],
  },
  {
    title: "Multimedia",
    items: [{ command: "play", label: "/play — Cari lagu atau video dan unduh dari YouTube" }],
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
  "<b>Sistem</b>",
  "$sys — Tampilkan informasi sistem (khusus pemilik bot)",
  "!&lt;perintah&gt; on|off — Aktifkan atau nonaktifkan perintah (admin)",
];

function renderItem(item: MenuItem): string {
  // Informational only. The real enforcement happens in the command dispatch.
  return isCommandEnabled(item.command) ? item.label : `${item.label} (NONAKTIF)`;
}

export function buildMenu(): string {
  const lines = [`<b>${TITLE}</b>`, `<i>${SUBTITLE}</i>`];
  for (const section of SECTIONS) {
    lines.push("", `<b>${section.title}</b>`, ...section.items.map(renderItem));
  }
  lines.push("", ...FOOTER);
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

  registerCommand(bot, "start", showMenu);
  registerCommand(bot, "menu", showMenu);
}
