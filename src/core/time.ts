// Timezone helpers for the daily quota reset. We intentionally avoid a separate
// scheduler: every command checks the stored "last reset" date against today in
// the configured timezone, so resets still happen even if the bot was offline at
// midnight.

// Returns the calendar date (YYYY-MM-DD) for a timestamp in the given timezone.
export function tzDateKey(at: number, timeZone: string): string {
  const parts = formatParts(at, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Seconds remaining until the next 00:00 in the given timezone. Used to tell the
// user when their quota comes back.
export function secondsUntilNextMidnight(at: number, timeZone: string): number {
  const parts = formatParts(at, timeZone);
  const secondOfDay =
    Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  return Math.max(0, 86_400 - secondOfDay);
}

// Human-friendly "3h 12m" / "45m" / "30s" rendering of a wait time.
export function formatWait(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

interface TzParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

// Reads the calendar/time fields of a timestamp as seen in `timeZone`.
function formatParts(at: number, timeZone: string): TzParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(at))) {
    if (part.type !== "literal") result[part.type] = part.value;
  }

  // Some locales report midnight as hour "24"; normalize it back to "00".
  const hour = result.hour === "24" ? "00" : (result.hour ?? "00");

  return {
    year: result.year ?? "1970",
    month: result.month ?? "01",
    day: result.day ?? "01",
    hour,
    minute: result.minute ?? "00",
    second: result.second ?? "00",
  };
}
