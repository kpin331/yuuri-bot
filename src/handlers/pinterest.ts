import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { InputFile, type Bot } from "grammy";
import { exec } from "../lib/exec.js";
import { registerCommand } from "../lib/command.js";
import { formatInfo, parseInfo } from "../lib/info.js";
import { makeTempDir, removeDir } from "../lib/temp.js";
import { TOOLS } from "../lib/tools.js";

function buildSearchUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(input)}`;
}

async function searchPins(url: string): Promise<Record<string, unknown>[]> {
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

function bestImageUrl(pin: Record<string, unknown>): string | undefined {
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

export function registerPinterest(bot: Bot): void {
  registerCommand(bot, "pin", async (ctx) => {
    const replied = ctx.message?.reply_to_message;
    const query =
      typeof ctx.match === "string" && ctx.match.trim().length > 0
        ? ctx.match.trim()
        : (replied?.text ?? replied?.caption ?? "").trim();

    if (!query) {
      await ctx.reply("Usage: /pin <search query or Pinterest link>");
      return;
    }

    const status = await ctx.reply("Searching Pinterest…");
    const dir = await makeTempDir("pin");

    try {
      await ctx.replyWithChatAction("upload_photo");
      const pins = await searchPins(buildSearchUrl(query));

      if (pins.length === 0) {
        await ctx.api.editMessageText(
          status.chat.id,
          status.message_id,
          "No Pinterest image found for that query.",
        );
        return;
      }

      const pin = pins[0]!;
      const imageUrl = bestImageUrl(pin);
      if (!imageUrl) {
        await ctx.api.editMessageText(
          status.chat.id,
          status.message_id,
          "Found a pin but no downloadable image.",
        );
        return;
      }

      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`image download failed (${response.status})`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = extname(new URL(imageUrl).pathname) || ".jpg";
      const path = join(dir, `pin${ext}`);
      await writeFile(path, buffer);

      const pinId = typeof pin.id === "string" ? pin.id : undefined;
      const info = parseInfo(pin);
      const caption = formatInfo({
        ...info,
        source: pinId ? `https://www.pinterest.com/pin/${pinId}/` : info.source,
      });

      await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
      await ctx.replyWithPhoto(
        new InputFile(path),
        caption ? { caption, parse_mode: "HTML" } : {},
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.api
        .editMessageText(status.chat.id, status.message_id, `Pinterest search failed: ${reason}`)
        .catch(() => undefined);
    } finally {
      await removeDir(dir);
    }
  });
}
