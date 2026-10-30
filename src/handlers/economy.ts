import type { Bot, Context } from "grammy";
import { addMoneyMessage, bankMessage, exchangePointsMessage, loanMessage, parseMoneyAmount, transferMessage } from "../lib/economy.js";
import { findUserByUsername, findUsersByName, hasTelegramUser } from "../lib/db.js";
import { registerCommand, registerOwnerCommand } from "../lib/command.js";

function targetAndAmount(ctx: Context, args: string): { targetId: string | null; amount: number | null } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const amount = parseMoneyAmount(parts.at(-1) ?? "");
  if (amount === null) return { targetId: null, amount: null };
  const targetText = parts.slice(0, -1).join(" ").replace(/^['"]|['"]$/g, "");
  const replyId = ctx.message && "reply_to_message" in ctx.message
    ? ctx.message.reply_to_message?.from?.id
    : undefined;
  let targetId = targetText ? null : replyId ? String(replyId) : null;
  if (targetText.startsWith("@")) targetId = String(findUserByUsername(targetText)?.userId ?? "") || null;
  else if (/^\d+$/.test(targetText) && hasTelegramUser(targetText)) targetId = targetText;
  else if (targetText) {
    const matches = findUsersByName(targetText);
    if (matches.length === 1) targetId = String(matches[0]!.userId);
  }
  if (targetId && !hasTelegramUser(targetId)) targetId = null;
  return { targetId, amount };
}

async function runTransfer(ctx: Context, args: string, ownerGrant: boolean): Promise<void> {
  const user = ctx.from;
  if (!user) return;
  const { targetId, amount } = targetAndAmount(ctx, args);
  if (!targetId || amount === null || amount < 1) {
    await ctx.reply(ownerGrant
      ? "Cara pakai: balas pesan target dengan $addmoney <jumlah>, atau $addmoney <@username|nama|ID> <jumlah>."
      : "Cara pakai: balas pesan target dengan /tf <jumlah>, atau /tf <@username|nama|ID> <jumlah>.");
    return;
  }
  await ctx.reply(ownerGrant
    ? addMoneyMessage(targetId, amount)
    : transferMessage(String(user.id), targetId, amount));
}

export function registerEconomy(bot: Bot): void {
  registerCommand(bot, "tukar", async (ctx: Context) => {
    await ctx.reply(exchangePointsMessage(String(ctx.from?.id ?? ""), String(ctx.match ?? ""), "/"));
  });
  registerCommand(bot, "bank", async (ctx: Context) => {
    await ctx.reply(bankMessage(String(ctx.from?.id ?? ""), String(ctx.match ?? ""), "/"));
  });
  const transfer = (ctx: Context) => runTransfer(ctx, String(ctx.match ?? ""), false);
  registerCommand(bot, "tf", transfer);
  registerCommand(bot, "transfer", transfer);
  registerOwnerCommand(bot, "addmoney", (ctx) => runTransfer(ctx, String(ctx.match ?? ""), true));
  registerCommand(bot, "pinjam", async (ctx: Context) => {
    await ctx.reply(loanMessage("telegram", String(ctx.from?.id ?? ""), String(ctx.match ?? ""), "/"));
  });
}
