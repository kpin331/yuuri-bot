import { getQuota, type Role } from "../core/access.js";
import { formatWait, tzDateKey } from "../core/time.js";
import { getTimezone } from "./config.js";
import { DAILY_QUOTA_PRICE, getWallet, purchaseQuota } from "./casino-storage.js";

const money = (amount: number): string => `Rp${amount.toLocaleString("id-ID")}`;

export function quotaPurchaseMessage(
  platform: "telegram" | "whatsapp",
  userId: string,
  role: Role,
  displayName: string | null,
  args: string,
  prefix: string,
): string {
  const quota = getQuota(platform, userId, role, displayName);
  if (quota.unlimited) return "Kuota kamu tidak terbatas.";

  const wallet = getWallet(userId);
  if (!wallet) return "Penyimpanan kasino belum siap.";

  const raw = args.trim();
  if (!raw) {
    const packages = Array.from({ length: 25 }, (_, index) => index + 1)
      .map((amount) => `- ${amount} kuota = ${money(amount * DAILY_QUOTA_PRICE)}`);
    return [
      "Kuota harian",
      `Sisa: ${quota.quotaLeft} / ${quota.total}`,
      `Reset dalam: ${formatWait(quota.resetInSeconds)}`,
      `Saldo wallet: ${money(wallet.balance)}`,
      "Tambahan kuota sampai reset tengah malam:",
      ...packages,
      `Beli: ${prefix}quota <jumlah 1-25>`,
      `Upgrade batas permanen +10 kuota/hari: ${prefix}quota upgrade (Rp500.000)`,
    ].join("\n");
  }

  const today = tzDateKey(Date.now(), getTimezone());
  const matchUpgrade = /^upgrade$/i.test(raw);
  const amount = /^\d+$/.test(raw) ? Number(raw) : null;
  if (!matchUpgrade && (amount === null || !Number.isSafeInteger(amount) || amount < 1 || amount > 25)) {
    return `Pilih jumlah 1 sampai 25 kuota atau gunakan ${prefix}quota upgrade.`;
  }

  const result = purchaseQuota(
    platform,
    userId,
    matchUpgrade ? { kind: "upgrade" } : { kind: "daily", amount: amount! },
    today,
  );
  if (!result.ok) {
    if (result.reason === "frozen") return "Saldo wallet dibekukan karena ada pinjaman jatuh tempo. Lunasi pinjaman terlebih dahulu.";
    if (result.reason === "insufficient") return `Saldo wallet tidak cukup. Saldo saat ini: ${money(wallet.balance)}.`;
    if (result.reason === "limit") return "Jumlah kuota melewati batas angka yang aman.";
    return "Pembelian kuota gagal karena penyimpanan belum siap. Coba lagi.";
  }

  const isUpgrade = matchUpgrade;
  const cost = isUpgrade ? 500_000 : amount! * DAILY_QUOTA_PRICE;
  const description = isUpgrade
    ? "batas harian permanen naik 10 kuota"
    : `ditambahkan ${amount} kuota sampai reset tengah malam`;
  const updated = getQuota(platform, userId, role, displayName);
  return `Pembelian berhasil: ${description} seharga ${money(cost)}. Kuota: ${updated.quotaLeft} / ${updated.total}. Saldo wallet: ${money(result.wallet.balance)}.`;
}
