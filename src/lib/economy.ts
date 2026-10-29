import { exchangePoints, getWallet, transferBank } from "./casino-storage.js";

const money = (amount: number): string => `Rp${amount.toLocaleString("id-ID")}`;
const packages = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

function parseAmount(raw: string): number | null {
  const value = raw.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(value)) return null;
  const amount = Number(value.replaceAll(".", ""));
  return Number.isSafeInteger(amount) ? amount : null;
}

export function exchangePointsMessage(userId: string, args: string, prefix: string): string {
  const wallet = getWallet(userId);
  if (!wallet) return "Penyimpanan kasino belum siap.";
  const raw = args.trim();
  if (!raw) {
    const options = packages.map((points) => `- ${points} Point = ${money(points * 10_000)}`);
    return [
      "Tukar Point ke saldo wallet",
      ...options,
      `Point kamu: ${wallet.points}`,
      `Pilih jumlah 1 sampai 50 Point: ${prefix}tukar <jumlah>`,
      "Maksimal per penukaran: 50 Point (Rp500.000).",
    ].join("\n");
  }

  const points = parseAmount(raw);
  if (points === null || points < 1 || points > 50) {
    return `Masukkan jumlah Point 1 sampai 50. Batas penukaran adalah ${money(500_000)} per transaksi.`;
  }
  const result = exchangePoints(userId, points);
  if (!result.ok) {
    if (result.reason === "insufficient") return `Point tidak cukup. Point kamu: ${wallet.points}.`;
    if (result.reason === "limit") return "Saldo wallet sudah terlalu besar untuk ditambah dengan aman.";
    return "Penyimpanan kasino belum siap.";
  }
  return `Berhasil menukar ${points} Point menjadi ${money(points * 10_000)}. Saldo wallet: ${money(result.wallet.balance)}. Sisa Point: ${result.wallet.points}.`;
}

export function bankMessage(userId: string, args: string, prefix: string): string {
  const wallet = getWallet(userId);
  if (!wallet) return "Penyimpanan kasino belum siap.";
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return [
      "Bank virtual",
      `Saldo wallet: ${money(wallet.balance)}`,
      `Saldo bank: ${money(wallet.bankBalance)}`,
      `Setor: ${prefix}bank deposit <jumlah>`,
      `Tarik: ${prefix}bank tarik <jumlah>`,
    ].join("\n");
  }
  if (parts.length !== 2 || !/^(deposit|tarik)$/i.test(parts[0] ?? "")) {
    return `Cara pakai: ${prefix}bank deposit <jumlah> atau ${prefix}bank tarik <jumlah>.`;
  }

  const action = parts[0]!.toLowerCase() === "deposit" ? "deposit" : "withdraw";
  const amount = parseAmount(parts[1] ?? "");
  if (amount === null || amount < 1) return "Jumlah harus berupa Rupiah bulat yang lebih dari nol.";
  const result = transferBank(userId, action, amount);
  if (!result.ok) {
    if (result.reason === "insufficient") {
      return action === "deposit"
        ? `Saldo wallet tidak cukup. Saldo wallet: ${money(wallet.balance)}.`
        : `Saldo bank tidak cukup. Saldo bank: ${money(wallet.bankBalance)}.`;
    }
    if (result.reason === "limit") return "Transaksi melewati batas angka yang aman.";
    return "Penyimpanan kasino belum siap.";
  }
  const actionText = action === "deposit" ? "disetor ke bank" : "ditarik dari bank";
  return `Berhasil ${actionText} ${money(amount)}. Saldo wallet: ${money(result.wallet.balance)}. Saldo bank: ${money(result.wallet.bankBalance)}.`;
}
