// Helpers for the interactive setup script (`npm run setup`). Everything here
// is pure so it can be unit tested without touching the terminal.

export interface BuildEnvOptions {
  /** The .env.example template, used to keep comments and ordering. */
  template: string;
  /** Content of an existing .env, if any. Active values are preserved. */
  existing?: string;
  /**
   * Values to write. A key that also appears in the template is uncommented and
   * filled in place; an empty string clears the key, which the config readers
   * treat as unset.
   */
  updates: Record<string, string>;
}

const ACTIVE_KEY = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
// A commented key must have no space before "=", so prose like
// "# true = anyone can use the bot" is not mistaken for a key.
const COMMENT_KEY = /^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function keyOf(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("#")) return COMMENT_KEY.exec(line)?.[1] ?? null;
  return ACTIVE_KEY.exec(line)?.[1] ?? null;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

// Reads active `KEY=value` lines. Comments and blank lines are ignored.
export function parseEnvFile(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = ACTIVE_KEY.exec(line);
    if (!match) continue;
    values.set(match[1] as string, stripQuotes(match[2] ?? ""));
  }
  return values;
}

// Rebuilds a .env from the template. Comments and ordering of the template are
// kept, previously set values survive, and keys that exist only in the old .env
// are appended at the end.
export function buildEnvFile({ template, existing, updates }: BuildEnvOptions): string {
  const current = existing ? parseEnvFile(existing) : new Map<string, string>();
  const templateKeys = new Set<string>();
  const written = new Set<string>();
  const lines: string[] = [];

  for (const line of template.split(/\r?\n/)) {
    const key = keyOf(line);
    if (key) {
      templateKeys.add(key);
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        lines.push(`${key}=${updates[key]}`);
        written.add(key);
        continue;
      }
      if (current.has(key)) {
        lines.push(`${key}=${current.get(key)}`);
        written.add(key);
        continue;
      }
    }
    lines.push(line);
  }

  const extras = [...current.keys()].filter((key) => !templateKeys.has(key) && !written.has(key));
  if (extras.length > 0) {
    lines.push("", "# Extra values kept from the previous .env");
    for (const key of extras) lines.push(`${key}=${current.get(key)}`);
  }

  return lines.join("\n");
}

export function validateBotToken(value: string): string | null {
  const token = value.trim();
  if (token.length === 0) return "The bot token is required.";
  if (!/^\d{5,}:[A-Za-z0-9_-]{25,}$/.test(token)) {
    return "That does not look like a bot token (expected digits, a colon, then the secret, like 123456789:ABC...).";
  }
  return null;
}

export function validateNumericId(value: string): string | null {
  const id = value.trim();
  if (id.length === 0) return "The owner ID is required.";
  if (!/^\d+$/.test(id)) {
    return "The owner ID must be digits only. Message @userinfobot to get your numeric ID.";
  }
  if (!Number.isSafeInteger(Number(id))) return "That ID is not a valid Telegram user ID.";
  return null;
}

// Keeps digits only (drops "+", spaces, dashes) and checks the length looks like
// an international phone number.
export function normalizePhoneNumber(value: string): string {
  return value.replace(/\D/g, "");
}

export function validatePhoneNumber(value: string): string | null {
  const digits = normalizePhoneNumber(value);
  if (digits.length < 8) {
    return "Enter the full number in international format, digits only (e.g. 6281234567890).";
  }
  if (digits.length > 15) return "That number is too long (international numbers have at most 15 digits).";
  return null;
}
