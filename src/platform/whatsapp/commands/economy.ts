import { normalizeMessageContent } from "@whiskeysockets/baileys";
import { canonicalUserId } from "../identity.js";
import { addMoneyMessage, bankMessage, exchangePointsMessage, loanMessage, parseMoneyAmount, payOffAllLoansMessage, transferMessage } from "../../../lib/economy.js";
import { findWaUsersByName, hasWaUser } from "../../../lib/db.js";
import { getCommandPrefix, getOwnerPrefix } from "../../../lib/config.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

function targetAndAmount(message: Parameters<WaCommand["run"]>[0]["message"], args: string): { targetId: string | null; amount: number | null } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const amount = parseMoneyAmount(parts.at(-1) ?? "");
  if (amount === null) return { targetId: null, amount: null };
  const targetText = parts.slice(0, -1).join(" ").replace(/^['"]|['"]$/g, "");
  const content = normalizeMessageContent(message.message.message);
  const mentions = content?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
  let targetId: string | null = null;

  if (targetText && mentions.length > 0) {
    targetId = canonicalUserId(mentions[0], null);
  } else if (!targetText && message.quoted) {
    const jid = message.quoted.key.participant ?? (!message.isGroup ? message.quoted.key.remoteJid : undefined);
    targetId = canonicalUserId(jid, null);
  } else if (/^(?:\d+|lid:\d+)$/.test(targetText) && hasWaUser(targetText)) {
    targetId = targetText;
  } else if (targetText) {
    const matches = findWaUsersByName(targetText);
    if (matches.length === 1) targetId = matches[0]!;
  }

  if (targetId && !hasWaUser(targetId)) targetId = null;
  return { targetId, amount };
}

function makeTransferCommand(ownerGrant: boolean): WaCommand["run"] {
  return async ({ message, args }) => {
    const prefix = ownerGrant ? getOwnerPrefix() : getCommandPrefix();
    const { targetId, amount } = targetAndAmount(message, args);
    if (!targetId || amount === null || amount < 1) {
      await sendText(replyTo(message), ownerGrant
        ? `Cara pakai: balas pesan target dengan ${prefix}addmoney <jumlah>, atau ${prefix}addmoney <@mention|nama|ID> <jumlah>.`
        : `Cara pakai: balas pesan target dengan ${prefix}tf <jumlah>, atau ${prefix}tf <@mention|nama|ID> <jumlah>.`);
      return;
    }
    await sendText(replyTo(message), ownerGrant
      ? addMoneyMessage(targetId, amount)
      : transferMessage(message.userId, targetId, amount));
  };
}

export const economyCommands: WaCommand[] = [
  {
    name: "tukar",
    free: true,
    run: async ({ message, args }) => {
      await sendText(replyTo(message), exchangePointsMessage(message.userId, args, getCommandPrefix()));
    },
  },
  {
    name: "bank",
    free: true,
    run: async ({ message, args }) => {
      await sendText(replyTo(message), bankMessage(message.userId, args, getCommandPrefix()));
    },
  },
  { name: "tf", aliases: ["transfer"], free: true, run: makeTransferCommand(false) },
  { name: "addmoney", ownerOnly: true, free: true, run: makeTransferCommand(true) },
  {
    name: "pinjam",
    free: true,
    run: async ({ message, args }) => {
      await sendText(replyTo(message), loanMessage("whatsapp", message.userId, args, getCommandPrefix()));
    },
  },
  {
    name: "lunas",
    free: true,
    run: async ({ message }) => {
      await sendText(replyTo(message), payOffAllLoansMessage("whatsapp", message.userId));
    },
  },
];
