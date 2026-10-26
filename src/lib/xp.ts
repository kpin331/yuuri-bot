// Pure level math for the XP system. Storage lives in lib/postgres.ts; this
// file stays dependency-free so the curve can be unit tested without a database.

export const MIN_XP_GAIN = 1;
export const MAX_XP_GAIN = 100;

// Level n starts at this much total XP: level 1 at 0, level 2 at 100,
// level 3 at 300, level 10 at 4500. Each level costs 100 XP more than the
// previous one, so with an average gain of ~50 XP per command, level 10 takes
// roughly 90 commands.
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return 100 * ((n - 1) * n) / 2;
}

// The level this total XP has reached (1-based, never below 1).
export function levelForXp(totalXp: number): number {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level += 1;
  return level;
}

export interface LevelProgress {
  level: number;
  totalXp: number;
  /** XP earned inside the current level. */
  intoLevel: number;
  /** XP needed to finish the current level. */
  neededForLevel: number;
  /** Completion of the current level, 0..100. */
  percent: number;
}

export function levelProgress(totalXp: number): LevelProgress {
  const xp = Math.max(0, Math.floor(totalXp));
  const level = levelForXp(xp);
  const start = xpForLevel(level);
  const end = xpForLevel(level + 1);
  const intoLevel = xp - start;
  const neededForLevel = end - start;
  const percent = neededForLevel <= 0 ? 100 : Math.floor((intoLevel / neededForLevel) * 100);
  return { level, totalXp: xp, intoLevel, neededForLevel, percent };
}

// Random XP for one command use: +1 to +100, both ends included.
export function rollXp(random: () => number = Math.random): number {
  const value = random();
  const clamped = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0;
  return MIN_XP_GAIN + Math.floor(clamped * (MAX_XP_GAIN - MIN_XP_GAIN + 1));
}
