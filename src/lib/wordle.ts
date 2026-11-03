import { WORDLE_WORD_SET, pickWordleWord } from "./wordle-words.js";

export const WORDLE_MAX_GUESSES = 6;

export type LetterMark = "correct" | "present" | "absent";

export function normalizeWordleGuess(value: string): string | null {
  const guess = value.trim().toLocaleLowerCase("id-ID");
  return /^[a-z]{5}$/.test(guess) ? guess : null;
}

export function isValidWordleGuess(guess: string): boolean {
  return WORDLE_WORD_SET.has(guess);
}

export function scoreWordleGuess(solution: string, guess: string): LetterMark[] {
  const marks: LetterMark[] = Array.from({ length: 5 }, () => "absent");
  const remaining = new Map<string, number>();

  for (let index = 0; index < 5; index += 1) {
    const answerLetter = solution[index]!;
    if (guess[index] === answerLetter) {
      marks[index] = "correct";
    } else {
      remaining.set(answerLetter, (remaining.get(answerLetter) ?? 0) + 1);
    }
  }

  for (let index = 0; index < 5; index += 1) {
    if (marks[index] === "correct") continue;
    const letter = guess[index]!;
    const count = remaining.get(letter) ?? 0;
    if (count > 0) {
      marks[index] = "present";
      remaining.set(letter, count - 1);
    }
  }

  return marks;
}

export function formatWordleBoard(solution: string, guesses: string[]): string {
  return guesses.map((guess) => {
    const marks = scoreWordleGuess(solution, guess);
    const squares = marks.map((mark) => mark === "correct" ? "🟩" : mark === "present" ? "🟨" : "⬛").join("");
    return `${guess.toLocaleUpperCase("id-ID")} ${squares}`;
  }).join("\n");
}

export function jakartaDayKey(at: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export { pickWordleWord };
