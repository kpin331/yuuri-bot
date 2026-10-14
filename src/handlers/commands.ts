import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputFile, type Api, type Bot, type Context } from "grammy";
import { registerCommand } from "../lib/command.js";

const TITLE = "Yuuri Bot V1.0✨";
const SUBTITLE = "List command to use";

function buildMenu(): string {
  return [
    `<b>${TITLE}</b>`,
    `<i>${SUBTITLE}</i>`,
    "",
    "<b>General</b>",
    "/start — Show this menu",
    "/menu — Show this menu",
    "/userinfo — Show usage stats for a user",
    "",
    "<b>Stickers</b>",
    "/s — Reply to an image or video to turn it into a sticker",
    "/toimg — Reply to a sticker to turn it into a PNG image",
    "",
    "<b>Media</b>",
    "/play — Search YouTube and download audio or video",
    "",
    "<b>Downloaders</b>",
    "/dl — Download media from any supported link",
    "/ig — Download from Instagram",
    "/x — Download from X (Twitter)",
    "/fb — Download from Facebook",
    "",
    "<b>Image Search</b>",
    "/pin — Find the top Pinterest image (query or link)",
    "/pixiv — Find the top Pixiv illustration (query only)",
    "",
    "<b>System</b>",
    "$sys — Show system info (owner only)",
  ].join("\n");
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
