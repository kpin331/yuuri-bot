import { addWalletMoney, exchangePoints, getWallet, isBalanceFrozen, transferBank, transferWallet } from "./casino-storage.js";
import { borrowLoan, getActiveLoans, MAX_ACTIVE_LOANS, MAX_LOAN_AMOUNT, repayLoan, totalDebt } from "./loans.js";

const money = (amount: number): string => `Rp${amount.toLocaleString("id-ID")}`;
const packages = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

export function parseMoneyAmount(raw: string): number | null {
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

  const points = parseMoneyAmount(raw);
  if (points === null || points < 1 || points > 50) {
    return `Masukkan jumlah Point 1 sampai 50. Batas penukaran adalah ${money(500_000)} per transaksi.`;
  }
  const result = exchangePoints(userId, points);
  if (!result.ok) {
    if (result.reason === "frozen") return "Saldo wallet dibekukan karena ada pinjaman jatuh tempo. Lunasi pinjaman terlebih dahulu.";
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
  const amount = parseMoneyAmount(parts[1] ?? "");
  if (amount === null || amount < 1) return "Jumlah harus berupa Rupiah bulat yang lebih dari nol.";
  const result = transferBank(userId, action, amount);
  if (!result.ok) {
    if (result.reason === "frozen") return "Saldo wallet dibekukan karena ada pinjaman jatuh tempo. Lunasi pinjaman lewat pinjam bayar <jumlah>.";
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

export function transferMessage(senderId: string, recipientId: string, amount: number): string {
  const result = transferWallet(senderId, recipientId, amount);
  if (!result.ok) {
    if (result.reason === "frozen") return "Saldo wallet dibekukan karena ada pinjaman jatuh tempo. Lunasi pinjaman terlebih dahulu.";
    if (result.reason === "insufficient") return "Saldo wallet tidak cukup untuk transfer ini.";
    if (result.reason === "invalid") return "Jumlah transfer tidak valid atau target sama dengan pengirim.";
    if (result.reason === "limit") return "Transfer melewati batas angka yang aman.";
    return "Penyimpanan kasino belum siap.";
  }
  return `Transfer ${money(amount)} berhasil. Saldo kamu: ${money(result.sender.balance)}.`;
}

export function addMoneyMessage(userId: string, amount: number): string {
  const result = addWalletMoney(userId, amount);
  if (!result.ok) {
    if (result.reason === "invalid") return "Jumlah harus berupa Rupiah bulat yang lebih dari nol.";
    if (result.reason === "limit") return "Saldo melewati batas angka yang aman.";
    return "Penyimpanan kasino belum siap.";
  }
  return `Berhasil menambahkan ${money(amount)}. Saldo wallet penerima: ${money(result.wallet.balance)}.`;
}

export function loanMessage(platform: string, userId: string, args: string, prefix: string, at: number = Date.now()): string {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const wallet = getWallet(userId);
  if (!wallet) return "Penyimpanan kasino belum siap.";

  if (parts.length === 0) {
    const loans = getActiveLoans(platform, userId);
    const debt = totalDebt(platform, userId);
    const lines = ["Pinjaman virtual", `Saldo wallet: ${money(wallet.balance)}`, `Total hutang: ${money(debt)}`];
    if (isBalanceFrozen(userId)) lines.push("Saldo dibekukan sampai hutang jatuh tempo dilunasi.");
    if (loans.length) lines.push(`Pinjaman aktif: ${loans.length}/${MAX_ACTIVE_LOANS}`);
    lines.push(`Pinjam: ${prefix}pinjam <jumlah> (maks. ${money(MAX_LOAN_AMOUNT)}, bunga flat 10%)`);
    lines.push(`Bayar: ${prefix}pinjam bayar <jumlah>`);
    return lines.join("\n");
  }

  if (/^bayar$/i.test(parts[0] ?? "")) {
    if (parts.length !== 2) return `Cara pakai: ${prefix}pinjam bayar <jumlah>.`;
    const amount = parseMoneyAmount(parts[1] ?? "");
    if (amount === null || amount < 1) return "Jumlah pembayaran harus berupa Rupiah bulat yang lebih dari nol.";
    const result = repayLoan(platform, userId, amount, at);
    if (!result.ok) {
      if (result.reason === "insufficient") return `Saldo wallet tidak cukup. Saldo: ${money(wallet.balance)}.`;
      if (result.reason === "invalid") return `Jumlah melebihi total hutang (${money(totalDebt(platform, userId))}) atau tidak ada pinjaman aktif.`;
      return "Pelunasan gagal. Periksa jumlah lalu coba lagi.";
    }
    const remaining = totalDebt(platform, userId);
    return `Pembayaran ${money(amount)} berhasil. Sisa hutang: ${money(remaining)}. Saldo wallet: ${money(result.walletBalance)}.${result.frozen ? " Saldo tetap dibekukan karena masih ada pinjaman jatuh tempo." : remaining === 0 ? " Semua pinjaman lunas; saldo tidak lagi dibekukan." : ""}`;
  }

  if (parts.length !== 1) return `Cara pakai: ${prefix}pinjam <jumlah> atau ${prefix}pinjam bayar <jumlah>.`;
  const amount = parseMoneyAmount(parts[0] ?? "");
  if (amount === null || amount < 1 || amount > MAX_LOAN_AMOUNT) return `Jumlah pinjaman harus 1 sampai ${money(MAX_LOAN_AMOUNT)}.`;
  const result = borrowLoan(platform, userId, amount, at);
  if (!result.ok) {
    if (result.reason === "frozen") return "Saldo wallet dibekukan karena pinjaman jatuh tempo. Lunasi hutang terlebih dahulu.";
    if (result.reason === "limit") return `Maksimal ${MAX_ACTIVE_LOANS} pinjaman aktif dan ${money(MAX_LOAN_AMOUNT)} per pinjaman.`;
    return "Pinjaman tidak dapat dibuat. Coba lagi nanti.";
  }
  const loan = result.createdLoan;
  const repay = loan?.remaining ?? amount + Math.ceil(amount / 10);
  const minutes = loan ? Math.round((loan.dueAt - at) / 60_000) : 30;
  return `Pinjaman ${money(amount)} berhasil. Bunga 10%: total pelunasan ${money(repay)}. Jatuh tempo sekitar ${minutes} menit. Saldo wallet: ${money(result.walletBalance)}.`;
}
