import { pino } from "pino";

// A quiet logger shared by the socket, media downloads and the connection code.
// Baileys is very chatty, so the default is "silent"; set WA_LOG_LEVEL=info (or
// debug) to see what it is doing while troubleshooting.
export const logger = pino({ level: process.env.WA_LOG_LEVEL?.trim() || "silent" });

const REDACTED = "[redacted]";
const MAX_DEPTH = 8;
const SENSITIVE_KEYS = new Set(["privKey", "rootKey", "chainKey", "messageKeys"]);

export function redactSessionValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (Buffer.isBuffer(value)) return REDACTED;
  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    return value.map((item) => redactSessionValue(item, depth + 1, seen));
  }
  if (value !== null && typeof value === "object") {
    if (depth >= MAX_DEPTH || seen.has(value)) return REDACTED;
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] =
        SENSITIVE_KEYS.has(key) ? REDACTED : redactSessionValue(item, depth + 1, seen);
    }
    return result;
  }
  return value;
}

const SESSION_LOGS = ["Closing session:", "Opening session:", "Session already closed"];

let redactionInstalled = false;

export function installSessionLogRedaction(): void {
  if (redactionInstalled) return;
  redactionInstalled = true;
  for (const name of ["info", "warn"] as const) {
    const original = console[name].bind(console);
    console[name] = ((...args: unknown[]) => {
      const [first, ...rest] = args;
      if (typeof first === "string" && SESSION_LOGS.includes(first)) {
        original(first, ...rest.map((arg) => redactSessionValue(arg)));
        return;
      }
      original(...args);
    }) as typeof console.info;
  }
}
