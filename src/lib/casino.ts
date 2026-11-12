import { changeBalance, clearBlackjack, getBlackjack, getWallet, saveBlackjack, type BlackjackState } from "./casino-storage.js";

export type CasinoGame = "slot" | "coin" | "roulette" | "blackjack";
export const MIN_CASINO_BET = 100;
export const MAX_CASINO_BET = 50_000_000;
export const CASINO_WIN_CHANCE = 0.55;
export function rollCasinoWin(): boolean { return Math.random() < CASINO_WIN_CHANCE; }
const BET = /^[1-9]\d*$/;
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
  if (!Number.isSafeInteger(bet)) return "Taruhan harus berupa angka yang masih aman untuk dihitung.";
  if (bet < MIN_CASINO_BET || bet > MAX_CASINO_BET) return `Taruhan minimal ${money(MIN_CASINO_BET)} dan maksimal ${money(MAX_CASINO_BET)}.`;
  if (bet > wallet.balance) return `⚠️ Saldo tidak cukup. Saldo saat ini ${money(wallet.balance)}.`;
  const maxMultiplier = game === "roulette" ? 36 : game === "blackjack" ? 2.5 : game === "slot" ? 5 : 2;
  const maxPayout = Math.floor(bet * maxMultiplier);
  if (!Number.isSafeInteger(maxPayout) || !Number.isSafeInteger(wallet.balance - bet + maxPayout)) {
    return "Nominal taruhan terlalu besar untuk diproses dengan aman.";
  }
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
  const validation = validateCasino(game, args, userId);
  if (validation) return validation;
  if (game === "blackjack" && /^(hit|stand)$/i.test(args.trim())) return continueBlackjack(args.trim().toLowerCase(), userId);
  const [betText, choice = ""] = args.trim().split(/\s+/);
  const bet = Number(betText);
  if (!changeBalance(userId, -bet)) return "Taruhan tidak dapat diproses. Periksa saldo wallet.";
  if (game === "slot") {
    const wins = rollCasinoWin();
    const first = 1 + Math.floor(Math.random() * 5);
    const next = first % 5 + 1;
    const reels = wins
      ? [first, first, Math.random() < 0.2 ? first : next]
      : [first, next, next % 5 + 1];
    const win = reels.every((x) => x === reels[0]) ? bet * 5 : reels[0] === reels[1] || reels[1] === reels[2] ? bet * 2 : 0;
    if (win) changeBalance(userId, win);
    return `🎰 ${reels.map((x) => ["🍒", "🍋", "🔔", "⭐", "💎"][x - 1]).join(" | ")}\n${win ? `Menang ${money(win)}!` : "Belum menang."} Saldo: ${money(getWallet(userId)?.balance ?? 0)}.`;
  }
  if (game === "coin") {
    const chosen = choice.toLowerCase();
    const result = rollCasinoWin() ? chosen : chosen === "cara" ? "angka" : "cara";
    const win = result === choice.toLowerCase() ? bet : 0;
    if (win) changeBalance(userId, bet * 2);
    return `🪙 Hasil: ${result}. ${win ? `Menang ${money(win)}!` : "Taruhan kalah."} Saldo: ${money(getWallet(userId)?.balance ?? 0)}.`;
  }
  if (game === "roulette") {
    const wins = rollCasinoWin();
    const results = Array.from({ length: 37 }, (_, number) => number).filter((number) => {
      const matches = /^\d+$/.test(choice) ? number === Number(choice)
        : choice.toLowerCase() === (number === 0 ? "hijau" : RED_NUMBERS.has(number) ? "merah" : "hitam");
      return matches === wins;
    });
    const result = results[Math.floor(Math.random() * results.length)]!;
    const color = result === 0 ? "hijau" : RED_NUMBERS.has(result) ? "merah" : "hitam";
    const payout = wins ? bet * (/^\d+$/.test(choice) ? 36 : 2) : 0;
    if (payout) changeBalance(userId, payout);
    return `🎡 Angka ${result} (${color}). ${wins ? `Menang ${money(payout - bet)}!` : "Taruhan kalah."} Saldo: ${money(getWallet(userId)?.balance ?? 0)}.`;
  }
  const state: BlackjackState = { bet, hand: [draw(), draw()], dealer: [draw(), draw()] };
  const score = total(state.hand);
  if (score === 21) return finishBlackjack(userId, state);
  saveBlackjack(userId, state);
  return `🃏 Kartu kamu: ${state.hand.map(FACE).join(", ")} (${score}). Kartu dealer: ${FACE(state.dealer[0] ?? 1)}, ?. Lanjutkan dengan .blackjack hit atau .blackjack stand.`;
}

function continueBlackjack(action: string, userId: string): string {
  const state = getBlackjack(userId);
  if (!state) return "Tidak ada permainan blackjack aktif.";
  if (action === "hit") {
    state.hand.push(draw());
    if (total(state.hand) >= 21) {
      return finishBlackjack(userId, state);
    }
    saveBlackjack(userId, state);
    return `🃏 Kartu kamu: ${state.hand.map(FACE).join(", ")} (${total(state.hand)}). Ketik .blackjack hit atau .blackjack stand.`;
  }
  return finishBlackjack(userId, state);
}

function finishBlackjack(userId: string, state: BlackjackState): string {
  const wins = rollCasinoWin();
  const natural = state.hand.length === 2 && total(state.hand) === 21;
  clearBlackjack(userId);
  const payout = wins ? Math.floor(state.bet * (natural ? 2.5 : 2)) : 0;
  if (payout) changeBalance(userId, payout);
  const label = wins ? "Kamu menang!" : "Taruhan kalah.";
  return `🃏 ${label} Saldo: ${money(getWallet(userId)?.balance ?? 0)}.`;
}
