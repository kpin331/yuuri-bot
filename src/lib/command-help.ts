export type HelpPlatform = "telegram" | "whatsapp";

interface HelpEntry {
  name: string;
  aliases?: string[];
  telegram?: string[];
  whatsapp?: string[];
  description: string;
  example?: string;
}

const ENTRIES: HelpEntry[] = [
  { name: "start", aliases: ["menu"], telegram: ["/start", "/menu"], whatsapp: ["{{p}}start", "{{p}}menu"], description: "Menampilkan menu perintah." },
  { name: "userinfo", telegram: ["/userinfo [@username|ID]"], whatsapp: ["{{p}}userinfo"], description: "Menampilkan profil, kuota, dan aktivitas pengguna. Telegram menerima username atau ID; tanpa argumen menampilkan profilmu.", example: "{{p}}userinfo @nama" },
  { name: "d", telegram: ["/d (balas pesan)"], whatsapp: ["{{p}}d (balas pesan)"], description: "Menghapus pesan yang dibalas. Di grup, bot harus menjadi admin untuk menghapus pesan anggota." },
  { name: "ping", telegram: ["!ping"], whatsapp: ["!ping"], description: "Menampilkan waktu respons dan status sistem. Hanya admin grup atau pemilik bot." },
  { name: "groupinfo", telegram: ["!groupinfo"], whatsapp: ["!groupinfo"], description: "Menampilkan nama, ID, jumlah anggota, dan deskripsi grup. Hanya untuk grup, admin grup, atau pemilik bot." },
  { name: "quota", telegram: ["/quota", "/quota <jumlah 1-25>", "/quota upgrade"], whatsapp: ["{{p}}quota", "{{p}}quota <jumlah 1-25>", "{{p}}quota upgrade"], description: "Menampilkan kuota dan paket pembelian. Setiap kuota tambahan berharga Rp5.000 sampai reset tengah malam; upgrade permanen +10 kuota harian berharga Rp500.000. Pembelian memakai saldo wallet dan berlaku pada platform tempat dibeli.", example: "{{p}}quota 5" },
  { name: "rank", telegram: ["/rank (grup)", "$rank (pemilik, chat pribadi)"], whatsapp: ["{{p}}rank (grup)", "$rank (pemilik, chat pribadi)"], description: "Menampilkan tingkat dan XP-mu di grup. Pemilik dapat memakai bentuk khusus di chat pribadi." },
  { name: "leaderboard", telegram: ["/leaderboard (grup)", "$leaderboard (pemilik, chat pribadi)"], whatsapp: ["{{p}}leaderboard (grup)", "$leaderboard (pemilik, chat pribadi)"], description: "Menampilkan 10 peringkat XP di grup. Pemilik dapat memakai bentuk khusus di chat pribadi." },
  { name: "wallet", telegram: ["/wallet"], whatsapp: ["{{p}}wallet"], description: "Menampilkan saldo kasino virtual dan Point." },
  { name: "tukar", telegram: ["/tukar", "/tukar <jumlah Point 1-50>"], whatsapp: ["{{p}}tukar", "{{p}}tukar <jumlah Point 1-50>"], description: "Menampilkan paket penukaran Point ke saldo wallet. Setiap Point bernilai Rp10.000; maksimal 50 Point atau Rp500.000 per transaksi.", example: "{{p}}tukar 5" },
  { name: "bank", telegram: ["/bank", "/bank deposit <jumlah>", "/bank tarik <jumlah>"], whatsapp: ["{{p}}bank", "{{p}}bank deposit <jumlah>", "{{p}}bank tarik <jumlah>"], description: "Menampilkan saldo bank virtual, menyetor saldo wallet, atau menarik saldo bank. Jumlah memakai Rupiah bulat.", example: "{{p}}bank deposit 100000" },
  { name: "tf", aliases: ["transfer"], telegram: ["/tf <@username|nama|ID> <jumlah>", "/tf <jumlah> (balas pesan target)"], whatsapp: ["{{p}}tf <@mention|nama|ID> <jumlah>", "{{p}}tf <jumlah> (balas pesan target)"], description: "Mentransfer saldo wallet ke pengguna lain. Saldo pengirim berkurang dan saldo penerima bertambah.", example: "{{p}}tf 50000" },
  { name: "pinjam", telegram: ["/pinjam <jumlah>", "/pinjam bayar <jumlah>"], whatsapp: ["{{p}}pinjam <jumlah>", "{{p}}pinjam bayar <jumlah>"], description: "Meminjam saldo virtual dengan bunga flat 10%. Maksimal Rp500.000 per pinjaman dan 5 pinjaman aktif; jatuh tempo acak 20–40 menit, lalu saldo dibekukan sampai pinjaman jatuh tempo dilunasi.", example: "{{p}}pinjam 100000" },
  { name: "lunas", telegram: ["/lunas"], whatsapp: ["{{p}}lunas"], description: "Melunasi seluruh pinjaman aktif di platform ini sekaligus. Membutuhkan saldo wallet yang cukup; untuk membayar sebagian, gunakan pinjam bayar <jumlah>." },
  { name: "addmoney", telegram: ["$addmoney <@username|nama|ID> <jumlah>", "$addmoney <jumlah> (balas pesan target)"], whatsapp: ["$addmoney <@mention|nama|ID> <jumlah>", "$addmoney <jumlah> (balas pesan target)"], description: "Menambahkan saldo wallet ke pengguna. Khusus pemilik bot.", example: "$addmoney 50000" },
  { name: "s", telegram: ["/s (balas atau lampirkan gambar/video)"], whatsapp: ["{{p}}s (balas atau lampirkan gambar/video)"], description: "Mengubah gambar atau video menjadi stiker." },
  { name: "stickeradd", telegram: ["$stickeradd <nama> | <deskripsi> (balas stiker)"], whatsapp: ["$stickeradd <nama> | <deskripsi> (balas stiker)"], description: "Mendaftarkan stiker ke katalog internal YuuriBot agar AI mengenali artinya dan dapat mengirimkannya sebagai balasan. Khusus pemilik bot.", example: "$stickeradd malu | Yuuri tersipu dan pura-pura kesal" },
  { name: "stickerremove", telegram: ["$stickerremove <nama>"], whatsapp: ["$stickerremove <nama>"], description: "Menghapus stiker bernama itu dari katalog internal YuuriBot. Khusus pemilik bot." },
  { name: "aireset", telegram: ["$aireset global", "$aireset private"], whatsapp: ["$aireset global", "$aireset private"], description: "Menghapus seluruh riwayat percakapan AI, atau hanya riwayat pribadi di platform ini. Khusus pemilik bot." },
  { name: "ai", telegram: ["!ai on", "!ai off"], whatsapp: ["!ai on", "!ai off"], description: "Mengaktifkan atau menonaktifkan balasan AI untuk teks, gambar, dan stiker di Telegram serta WhatsApp. Hanya admin dan pemilik bot." },
  { name: "add-personality", telegram: ["$add-personality <nama> | <instruksi>", "$add-personality <nama> (balas file .md)"], whatsapp: ["$add-personality <nama> | <instruksi>", "$add-personality <nama> (balas file .md)"], description: "Menyimpan persona baru dari instruksi atau file Markdown. Khusus pemilik bot." },
  { name: "switch-personality", telegram: ["$switch-personality <nama>"], whatsapp: ["$switch-personality <nama>"], description: "Mengaktifkan persona dan mereset riwayat AI untuk semua chat. Khusus pemilik bot." },
  { name: "smeme", telegram: ["/smeme <teks bawah>", "/smeme <teks atas> | <teks bawah>"], whatsapp: ["{{p}}smeme <teks bawah>", "{{p}}smeme <teks atas> | <teks bawah>"], description: "Balas atau lampirkan gambar/stiker. Tanpa pemisah |, teks masuk di bawah; dengan |, teks dibagi atas dan bawah.", example: "{{p}}smeme HELLO | WORLD" },
  { name: "toimg", telegram: ["/toimg (balas stiker)"], whatsapp: ["{{p}}toimg (balas stiker)"], description: "Mengubah stiker yang dibalas menjadi gambar PNG dan mengirimkannya sebagai gambar." },
  { name: "tovid", whatsapp: ["{{p}}tovid (balas stiker)"], description: "Mengubah stiker statis atau animasi yang dibalas menjadi video MP4." },
  { name: "qr", telegram: ["/qr <teks atau tautan>", "/qr (balas gambar QR)"], whatsapp: ["{{p}}qr <teks atau tautan>", "{{p}}qr (balas gambar QR)"], description: "Membuat gambar kode QR dari teks/tautan, atau membaca isi QR dari gambar yang dibalas.", example: "{{p}}qr https://example.com" },
  { name: "play", telegram: ["/play <kata kunci atau tautan>"], whatsapp: ["{{p}}play <kata kunci atau tautan>"], description: "Mencari video YouTube atau mengambil media dari tautan. Pilih hasil, lalu pilih audio/video; WhatsApp memakai balasan angka 1/2.", example: "{{p}}play lagu favorit" },
  { name: "wordle", telegram: ["/wordle"], whatsapp: ["{{p}}wordle"], description: "Memulai atau melanjutkan ronde tebak kata Indonesia lima huruf. Kirim tebakan sebagai pesan biasa; tersedia enam kesempatan. Kemenangan memberi 25 XP sekali sehari." },
  { name: "slot", telegram: ["/slot <taruhan>"], whatsapp: ["{{p}}slot <taruhan>"], description: "Memainkan slot memakai saldo virtual. Setiap aksi valid memakai 3 kuota.", example: "{{p}}slot 1000" },
  { name: "coinflip", aliases: ["coin"], telegram: ["/coinflip <taruhan> cara|angka", "/coin <taruhan> cara|angka"], whatsapp: ["{{p}}coinflip <taruhan> cara|angka", "{{p}}coin <taruhan> cara|angka"], description: "Memilih sisi koin dan bertaruh dengan saldo virtual. Setiap aksi valid memakai 3 kuota.", example: "{{p}}coinflip 1000 cara" },
  { name: "roulette", telegram: ["/roulette <taruhan> merah|hitam|0-36"], whatsapp: ["{{p}}roulette <taruhan> merah|hitam|0-36"], description: "Bertaruh pada warna atau angka roulette dengan saldo virtual. Setiap aksi valid memakai 3 kuota.", example: "{{p}}roulette 1000 merah" },
  { name: "blackjack", telegram: ["/blackjack <taruhan>", "/blackjack hit|stand"], whatsapp: ["{{p}}blackjack <taruhan>", "{{p}}blackjack hit|stand"], description: "Mulai permainan dengan taruhan, lalu kirim hit atau stand sampai selesai. Setiap aksi memakai 3 kuota.", example: "{{p}}blackjack 1000, lalu {{p}}blackjack hit" },
  { name: "dl", telegram: ["/dl <tautan> atau balas pesan berisi tautan"], whatsapp: ["{{p}}dl <tautan> atau balas pesan berisi tautan"], description: "Mengunduh media dari tautan yang didukung.", example: "{{p}}dl https://example.com/video" },
  { name: "ig", telegram: ["/ig <tautan Instagram>"], whatsapp: ["{{p}}ig <tautan Instagram>"], description: "Mengunduh media dari Instagram.", example: "{{p}}ig https://www.instagram.com/p/..." },
  { name: "x", telegram: ["/x <tautan X>"], whatsapp: ["{{p}}x <tautan X>"], description: "Mengunduh media dari X.", example: "{{p}}x https://x.com/..." },
  { name: "fb", telegram: ["/fb <tautan Facebook>"], whatsapp: ["{{p}}fb <tautan Facebook>"], description: "Mengunduh media dari Facebook.", example: "{{p}}fb https://www.facebook.com/..." },
  { name: "tt", telegram: ["/tt <tautan TikTok>"], whatsapp: ["{{p}}tt <tautan TikTok>"], description: "Mengunduh video dari TikTok.", example: "{{p}}tt https://www.tiktok.com/@user/video/..." },
  { name: "pin", telegram: ["/pin <kata kunci atau tautan Pinterest>"], whatsapp: ["{{p}}pin <kata kunci atau tautan Pinterest>"], description: "Mencari hingga empat gambar Pinterest teratas dan mengirimkannya sebagai album.", example: "{{p}}pin kucing" },
  { name: "pixiv", telegram: ["/pixiv <kata kunci>"], whatsapp: ["{{p}}pixiv <kata kunci>"], description: "Mencari ilustrasi Pixiv. Memerlukan PIXIV_REFRESH_TOKEN.", example: "{{p}}pixiv landscape" },
  { name: "ban", telegram: ["/ban <@username|ID> [-d<hari>|-h<jam>|<detik>] (atau balas pesan)"], whatsapp: ["{{p}}ban <nomor> [-d<hari>|-h<jam>|<detik>] (atau balas pesan)"], description: "Memblokir pengguna selama durasi yang dipilih. Durasi bawaan 3 hari; hanya admin atau pemilik.", example: "{{p}}ban 6281234567890 -d7" },
  { name: "bangroup", telegram: ["/bangroup <@username|ID> [-d<hari>|-h<jam>|<detik>] (atau balas pesan)"], whatsapp: ["{{p}}bangroup <nomor> [-d<hari>|-h<jam>|<detik>] (atau balas pesan)"], description: "Memblokir pengguna selama durasi yang dipilih dan menghapus pesannya di semua grup. Durasi bawaan 3 hari; hanya admin atau pemilik.", example: "{{p}}bangroup 6281234567890 -d7" },
  { name: "unban", telegram: ["/unban <@username|ID> (atau balas pesan)"], whatsapp: ["{{p}}unban <nomor> (atau balas pesan)"], description: "Membuka blokir pengguna. Hanya admin atau pemilik.", example: "{{p}}unban 6281234567890" },
  { name: "sys", telegram: ["$sys"], whatsapp: ["$sys"], description: "Menampilkan laporan sistem. Khusus pemilik bot." },
  { name: "purge", telegram: ["$purge"], whatsapp: ["$purge"], description: "Menghapus semua file media biasa yang tersimpan langsung di folder Media. Folder dan subfolder tetap ada. Khusus pemilik bot." },
  { name: "database", telegram: ["/database"], description: "Membuka penjelajah database. Pilih tabel, saring baris, dan ekspor Excel. Khusus pemilik bot." },
  { name: "quota-reset", telegram: ["/quota-reset"], description: "Mereset kuota harian semua pengguna. Khusus pemilik bot." },
  { name: "toggle", telegram: ["!<command> on|off", "$toggle <command> on|off (pemilik)"], whatsapp: ["!<command> on|off", "$toggle <command> on|off (pemilik)"], description: "Mengaktifkan atau menonaktifkan command. Admin memakai !; pemilik dapat memakai $toggle." , example: "!pin off" },
  { name: "POWERSHELL", aliases: ["powershell"], telegram: ["POWERSHELL: {perintah}"], whatsapp: ["POWERSHELL: {perintah}"], description: "Menjalankan perintah pada sesi PowerShell baru, lalu mengirim hasilnya. Khusus pemilik bot.", example: "POWERSHELL: {Get-Date}" },
  { name: "#git", telegram: ["#git"], whatsapp: ["#git"], description: "Meninjau perubahan repo, lalu meminta pesan commit sebelum membuat commit dan push. Khusus pemilik; dapat dipakai di chat mana pun." },
  { name: "bc", aliases: ["broadcast"], telegram: ["$bc <pesan>", "$bc (balas pesanmu)"], whatsapp: ["$bc <pesan>", "$bc (balas pesanmu)"], description: "Mengirim pesan atau meneruskan pesan balasan ke grup yang tercantum di ALLOWED_GROUPS. Khusus pemilik dan hanya di chat pribadi." },
  { name: "$SHELL", aliases: ["shell"], telegram: ["$SHELL -E pause|resume|secret", "$SHELL -E SetQuota <angka>"], whatsapp: ["$SHELL -E pause|resume|secret", "$SHELL -E SetQuota <angka>"], description: "Perintah pemilik untuk jeda bot, kuota, dan foto secret. Secret meminta PIN tambahan.", example: "$SHELL -E pause" },
  { name: "cara-pakai", aliases: ["cara_pakai", "help"], telegram: ["/cara_pakai <command>"], whatsapp: ["{{p}}cara-pakai <command>"], description: "Menampilkan cara kerja dan format pemakaian command lain.", example: "{{p}}cara_pakai pin" },
  { name: "jarvis", telegram: ["kirim pesan: jarvis"], whatsapp: ["kirim pesan: jarvis"], description: "Membalas sapaan dan menampilkan menu jika pesan hanya berisi jarvis." },
];

