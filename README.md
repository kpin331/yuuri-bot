## YUURI BOT V1.0

Yuuri bot adalah bot cross-platform yang tersedia di telegram dan whatsapp.

### Command grup

- `!ping` — cek respons bot dan waktu respons; admin grup atau owner.
- `!groupinfo` — tampilkan nama, ID, jumlah anggota, dan deskripsi grup; hanya di grup.
- `!<command> on|off` — aktifkan atau nonaktifkan command; perilaku toggle tetap sama.

### Opsi startup

- `npm start -- -S` — simpan media hasil unduhan atau olahan bot di `Media` pada direktori kerja.
- `npm start -- -S E:` — simpan media di `E:\Media`.
- `npm start -- --log` — tampilkan log bertimestamp di CLI dan tambahkan salinannya ke `bot.log`.
- Opsi dapat digabung, misalnya `npm start -- -S E: --log`.

Saat `--log` aktif, log mencatat ID Telegram atau nomor WhatsApp jika tersedia, ID grup, dan nama command tanpa isi pesan. Log jaringan mencatat hostname, IP hasil DNS, status, durasi, dan ukuran transfer yang dilaporkan HTTP. Program eksternal dicatat dengan nama, status keluar, dan ukuran output tanpa argumen mentah.

IP pengirim tidak tersedia dari API Telegram atau WhatsApp. Yang dicatat adalah IP interface lokal bot dan IP DNS tujuan. Ukuran WebSocket WhatsApp tidak tersedia dari client yang dipakai bot.
