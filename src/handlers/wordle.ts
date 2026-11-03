import type { Bot, Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { formatWordleBoard, isValidWordleGuess, normalizeWordleGuess, pickWordleWord, WORDLE_MAX_GUESSES } from "../lib/wordle.js";
import { awardWordleWin, getWordleSession, recordWordleGuess, startWordleSession } from "../lib/wordle-storage.js";
import { isCommandEnabled, isDatabaseReady } from "../lib/db.js";

function statsSummary(games: number, wins: number): string {
  const rate = games === 0 ? 0 : Math.round((wins / games) * 100);
  return `Statistik: ${games} permainan, ${wins} menang (${rate}%).`;
}

function roundText(solution: string, guesses: string[], finished: boolean, won: boolean, games?: number, wins?: number): string {
  const board = formatWordleBoard(solution, guesses);
  if (finished) {
    const outcome = won ? `Kamu menang! Kata: ${solution.toLocaleUpperCase("id-ID")}.` : `Kesempatan habis. Kata: ${solution.toLocaleUpperCase("id-ID")}.`;
    return [board, outcome, games === undefined || wins === undefined ? "" : statsSummary(games, wins)].filter(Boolean).join("\n");
  }
  return [`Tebakan ${guesses.length}/${WORDLE_MAX_GUESSES}:`, board, `Sisa kesempatan: ${WORDLE_MAX_GUESSES - guesses.length}.`].join("\n");
}

async function handleWordle(ctx: Context): Promise<void> {
  const chat = ctx.chat;
  const user = ctx.from;
  if (!chat || !user) return;
  if (typeof ctx.match === "string" && ctx.match.trim()) {
    await ctx.reply("Kirim /wordle untuk mulai atau melanjutkan. Setelah itu, kirim tebakan sebagai pesan biasa.");
    return;
  }
  if (!isDatabaseReady()) {
    await ctx.reply("Penyimpanan Wordle sedang tidak tersedia.");
    return;
  }

  const chatId = String(chat.id);
  const userId = String(user.id);
  const active = getWordleSession("telegram", chatId, userId);
  if (active) {
    await ctx.reply([
      "Ronde Wordle kamu masih berjalan. Kirim kata lima huruf untuk menebak.",
      `Tebakan ${active.guesses.length}/${WORDLE_MAX_GUESSES}:`,
      formatWordleBoard(active.solution, active.guesses),
      `Sisa kesempatan: ${WORDLE_MAX_GUESSES - active.guesses.length}.`,
    ].join("\n"));
    return;
  }

  startWordleSession("telegram", chatId, userId, pickWordleWord());
  await ctx.reply("Wordle dimulai. Tebak kata bahasa Indonesia lima huruf dalam enam kesempatan. Kirim satu kata sebagai pesan biasa.");
}

async function handleGuess(ctx: Context): Promise<boolean> {
  const message = ctx.message;
  const user = ctx.from;
  const chat = ctx.chat;
  const raw = message?.text;
  if (!raw || !user || !chat || !isDatabaseReady()) return false;
  if (!isCommandEnabled("wordle")) return false;
  const guess = normalizeWordleGuess(raw);
  if (!guess) return false;

  const chatId = String(chat.id);
  const userId = String(user.id);
  const active = getWordleSession("telegram", chatId, userId);
  if (!active) return false;
  if (!isValidWordleGuess(guess)) {
    await ctx.reply("Kata itu belum ada di kamus Wordle. Coba kata Indonesia lima huruf lainnya.");
    return true;
  }

  const result = recordWordleGuess("telegram", chatId, userId, guess);
  if (!result) return false;
  if (!result.finished) {
    await ctx.reply(roundText(result.session.solution, result.session.guesses, false, false));
    return true;
  }

  let reward = "";
  if (result.won) {
    const awarded = await awardWordleWin({
      platform: "telegram",
      chatId,
      userId,
      displayName: [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username || userId,
    });
    reward = awarded ? "Hadiah: 25 XP." : "Hadiah XP hari ini sudah kamu dapat.";
  }
  await ctx.reply(`${roundText(result.session.solution, result.session.guesses, true, result.won, result.stats?.games, result.stats?.wins)}${reward ? `\n${reward}` : ""}`);
  return true;
}

export function registerWordle(bot: Bot): void {
  registerCommand(bot, "wordle", handleWordle, { awardXp: false });
  bot.on("message", async (ctx, next) => {
    if (await handleGuess(ctx)) return;
    return next();
  });
}
