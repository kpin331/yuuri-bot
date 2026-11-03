import { getCommandPrefix } from "../../../lib/config.js";
import { isCommandEnabled, isDatabaseReady } from "../../../lib/db.js";
import { formatWordleBoard, isValidWordleGuess, normalizeWordleGuess, pickWordleWord, WORDLE_MAX_GUESSES } from "../../../lib/wordle.js";
import { awardWordleWin, getWordleSession, recordWordleGuess, startWordleSession } from "../../../lib/wordle-storage.js";
import { replyTo, sendText } from "../reply.js";
import type { IncomingMessage, WaCommand } from "../types.js";

function statsSummary(games: number, wins: number): string {
  const rate = games === 0 ? 0 : Math.round((wins / games) * 100);
  return `Statistik: ${games} permainan, ${wins} menang (${rate}%).`;
}

function renderRound(solution: string, guesses: string[], finished: boolean, won: boolean, games?: number, wins?: number): string {
  const board = formatWordleBoard(solution, guesses);
  if (finished) {
    const outcome = won ? `Kamu menang! Kata: ${solution.toLocaleUpperCase("id-ID")}.` : `Kesempatan habis. Kata: ${solution.toLocaleUpperCase("id-ID")}.`;
    return [board, outcome, games === undefined || wins === undefined ? "" : statsSummary(games, wins)].filter(Boolean).join("\n");
  }
  return [`Tebakan ${guesses.length}/${WORDLE_MAX_GUESSES}:`, board, `Sisa kesempatan: ${WORDLE_MAX_GUESSES - guesses.length}.`].join("\n");
}

export const wordleCommand: WaCommand = {
  name: "wordle",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const reply = replyTo(message);
    if (args.trim()) {
      await sendText(reply, `Kirim ${getCommandPrefix()}wordle untuk mulai atau melanjutkan. Kirim tebakan sebagai pesan biasa.`);
      return;
    }
    if (!isDatabaseReady()) {
      await sendText(reply, "Penyimpanan Wordle sedang tidak tersedia.");
      return;
    }

    const { chatId, userId } = message;
    const active = getWordleSession("whatsapp", chatId, userId);
    if (active) {
      await sendText(reply, [
        "Ronde Wordle kamu masih berjalan. Kirim kata lima huruf untuk menebak.",
        `Tebakan ${active.guesses.length}/${WORDLE_MAX_GUESSES}:`,
        formatWordleBoard(active.solution, active.guesses),
        `Sisa kesempatan: ${WORDLE_MAX_GUESSES - active.guesses.length}.`,
      ].join("\n"));
      return;
    }

    startWordleSession("whatsapp", chatId, userId, pickWordleWord());
    await sendText(reply, "Wordle dimulai. Tebak kata bahasa Indonesia lima huruf dalam enam kesempatan. Kirim satu kata sebagai pesan biasa.");
  },
};

export async function maybeHandleWordleReply(message: IncomingMessage): Promise<boolean> {
  const guess = normalizeWordleGuess(message.text);
  if (!guess || !isDatabaseReady()) return false;
  if (!isCommandEnabled("wordle")) return false;

  const { chatId, userId } = message;
  const active = getWordleSession("whatsapp", chatId, userId);
  if (!active) return false;
  const reply = replyTo(message);
  if (!isValidWordleGuess(guess)) {
    await sendText(reply, "Kata itu belum ada di kamus Wordle. Coba kata Indonesia lima huruf lainnya.");
    return true;
  }

  const result = recordWordleGuess("whatsapp", chatId, userId, guess);
  if (!result) return false;
  if (!result.finished) {
    await sendText(reply, renderRound(result.session.solution, result.session.guesses, false, false));
    return true;
  }

  let reward = "";
  if (result.won) {
    const awarded = await awardWordleWin({
      platform: "whatsapp",
      chatId,
      userId,
      displayName: message.name,
    });
    reward = awarded ? "Hadiah: 25 XP." : "Hadiah XP hari ini sudah kamu dapat.";
  }
  await sendText(reply, `${renderRound(result.session.solution, result.session.guesses, true, result.won, result.stats?.games, result.stats?.wins)}${reward ? `\n${reward}` : ""}`);
  return true;
}
