import { exec } from "./exec.js";
import { TOOLS } from "./tools.js";

// Turns a raw query into a Pinterest search URL, or keeps an existing link.
export function buildSearchUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(input)}`;
}

// Uses gallery-dl to fetch up to 8 pins and returns the ones that carry images.
export async function searchPins(url: string): Promise<Record<string, unknown>[]> {
  const { stdout } = await exec(TOOLS.galleryDl, ["-j", "--range", "1-8", url], {
    timeoutMs: 180_000,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const pins: Record<string, unknown>[] = [];
  for (const entry of parsed) {
    if (Array.isArray(entry) && entry[1] && typeof entry[1] === "object") {
      const pin = entry[1] as Record<string, unknown>;
      if (pin.images) pins.push(pin);
    }
  }
  return pins;
}

// Picks the largest available image URL from a pin's image map.
export function bestImageUrl(pin: Record<string, unknown>): string | undefined {
  const images = pin.images;
  if (!images || typeof images !== "object") return undefined;

  const record = images as Record<string, unknown>;
  const orig = record.orig;
  if (orig && typeof orig === "object") {
    const url = (orig as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }

  let best: { url: string; width: number } | undefined;
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.url === "string") {
        const width = typeof candidate.width === "number" ? candidate.width : 0;
        if (!best || width > best.width) best = { url: candidate.url, width };
      }
    }
  }
  return best?.url;
}

export interface DownloadedPin {
  pin: Record<string, unknown>;
  buffer: Buffer;
}

export function topPins(pins: Record<string, unknown>[], count = 4): Record<string, unknown>[] {
  return pins.filter((pin) => bestImageUrl(pin)).slice(0, count);
}

export async function downloadPin(pin: Record<string, unknown>): Promise<DownloadedPin> {
  const imageUrl = bestImageUrl(pin);
  if (!imageUrl) throw new Error("Pin tidak memiliki gambar yang dapat diunduh.");
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Gagal mengunduh gambar (status ${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 10 * 1024 * 1024) throw new Error("Ukuran gambar melebihi batas 10 MB.");
  return { pin, buffer };
}
