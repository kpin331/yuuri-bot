import type { Bot, Context } from "grammy";
import { checkRateLimit, consumeQuota, getQuota } from "../core/access.js";
import { formatWait } from "../core/time.js";
import { isAdmin, isOwner } from "../lib/config.js";
import { playCasino, validateCasino, type CasinoGame } from "../lib/casino.js";
import { getWallet, isBalanceFrozen } from "../lib/casino-storage.js";
import { registerCommand } from "../lib/command.js";

async function run(ctx: Context, game: CasinoGame): Promise<void> {
  const user = ctx.from;
  if (!user) return;
  const userId = String(user.id);
  const args = String(ctx.match ?? "").trim();
  const wallet = getWallet(userId);
  if (!wallet) { await ctx.reply("Penyimpanan kasino belum siap."); return; }
  if (isBalanceFrozen(userId)) { await ctx.reply("Saldo wallet dibekukan karena ada pinjaman jatuh tempo. Lunasi pinjaman terlebih dahulu."); return; }
  const validation = validateCasino(game, args, userId);
  if (validation) { await ctx.reply(validation); return; }
  const owner = isOwner(user.id);
  const role = owner ? "owner" : isAdmin(user.id) ? "admin" : "member";
  const quota = getQuota("telegram", userId, role, user.first_name);
  if (!quota.unlimited && quota.quotaLeft < 3) { await ctx.reply("Kuota harian tidak cukup. Kasino memakai 3 kuota per aksi."); return; }
  const rate = checkRateLimit("telegram", userId);
  if (!rate.allowed) { await ctx.reply(`Terlalu banyak permintaan. Coba lagi dalam ${formatWait(rate.retryAfterSeconds)}.`); return; }
  if (!quota.unlimited) consumeQuota("telegram", userId, 3);
  const text = playCasino(game, args, userId);
  await ctx.reply(text);
}

export function registerCasino(bot: Bot): void {
  for (const [name, game] of [["slot", "slot"], ["coinflip", "coin"], ["coin", "coin"], ["roulette", "roulette"], ["blackjack", "blackjack"]] as const) {
    registerCommand(bot, name, (ctx) => run(ctx, game));
  }
  registerCommand(bot, "wallet", async (ctx) => {
    const wallet = ctx.from ? getWallet(String(ctx.from.id)) : null;
    await ctx.reply(wallet ? `💰 Saldo virtual: Rp${wallet.balance.toLocaleString("id-ID")}\n⭐ Point: ${wallet.points}\nSaldo kasino tidak memiliki nilai uang nyata.` : "Penyimpanan kasino belum siap.");
  });
}
