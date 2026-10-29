import { playCasino, validateCasino, type CasinoGame } from "../../../lib/casino.js";
import { getWallet } from "../../../lib/casino-storage.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

function command(name: string, game: CasinoGame): WaCommand {
  return {
    name,
    quotaCost: 3,
    validate: (args, userId) => validateCasino(game, args, userId),
    run: async ({ message, args }) => {
      await sendText(replyTo(message), playCasino(game, args, message.userId));
    },
  };
}

export const casinoCommands: WaCommand[] = [
  command("slot", "slot"),
  { ...command("coin", "coin"), aliases: ["coinflip"] },
  command("roulette", "roulette"),
  command("blackjack", "blackjack"),
  {
    name: "wallet",
    free: true,
    run: async ({ message }) => {
      const wallet = getWallet(message.userId);
      await sendText(replyTo(message), wallet
        ? `💰 Saldo virtual: Rp${wallet.balance.toLocaleString("id-ID")}\n⭐ Point: ${wallet.points}\nSaldo kasino tidak memiliki nilai uang nyata.`
        : "Penyimpanan kasino belum siap.");
    },
  },
];
