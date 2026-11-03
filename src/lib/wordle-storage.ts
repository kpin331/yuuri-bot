import { addXp } from "./xp-storage.js";
import { getDb } from "./db.js";
import { jakartaDayKey } from "./wordle.js";

export interface WordleSession {
  solution: string;
  guesses: string[];
}

export interface WordleStats {
  games: number;
  wins: number;
}

export interface WordleGuessResult {
  session: WordleSession;
  finished: boolean;
  won: boolean;
  stats: WordleStats | null;
}

type SessionRow = { solution: string; guesses: string };
type StatsRow = { games: number; wins: number };

function database() {
  const db = getDb();
  if (!db) throw new Error("Penyimpanan Wordle tidak tersedia.");
  return db;
}

function readSession(row: SessionRow): WordleSession {
  const guesses = JSON.parse(row.guesses) as unknown;
  if (!Array.isArray(guesses) || guesses.some((guess) => typeof guess !== "string")) {
    throw new Error("Data ronde Wordle rusak.");
  }
  return { solution: row.solution, guesses };
}

function readStats(row: StatsRow | undefined): WordleStats {
  return { games: Number(row?.games ?? 0), wins: Number(row?.wins ?? 0) };
}

export function getWordleSession(platform: string, chatId: string, userId: string): WordleSession | null {
  const row = database().prepare(
    "SELECT solution, guesses FROM wordle_sessions WHERE platform = ? AND chat_id = ? AND user_id = ?",
  ).get(platform, chatId, userId) as SessionRow | undefined;
  return row ? readSession(row) : null;
}

export function startWordleSession(
  platform: string,
  chatId: string,
  userId: string,
  solution: string,
  at: number = Date.now(),
): WordleSession {
  const db = database();
  const active = getWordleSession(platform, chatId, userId);
  if (active) return active;
  db.prepare(
    `INSERT INTO wordle_sessions (platform, chat_id, user_id, solution, guesses, updated_at)
     VALUES (?, ?, ?, ?, '[]', ?)
     ON CONFLICT(platform, chat_id, user_id) DO NOTHING`,
  ).run(platform, chatId, userId, solution, at);
  return getWordleSession(platform, chatId, userId) ?? { solution, guesses: [] };
}

export function getWordleStats(platform: string, chatId: string, userId: string): WordleStats {
  const row = database().prepare(
    "SELECT games, wins FROM wordle_stats WHERE platform = ? AND chat_id = ? AND user_id = ?",
  ).get(platform, chatId, userId) as StatsRow | undefined;
  return readStats(row);
}

export function recordWordleGuess(
  platform: string,
  chatId: string,
  userId: string,
  guess: string,
  at: number = Date.now(),
): WordleGuessResult | null {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      "SELECT solution, guesses FROM wordle_sessions WHERE platform = ? AND chat_id = ? AND user_id = ?",
    ).get(platform, chatId, userId) as SessionRow | undefined;
    if (!row) {
      db.exec("COMMIT");
      return null;
    }

    const session = readSession(row);
    session.guesses.push(guess);
    const won = guess === session.solution;
    const finished = won || session.guesses.length >= 6;

    if (finished) {
      db.prepare(
        "DELETE FROM wordle_sessions WHERE platform = ? AND chat_id = ? AND user_id = ?",
      ).run(platform, chatId, userId);
      db.prepare(
        `INSERT INTO wordle_stats (platform, chat_id, user_id, games, wins)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(platform, chat_id, user_id) DO UPDATE SET
           games = wordle_stats.games + 1,
           wins = wordle_stats.wins + excluded.wins`,
      ).run(platform, chatId, userId, won ? 1 : 0);
    } else {
      db.prepare(
        "UPDATE wordle_sessions SET guesses = ?, updated_at = ? WHERE platform = ? AND chat_id = ? AND user_id = ?",
      ).run(JSON.stringify(session.guesses), at, platform, chatId, userId);
    }

    const stats = finished
      ? getWordleStats(platform, chatId, userId)
      : null;
    db.exec("COMMIT");
    return { session, finished, won, stats };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function awardWordleWin(input: {
  platform: string;
  chatId: string;
  userId: string;
  displayName: string | null;
  at?: number;
}): Promise<boolean> {
  const db = database();
  const day = jakartaDayKey(input.at);
  db.prepare(
    "DELETE FROM wordle_xp_claims WHERE platform = ? AND user_id = ? AND day <> ?",
  ).run(input.platform, input.userId, day);
  const claim = db.prepare(
    "INSERT OR IGNORE INTO wordle_xp_claims (platform, user_id, day) VALUES (?, ?, ?)",
  ).run(input.platform, input.userId, day);
  if (Number(claim.changes) === 0) return false;

  const total = await addXp({
    platform: input.platform,
    chatId: input.chatId,
    userId: input.userId,
    displayName: input.displayName,
    amount: 25,
    at: input.at,
  });
  if (total !== null) return true;

  db.prepare(
    "DELETE FROM wordle_xp_claims WHERE platform = ? AND user_id = ? AND day = ?",
  ).run(input.platform, input.userId, day);
  return false;
}
