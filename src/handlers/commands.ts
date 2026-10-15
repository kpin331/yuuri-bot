import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputFile, type Api, type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";
import { isCommandEnabled } from "../lib/db.js";

const TITLE = "Yuuri Bot V1.0✨";
const SUBTITLE = "List command to use";

interface MenuItem {
  command: string;
  label: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const SECTIONS: MenuSection[] = [
  {
    title: "General",
    items: [
      { command: "start", label: "/start — Show this menu" },
      { command: "menu", label: "/menu — Show this menu" },
      { command: "userinfo", label: "/userinfo — Show usage stats for a user" },
    ],
  },
  {
    title: "Stickers",
    items: [
      { command: "s", label: "/s — Reply to an image or video to turn it into a sticker" },
      { command: "toimg", label: "/toimg — Reply to a sticker to turn it into a PNG image" },
    ],
  },
  {
    title: "Media",
    items: [{ command: "play", label: "/play — Search YouTube and download audio or video" }],
  },
  {
    title: "Downloaders",
    items: [
      { command: "dl", label: "/dl — Download media from any supported link" },
      { command: "ig", label: "/ig — Download from Instagram" },
      { command: "x", label: "/x — Download from X (Twitter)" },
      { command: "fb", label: "/fb — Download from Facebook" },
    ],
  },
  {
    title: "Image Search",
    items: [
      { command: "pin", label: "/pin — Find the top Pinterest image (query or link)" },
      { command: "pixiv", label: "/pixiv — Find the top Pixiv illustration (query only)" },
    ],
  },
  {
    title: "Moderation",
    items: [
      { command: "ban", label: "/ban — Ban a user (admins)" },
      { command: "unban", label: "/unban — Unban a user (admins)" },
    ],
  },
];

const FOOTER: string[] = [
  "<b>System</b>",
  "$sys — Show system info (owner only)",
  "!&lt;command&gt; on|off — Enable or disable a command (admins)",
];

function renderItem(item: MenuItem): string {
  // Informational only. The real enforcement happens in the command dispatch.
  return isCommandEnabled(item.command) ? item.label : `${item.label} (OFF)`;
}

export function buildMenu(): string {
  const lines = [`<b>${TITLE}</b>`, `<i>${SUBTITLE}</i>`];
  for (const section of SECTIONS) {
    lines.push("", `<b>${section.title}</b>`, ...section.items.map(renderItem));
  }
  lines.push("", ...FOOTER);
  return lines.join("\n");
}

async function getProfilePhotoFileId(api: Api, botId: number): Promise<string | null> {
  try {
    const photos = await api.getUserProfilePhotos(botId, { limit: 1 });
    const first = photos.photos[0];
    return first?.[first.length - 1]?.file_id ?? null;
  } catch (error) {
    console.error("getUserProfilePhotos failed:", error);
    return null;
  }
}

async function downloadProfilePhoto(api: Api, fileId: string): Promise<string | null> {
  const file = await api.getFile(fileId);
  if (!file.file_path) return null;
  const response = await fetch(`https://api.telegram.org/file/bot${api.token}/${file.file_path}`);
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  const dest = join(tmpdir(), `yuuri-profile-${Date.now()}.jpg`);
  await writeFile(dest, buffer);
  return dest;
}

export function registerCommands(bot: Bot): void {
  const showMenu = async (ctx: Context): Promise<void> => {
    const caption = buildMenu();
    const fileId = await getProfilePhotoFileId(ctx.api, ctx.me.id);

    if (fileId) {
      try {
        await ctx.replyWithPhoto(fileId, { caption, parse_mode: "HTML" });
        return;
      } catch (error) {
        console.error("replyWithPhoto(file_id) failed:", error);
      }

      try {
        const downloaded = await downloadProfilePhoto(ctx.api, fileId);
        if (downloaded) {
          await ctx.replyWithPhoto(new InputFile(downloaded), { caption, parse_mode: "HTML" });
          return;
        }
      } catch (error) {
        console.error("replyWithPhoto(InputFile) failed:", error);
      }
    }

    await ctx.reply(caption, { parse_mode: "HTML" });
  };

  registerCommand(bot, "start", showMenu);
  registerCommand(bot, "menu", showMenu);
}
