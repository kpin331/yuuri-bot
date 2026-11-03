import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAllowedGroups, getCommandPrefix } from "../../../lib/config.js";
import { isCommandEnabled } from "../../../lib/db.js";
import { runtimeOptions } from "../../../lib/runtime.js";
import { replyTo, sendImage, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

const TITLE = "Yuuri Bot V1.0✨";
const SUBTITLE = "Daftar perintah yang tersedia";

interface Item {
  name: string;
  label: string;
}

interface Section {
  title: string;
  items: Item[];
}

function sections(): Section[] {
  const p = getCommandPrefix();
  return [
    {
      title: "Umum",
      items: [
        { name: "menu", label: `${p}menu — Tampilkan menu ini` },
        { name: "userinfo", label: `${p}userinfo — Tampilkan statistik dan kuota` },
        { name: "d", label: `${p}d — Hapus pesan yang dibalas` },
        { name: "ping", label: "!ping — Cek respons bot (admin grup)" },
        { name: "groupinfo", label: "!groupinfo — Tampilkan info grup (admin grup)" },
        { name: "quota", label: `${p}quota — Lihat, beli kuota, atau upgrade batas harian` },
        { name: "rank", label: `${p}rank — Tampilkan tingkat dan XP di grup ini` },
        { name: "leaderboard", label: `${p}leaderboard — Tampilkan peringkat XP grup ini` },
        { name: "wallet", label: `${p}wallet — Tampilkan saldo virtual dan Point` },
        { name: "cara-pakai", label: `${p}cara-pakai <command> - Cari cara kerja dan cara pakai command` },
      ],
    },
    {
      title: "Game",
      items: [
        { name: "tebakkata", label: `${p}tebakkata (COMING SOON)` },
        { name: "rpg", label: `${p}rpg (COMING SOON)` },
        { name: "monopoly", label: `${p}monopoly (COMING SOON)` },
        { name: "wordle", label: `${p}wordle - Tebak kata 5 huruf` },
        { name: "ulartangga", label: `${p}ulartangga (COMING SOON)` },
      ],
    },
    {
      title: "Stiker",
      items: [
        { name: "s", label: `${p}s — Balas gambar atau video untuk membuat stiker` },
        { name: "smeme", label: `${p}smeme — Ubah gambar atau stiker menjadi meme (atas | bawah)` },
        { name: "toimg", label: `${p}toimg — Balas stiker untuk mengubahnya menjadi PNG` },
        { name: "tovid", label: `${p}tovid — Balas stiker untuk mengubahnya menjadi video MP4` },
      ],
    },
    {
      title: "Multimedia",
      items: [
        { name: "play", label: `${p}play — Cari di YouTube lalu kirim audio atau video` },
        { name: "qr", label: `${p}qr — Buat QR atau baca QR dari gambar` },
      ],
    },
    {
      title: "Kasino virtual",
      items: [
        { name: "slot", label: `${p}slot <taruhan> — Main slot virtual` },
        { name: "coin", label: `${p}coin <taruhan> cara|angka — Lempar koin` },
        { name: "roulette", label: `${p}roulette <taruhan> merah|hitam|0-36 — Roulette` },
        { name: "blackjack", label: `${p}blackjack <taruhan> — Mulai; lanjutkan hit atau stand` },
      ],
    },
    {
      title: "Keuangan virtual",
      items: [
        { name: "tukar", label: `${p}tukar [jumlah Point 1-50] - Tukar Point menjadi saldo wallet` },
        { name: "bank", label: `${p}bank [deposit|tarik jumlah] - Kelola saldo bank virtual` },
        { name: "tf", label: `${p}tf <target> <jumlah> - Transfer saldo wallet` },
        { name: "pinjam", label: `${p}pinjam <jumlah> - Pinjaman virtual, bunga 10%` },
        { name: "lunas", label: `${p}lunas - Lunasi semua pinjaman aktif` },
      ],
    },
    {
      title: "Pengunduh",
      items: [
        { name: "dl", label: `${p}dl — Unduh media dari tautan yang didukung` },
        { name: "ig", label: `${p}ig — Unduh dari Instagram` },
        { name: "x", label: `${p}x — Unduh dari X (Twitter)` },
        { name: "fb", label: `${p}fb — Unduh dari Facebook` },
        { name: "tt", label: `${p}tt — Unduh dari TikTok` },
      ],
    },
    {
      title: "Pencarian Gambar",
      items: [
        { name: "pin", label: `${p}pin — Gambar Pinterest teratas (kata kunci atau tautan)` },
        { name: "pixiv", label: `${p}pixiv — Ilustrasi Pixiv teratas (kata kunci saja)` },
      ],
    },
    {
      title: "Moderasi",
      items: [
        { name: "ban", label: `${p}ban — Blokir pengguna (admin)` },
        { name: "unban", label: `${p}unban — Buka blokir pengguna (admin)` },
      ],
    },
  ];
}

export function buildMenu(): string {
  const lines = [`*${TITLE}*`, `_${SUBTITLE}_`];
  for (const [index, section] of sections().entries()) {
    lines.push("", ...(index > 0 ? ["================"] : []), `<${section.title}>`);
    for (const item of section.items) {
      // Informational only. Real enforcement happens in the router.
      lines.push(`- ${isCommandEnabled(item.name) ? item.label : `${item.label} (NONAKTIF)`}`);
    }
  }
  lines.push(
    "",
    "================",
    "<Sistem>",
    "- $purge - Hapus file media di folder Media (khusus pemilik)",
    "- $addmoney <target> <jumlah> - Tambah saldo wallet (khusus pemilik)",
    "- $bc <pesan> - Siarkan ke grup ALLOWED_GROUPS (khusus pemilik, chat pribadi)",
    "- $sys — Tampilkan info sistem (khusus pemilik)",
    "- POWERSHELL: {perintah} - Jalankan di sesi baru (khusus pemilik)",
    "- #git - Tinjau perubahan, lalu commit dan push (khusus pemilik)",
    "- !<perintah> on|off — Aktifkan atau nonaktifkan perintah (admin)",
    "- $toggle <perintah> on|off — Ubah status command (khusus pemilik)",
  );
  return lines.join("\n");
}

export const menuCommand: WaCommand = {
  name: "menu",
  aliases: ["start"],
  free: true,
  run: async ({ message, role }) => {
    const reply = replyTo(message);
    const caption = buildMenu();

    if (role === "owner" && runtimeOptions().changelog) {
      try {
        const changelog = (await readFile(resolve(process.cwd(), "CHANGELOG.txt"), "utf8")).trim();
        const targets = getAllowedGroups().filter((jid) => !jid.startsWith("-"));
        for (const jid of targets) {
          try {
            await message.sock.sendMessage(jid, { text: changelog });
          } catch {
            // Continue sending to the remaining allowlisted groups.
          }
        }
      } catch (error) {
        console.error("Gagal membaca CHANGELOG.txt:", error);
      }
    }

    // Show the bot's own profile picture as the menu header, like Telegram does,
    // falling back to a plain text menu when no picture is available.
    try {
      const self = message.sock.user?.id;
      const url = self ? await message.sock.profilePictureUrl(self, "image") : undefined;
      if (url) {
        const response = await fetch(url);
        if (response.ok) {
          await sendImage(reply, Buffer.from(await response.arrayBuffer()), caption);
          return;
        }
      }
    } catch (error) {
      console.error("Gagal mengambil foto profil untuk menu WhatsApp:", error);
    }

    await sendText(reply, caption);
  },
};