const BY_NAME = new Map<string, HelpEntry>();
for (const entry of ENTRIES) {
  BY_NAME.set(entry.name.toLowerCase(), entry);
  for (const alias of entry.aliases ?? []) BY_NAME.set(alias.toLowerCase(), entry);
}

export function commandHelpNames(platform: HelpPlatform): string[] {
  return ENTRIES.filter((entry) => (platform === "telegram" ? entry.telegram : entry.whatsapp))
    .map((entry) => entry.name);
}

export function formatCommandHelp(
  input: string,
  platform: HelpPlatform,
  commandPrefix = ".",
): string {
  const target = input.trim().split(/\s+/, 1)[0] ?? "";
  const name = target.replace(/^[/.$!]+/, "").replace(/@[A-Za-z0-9_]+$/, "").toLowerCase();
  if (!name) {
    const usage = platform === "telegram" ? "/cara_pakai <command>" : `${commandPrefix}cara-pakai <command>`;
    const examples = commandHelpNames(platform).join(", ");
    return `Cara pakai: ${usage}\nCommand yang tersedia: ${examples}`;
  }

  const entry = BY_NAME.get(name);
  if (!entry) return `Cara pakai command "${name}" belum tersedia.`;
  const templates = platform === "telegram" ? entry.telegram : entry.whatsapp;
  if (!templates) return `Command "${entry.name}" hanya tersedia di ${platform === "telegram" ? "WhatsApp" : "Telegram"}.`;
  const usages = templates.map((usage) => usage.replaceAll("{{p}}", commandPrefix));
  const lines = [
    `Command: ${entry.name}`,
    `Cara pakai: ${usages[0]}`,
    ...usages.slice(1).map((usage) => `Cara lain: ${usage}`),
    `Cara kerja: ${entry.description}`,
  ];
  if (entry.example) lines.push(`Contoh: ${entry.example.replaceAll("{{p}}", platform === "telegram" ? "/" : commandPrefix)}`);
  return lines.join("\n");
}
