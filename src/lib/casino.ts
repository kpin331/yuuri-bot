import { changeBalance, clearBlackjack, getBlackjack, getWallet, saveBlackjack, type BlackjackState } from "./casino-storage.js";

export type CasinoGame = "slot" | "coin" | "roulette" | "blackjack";
const BET = /^[1-9]\d{0,7}$/;
const FACE = (n: number): number => n === 1 ? 11 : n > 10 ? 10 : n;
function total(hand: number[]): number {
  let sum = hand.reduce((n, card) => n + FACE(card), 0);
  let aces = hand.filter((n) => n === 1).length;
  while (sum > 21 && aces-- > 0) sum -= 10;
  return sum;
}
function draw(): number { return 1 + Math.floor(Math.random() * 13); }
const money = (n: number): string => `Rp${n.toLocaleString("id-ID")}`;
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function validateCasino(game: CasinoGame, args: string, userId: string): string | null {
  const wallet = getWallet(userId);
  if (!wallet) return "Penyimpanan kasino belum siap.";
  if (game === "blackjack" && /^(hit|stand)$/i.test(args.trim())) {
    return getBlackjack(userId) ? null : "Tidak ada permainan blackjack aktif. Mulai dengan .blackjack <taruhan>.";
  }
  if (game === "blackjack" && getBlackjack(userId)) return "Selesaikan permainan blackjack yang sedang berjalan terlebih dahulu.";
  const parts = args.trim().split(/\s+/);
  if (!BET.test(parts[0] ?? "")) return `Format: .${game} <taruhan>${game === "coin" ? " cara|angka" : game === "roulette" ? " merah|hitam|0-36" : ""}`;
  const bet = Number(parts[0]);
  if (bet > wallet.balance) return `Saldo tidak cukup. Saldo saat ini ${money(wallet.balance)}.`;
  if (game === "coin" && !/^(cara|angka)$/i.test(parts[1] ?? "")) return "Pilih sisi: cara atau angka.";
  if (game === "coin" && parts.length !== 2) return "Format: .coinflip <taruhan> cara|angka.";
  if (game === "roulette" && !/^(merah|hitam|[0-9]|[1-2][0-9]|3[0-6])$/i.test(parts[1] ?? "")) return "Pilih merah, hitam, atau angka 0–36.";
  if (game === "roulette" && parts.length !== 2) return "Format: .roulette <taruhan> merah|hitam|0-36.";
  if (game === "blackjack" && parts.length !== 1) return "Gunakan .blackjack <taruhan>, lalu .blackjack hit atau .blackjack stand.";
  if (game === "slot" && parts.length !== 1) return "Format: .slot <taruhan>.";
  if (bet <= 0) return "Taruhan harus lebih dari nol.";
  return null;
}

export function playCasino(game: CasinoGame, args: string, userId: string): string {
  if (game === "blackjack" && /^(hit|stand)$/i.test(args.trim())) return continueBlackjack(args.trim().toLowerCase(), userId);
  const [betText, choice = ""] = args.trim().split(/\s+/);
  const bet = Number(betText);
  changeBalance(userId, -bet);
  if (game === "slot") {
    const reels = Array.from({ length: 3 }, () => 1 + Math.floor(Math.random() * 5));
    const win = reels.every((x) => x === reels[0]) ? bet * 5 : reels[0] === reels[1] || reels[1] === reels[2] ? bet : 0;
    if (win) changeBalance(userId, win);
    return `🎰 ${reels.map((x) => ["🍒", "🍋", "🔔", "⭐", "💎"][x - 1]).join(" | ")}\n${win ? `Menang ${money(win)}!` : "Belum menang."} Saldo: ${money(getWallet(userId)?.balance ?? 0)}.`;
  }
  if (game === "coin") {
    const result = Math.random() < 0.5 ? "cara" : "angka";
    const win = result === choice.toLowerCase() ? bet : 0;
    if (win) changeBalance(userId, bet * 2);
    return `🪙 Hasil: ${result}. ${win ? `Menang ${money(win)}!` : "Taruhan kalah."} Saldo: ${money(getWallet(userId)?.balance ?? 0)}.`;
  }
  if (game === "roulette") {
    const result = Math.floor(Math.random() * 37);
    const color = result === 0 ? "hijau" : RED_NUMBERS.has(result) ? "merah" : "hitam";
    const wins = /^\d+$/.test(choice) ? Number(choice) === result : choice.toLowerCase() === color;
    const payout = wins ? bet * (/^\d+$/.test(choice) ? 36 : 2) : 0;
    if (payout) changeBalance(userId, payout);
    return `🎡 Angka ${result} (${color}). ${wins ? `Menang ${money(payout - bet)}!` : "Taruhan kalah."} Saldo: ${money(getWallet(userId)?.balance ?? 0)}.`;
  }
  const state: BlackjackState = { bet, hand: [draw(), draw()], dealer: [draw(), draw()] };
  const score = total(state.hand);
  if (score === 21) return finishBlackjack(userId, state, "blackjack");
  saveBlackjack(userId, state);
  return `🃏 Kartu kamu: ${state.hand.map(FACE).join(", ")} (${score}). Kartu dealer: ${FACE(state.dealer[0] ?? 1)}, ?. Lanjutkan dengan .blackjack hit atau .blackjack stand.`;
}

function continueBlackjack(action: string, userId: string): string {
  const state = getBlackjack(userId);
  if (!state) return "Tidak ada permainan blackjack aktif.";
  if (action === "hit") {
    state.hand.push(draw());
    if (total(state.hand) >= 21) {
      if (total(state.hand) > 21) return finishBlackjack(userId, state, "bust");
      while (total(state.dealer) < 17) state.dealer.push(draw());
      const dealer = total(state.dealer);
      return finishBlackjack(userId, state, dealer > 21 || total(state.hand) > dealer ? "win" : total(state.hand) === dealer ? "push" : "lose");
    }
    saveBlackjack(userId, state);
    return `🃏 Kartu kamu: ${state.hand.map(FACE).join(", ")} (${total(state.hand)}). Ketik .blackjack hit atau .blackjack stand.`;
  }
  while (total(state.dealer) < 17) state.dealer.push(draw());
  const player = total(state.hand), dealer = total(state.dealer);
  return finishBlackjack(userId, state, player > 21 ? "bust" : dealer > 21 || player > dealer ? "win" : player === dealer ? "push" : "lose");
}

function finishBlackjack(userId: string, state: BlackjackState, outcome: string): string {
  clearBlackjack(userId);
  const payout = outcome === "blackjack" ? Math.floor(state.bet * 2.5) : outcome === "win" ? state.bet * 2 : outcome === "push" ? state.bet : 0;
  if (payout) changeBalance(userId, payout);
  const label = outcome === "blackjack" ? "Blackjack!" : outcome === "win" ? "Kamu menang!" : outcome === "push" ? "Seri." : outcome === "bust" ? "Kartu kamu lewat 21." : "Dealer menang.";
  return `🃏 ${label} Saldo: ${money(getWallet(userId)?.balance ?? 0)}.`;
}
