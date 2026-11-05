import { createHash, randomUUID } from "node:crypto";

const MAX_TEXT_LENGTH = 10_000;
const MAX_BASE64_BYTES = 2_900;

export function currentTime(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone,
    }).format(new Date());
  } catch {
    return null;
  }
}

export function createUuid(): string {
  return randomUUID();
}

export function sha256(text: string): string | null {
  if (!text.trim() || text.length > MAX_TEXT_LENGTH) return null;
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function splitModeInput(input: string): { mode: string; text: string } | null {
  const separator = input.search(/\s/);
  if (separator < 1) return null;
  return { mode: input.slice(0, separator).toLowerCase(), text: input.slice(separator + 1) };
}

export function convertBase64(mode: string, text: string): string | null {
  if (!text) return null;
  if (mode === "encode") {
    const bytes = Buffer.from(text, "utf8");
    return bytes.length <= MAX_BASE64_BYTES ? bytes.toString("base64") : null;
  }
  if (text.length > Math.ceil(MAX_BASE64_BYTES / 3) * 4) return null;
  if (mode !== "decode" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) return null;

  const bytes = Buffer.from(text, "base64");
  if (bytes.length > MAX_BASE64_BYTES || bytes.toString("base64") !== text) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
