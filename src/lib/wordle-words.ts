const WORDS = `
acara acuan afdol agama abadi agung ajang akhir akrab aktor alami alarm album alibi altar amati ambil ampun aneka angin angka antre anyam apung arena aroma asbak aspek
badan bagan bagai bahas bahan bakar bakat balik balut barat basah basmi batik batin bayar bebas beban bekal bekas belah belas belut benak benar benih berat beres besok betah betis beton biasa bibir biner bocah bodoh botak bubur bukti bulat bulan buluh bunuh buram buruk busuk butuh
cakap cakar canda candi capai capek cari catat celah cemas cerah cerai cetak cicil cinta cipta corak cuci cuaca curah
dalam darah dasar datar dekat debat demam denah deras deret desir didik dinas dunia duduk dusun
elang elok emosi entah
fajar fakta fasih fatal fokus frasa
gagal gagah galak galon garam garis gatal gaung gebuk gelap gelar gelas gemar genap gerak geram gilas goyah gubuk gugur gulai gusar
hadir hafal halus hampa hangat hantu harga harum hasil hebat hewan hibur hidup hijau hilang hisap hitam hotel hujan hutan
ideal iklan iklim ilmu imbau indah indra infak ingat insan intan irama iring
jahat jalan jambu jamin janji jarak jatuh jawab jebol jelas jenuh jeruk jimat jodoh joget juara jujur junub
kabar kabur kadar kagum kakak kalam kaldu kalem kalut kamar kamus kanal kanon kantin kapak kapal karat karib kasir katak kawat kayuh kebal kebun kecap kecil kedai kedap kejar kelam kelar kelas kelok keluh kenal kendur kerah keras kerap keris keruh kesal ketat ketua ketuk kibas kibar kilat kipas kirim kisah kokoh kolam komik kompas kompor kopra korban kotak kuasa kucir kumis kurva kusut
labuh lahan lajur lalat lalai lampu lapar lapor larut lasak latih lawan layak lebah lebar lecet ledak legal lelah lemah lemak lepas lewat licin lidah lihat lilin limit limau lirik liter logam lokal lumut lunak lurus
mabuk macan macet mahir makan makna makro malu manis marah marka masuk matang media medik medan megah mekar merah merdu mesra mesin meski mesti meter mewah mimpi minat minor minus mirip mitos modal mogok mohon moral motif muara mudik mulia mulut murah murid murka musim musuh
nada nanas nanar nalar napas nasib natal nikah nilai nomor nyata nyali nyala nyasar
obati obral ombak orang
pacar padam pagar pahit pakai pakar paksa paman panas panen panel panik pantas papan parah parut pasar pasif patuh payah pecah pedas pegal pelan pelik peluk penuh pepat peran perih pesan pesat petak petir pihak pikat pikul pilar pipih pipis pisah pijat polos pompa puasa puing pukul pulas pulau pulih pulut punah punuk pupuk purba pusar pusat putar putih
rabun racik racun radar raga ragam rahim rajin rakit ramai ramah ranah rapat rapor rawan rayap resah rewel rindu risau ritme robot rokok roman rompi rusak rutin
sabar sabit sabun sadar sadis sahut saksi salah salak salin salju salur saraf sarat saring satwa sebab sebar sebut sedap sedih segar sejak sejuk sekat sekop selai selam selang selat semak semat semen semir sempit senam senat sendi senja sepah serah seram serat sesak setan setor sehat siang sikat siksa silam silang silau simak simpan sinar singa sipil siram sirup sisih solar sopan sorak sorot sosok suara suami subur sudut sujud sukar sulam sulit sumur sunyi suram surat surga surut susah susun sutra syarat syukur
tabah tabir tabuh tajam takar takut talak taman tanah tangis tangki tangsi tanpa tapak tapir tatap tebak tebal tebar tegas teguh telak telan telat teman tempa tenang tenar tentu tepuk teras terbit terjun tiang tikar tikus timah timun tipis tirai titip tolak topan topik total trofi tuang tubuh tuduh tulis tumis tunai tunas tunda turun tutur
umbar umpan umur unduh undur unjuk utara utama
vakum valid vokal
wadah wajah wajik wakil walau walet waras waris wasir wasit waktu welas warga warta watak wawas wujud
yakin yakni yatim zakat zaman zikir zimat zombi
`.trim().split(/\s+/);

export const WORDLE_WORDS: readonly string[] = [...new Set(WORDS.filter((word) => /^[a-z]{5}$/.test(word)))];
export const WORDLE_WORD_SET = new Set(WORDLE_WORDS);

export function pickWordleWord(random: () => number = Math.random): string {
  const value = random();
  const index = Math.floor(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 0.999999999) * WORDLE_WORDS.length);
  return WORDLE_WORDS[index]!;
}
