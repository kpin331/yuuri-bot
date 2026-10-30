## YUURI BOT V1.0

Yuuri bot adalah bot cross-platform yang tersedia di telegram dan whatsapp.

### Command grup

- `$toggle <command> on|off` — ubah status command; hanya owner yang dapat memakainya.
- `!ping` — cek respons bot dan waktu respons; admin grup atau owner.
- `!groupinfo` — tampilkan nama, ID, jumlah anggota, dan deskripsi grup; hanya di grup.
- `!<command> on|off` — aktifkan atau nonaktifkan command; perilaku toggle tetap sama.
- `$SHELL -E SetQuota 4` — set sisa kuota semua pengguna tercatat sampai reset harian.
- `$SHELL -E pause` / `$SHELL -E resume` — jeda atau lanjutkan bot; hanya owner.
- `#git` - tinjau perubahan, lalu minta pesan commit dan push ke `origin`; hanya owner.
- `$SHELL -E secret` — kirim foto dari `secrets` setelah PIN owner diverifikasi di chat pribadi.

### Opsi startup

- `npm start -- -S` — simpan media hasil unduhan atau olahan bot di `Media` pada direktori kerja.
- `npm start -- -S G:` — simpan media di `G:\Media`.
- `npm start -- --log` — tampilkan log bertimestamp di CLI dan tambahkan salinannya ke `bot.log`.
- `npm start -- -S --log --changelog` - aktifkan log dan kirim `CHANGELOG.txt` ke grup WhatsApp di `ALLOWED_GROUPS` saat owner mengetik `.menu`.
- Opsi dapat digabung, misalnya `npm start -- -S G: --log --changelog`.

Saat `--log` aktif, log mencatat ID Telegram atau nomor WhatsApp jika tersedia, ID grup, dan nama command tanpa isi pesan. Log jaringan mencatat hostname, IP hasil DNS, status, durasi, dan ukuran transfer yang dilaporkan HTTP. Program eksternal dicatat dengan nama, status keluar, dan ukuran output tanpa argumen mentah.

Balas pesan dengan `/d` di Telegram atau `.d` di WhatsApp untuk menghapusnya. Bot dapat menghapus pesan pengguna di grup jika bot menjadi admin. Pesan media yang dikirim bot dibiarkan saat `-S` aktif.

IP pengirim tidak tersedia dari API Telegram atau WhatsApp. Yang dicatat adalah IP interface lokal bot dan IP DNS tujuan. Ukuran WebSocket WhatsApp tidak tersedia dari client yang dipakai bot.
