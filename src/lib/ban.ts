export const DEFAULT_BAN_SECONDS = 3 * 24 * 60 * 60;
export const MAX_BAN_SECONDS = 365 * 24 * 60 * 60;

export type BanArgs =
  | { ok: true; target: string | null; seconds: number }
  | { ok: false; error: string };

type DurationResult = { ok: true; seconds: number } | { ok: false; error: string };

function isTargetToken(token: string): boolean {
  return token.startsWith("@") || /^\d+$/.test(token);
}

export function parseDurationTokens(tokens: string[]): DurationResult {
  if (tokens.length === 0) return { ok: true, seconds: DEFAULT_BAN_SECONDS };
  if (tokens.length > 1) {
    return { ok: false, error: "Provide only one duration: -d<days>, -h<hours>, or <seconds>." };
  }

  const token = tokens[0] ?? "";
  let seconds: number;

  const days = /^-d(\d+)$/i.exec(token);
  const hours = /^-h(\d+)$/i.exec(token);

  if (days) {
    seconds = Number(days[1]) * 86_400;
  } else if (hours) {
    seconds = Number(hours[1]) * 3_600;
  } else if (/^\d+$/.test(token)) {
    seconds = Number(token);
  } else {
    return {
      ok: false,
      error: `Invalid duration '${token}'. Use -d<days>, -h<hours>, or <seconds>.`,
    };
  }

  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return { ok: false, error: "Duration must be a positive number (zero and negatives are invalid)." };
  }
  if (seconds > MAX_BAN_SECONDS) {
    return { ok: false, error: `Duration is too long. The maximum is ${MAX_BAN_SECONDS / 86_400} days.` };
  }

  return { ok: true, seconds };
}

export function parseBanArgs(raw: string): BanArgs {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);

  let target: string | null = null;
  let durationTokens = tokens;

  const first = tokens[0];
  if (first !== undefined && isTargetToken(first)) {
    target = first;
    durationTokens = tokens.slice(1);
  }

  const duration = parseDurationTokens(durationTokens);
  if (!duration.ok) return duration;

  return { ok: true, target, seconds: duration.seconds };
}

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}
