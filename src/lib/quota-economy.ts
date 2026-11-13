import { getQuota, type Role } from "../core/access.js";
import { formatWait, tzDateKey } from "../core/time.js";
import { getTimezone } from "./config.js";
import { getWallet, purchaseQuota } from "./casino-storage.js";
import { isQuotaPackage, QUOTA_PACKAGES, quoteQuotaRefill } from "./quota-packages.js";

const money = (amount: number): string => `Rp${amount.toLocaleString("id-ID")}`;

export function quotaPurchaseMessage(
  platform: "telegram" | "whatsapp",
  userId: string,
  role: Role,
  displayName: string | null,
  args: string,
  prefix: string,
): string {
  const now = Date.now();
  const quota = getQuota(platform, userId, role, displayName, now);
  if (quota.unlimited) return "Kuota kamu tidak terbatas.";

  const wallet = getWallet(userId);
  if (!wallet) return "Penyimpanan kasino belum siap.";

  const raw = args.trim().toLowerCase();
  if (!raw) {
    const packages = QUOTA_PACKAGES.map((name) => {
      const quote = quoteQuotaRefill(name, quota.total, quota.quotaLeft);
      const description = name === "minimum" ? "25% limit" : name === "basic" ? "50% limit" : "sampai penuh";
      if (!quote) return `- ${name}: limit kuota tidak valid`;
      return quote.amount === 0 ? `- ${name} (${description}): kuota sudah penuh`
        : `- ${name} (${description}): +${quote.amount} kuota = ${money(quote.cost)}`;
    });
    return [
      "Kuota harian",
      `Sisa: ${quota.quotaLeft} / ${quota.total}`,
      `Reset dalam: ${formatWait(quota.resetInSeconds)}`,
      `Saldo wallet: ${money(wallet.balance)}`,
      "Paket isi ulang kuota:",
      ...packages,
      `Beli: ${prefix}quota minimum|basic|max`,
      "Harga Rp100 per kuota yang ditambahkan, minimum Rp500 dan maksimum Rp50.000 per pembelian.",
      "Persentase dibulatkan ke atas. Isi ulang tidak menaikkan limit kuota.",
    ].join("\n");
  }

  const today = tzDateKey(now, getTimezone());
  if (!isQuotaPackage(raw)) {
    return `Pilih paket: ${prefix}quota minimum, ${prefix}quota basic, atau ${prefix}quota max.`;
  }

  const result = purchaseQuota(
    platform,
    userId,
    raw,
    role,
    today,
    now,
  );
  if (!result.ok) {
    if (result.reason === "full") return "Kuota kamu sudah penuh. Saldo tidak dipotong.";
    if (result.reason === "frozen") return "Saldo wallet dibekukan karena ada pinjaman jatuh tempo. Lunasi pinjaman terlebih dahulu.";
    if (result.reason === "insufficient") return `⚠️ Saldo wallet tidak cukup. Saldo saat ini: ${money(wallet.balance)}.`;
    if (result.reason === "limit") return "Jumlah kuota melewati batas angka yang aman.";
    return "Pembelian kuota gagal karena penyimpanan belum siap. Coba lagi.";
  }

  const updated = getQuota(platform, userId, role, displayName, now);
  return `Paket ${raw} berhasil: +${result.amount} kuota seharga ${money(result.cost)}. Kuota: ${updated.quotaLeft} / ${updated.total}. Saldo wallet: ${money(result.wallet.balance)}.`;
}
