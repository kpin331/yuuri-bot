import { randomInt } from "node:crypto";

export interface DiceRoll {
  count: number;
  sides: number;
  values: number[];
  total: number;
}

export function rollDice(input: string): DiceRoll | null {
  const match = /^(?:(\d*)d)?(\d+)$/i.exec(input.trim());
  if (!match) return null;

  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10) return null;
  if (!Number.isSafeInteger(sides) || sides < 2 || sides > 1000) return null;

  const values = Array.from({ length: count }, () => randomInt(1, sides + 1));
  return { count, sides, values, total: values.reduce((sum, value) => sum + value, 0) };
}
