import { randomInt } from "node:crypto";

export function flipCoin(): "angka" | "gambar" {
  return randomInt(2) === 0 ? "angka" : "gambar";
}

export function chooseOption(input: string): { options: string[]; choice: string } | null {
  const options = input.split("|").map((option) => option.trim());
  if (options.length < 2 || options.length > 20) return null;
  if (options.some((option) => option.length === 0 || option.length > 120)) return null;

  return { options, choice: options[randomInt(options.length)]! };
}

export function calculate(input: string): number | null {
  const source = input.trim();
  if (!source || source.length > 100) return null;

  const tokens: Array<number | string> = [];
  const tokenizer = /\s*(?:(\d+(?:\.\d*)?|\.\d+)|([()+\-*/%^]))/gy;
  let offset = 0;
  while (offset < source.length) {
    tokenizer.lastIndex = offset;
    const match = tokenizer.exec(source);
    if (!match) return null;
    tokens.push(match[1] === undefined ? match[2]! : Number(match[1]));
    if (tokens.length > 64) return null;
    offset = tokenizer.lastIndex;
  }

  let position = 0;
  const primary = (): number | null => {
    const token = tokens[position++];
    if (typeof token === "number") return token;
    if (token !== "(") return null;
    const value = expression();
    if (tokens[position++] !== ")") return null;
    return value;
  };

  const power = (): number | null => {
    const left = primary();
    if (left === null) return null;
    if (tokens[position] !== "^") return left;
    position++;
    const right = unary();
    return right === null ? null : left ** right;
  };

  const unary = (): number | null => {
    const token = tokens[position];
    if (token === "+" || token === "-") {
      position++;
      const value = unary();
      return value === null ? null : token === "-" ? -value : value;
    }
    return power();
  };

  const term = (): number | null => {
    let value = unary();
    if (value === null) return null;
    while (["*", "/", "%"].includes(String(tokens[position]))) {
      const operator = tokens[position++] as string;
      const right = unary();
      if (right === null || ((operator === "/" || operator === "%") && right === 0)) return null;
      value = operator === "*" ? value * right : operator === "/" ? value / right : value % right;
    }
    return value;
  };

  function expression(): number | null {
    let value = term();
    if (value === null) return null;
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++] as string;
      const right = term();
      if (right === null) return null;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = expression();
  if (result === null || position !== tokens.length || !Number.isFinite(result) || Math.abs(result) > 1e12) return null;
  return Object.is(result, -0) ? 0 : result;
}
