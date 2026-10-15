import { getCommandPrefix } from "../../../lib/config.js";
import { isCommandEnabled } from "../../../lib/db.js";
import { replyTo, sendImage, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

const TITLE = "Yuuri Bot V1.0✨";
const SUBTITLE = "List command to use";

interface Item {
  name: string;
  label: string;
}

interface Section {
  title: string;
  items: Item[];
}

function sections(): Section[] {
  const p = getCommandPrefix();
  return [
    {
      title: "General",
      items: [
        { name: "menu", label: `${p}menu — Show this menu` },
        { name: "userinfo", label: `${p}userinfo — Show your stats and quota` },
        { name: "quota", label: `${p}quota — Show remaining daily quota` },
      ],
    },
    {
      title: "Stickers",
      items: [
        { name: "s", label: `${p}s — Reply to an image or video to make a sticker` },
        { name: "toimg", label: `${p}toimg — Reply to a sticker to make a PNG` },
      ],
    },
    {
      title: "Media",
      items: [{ name: "play", label: `${p}play — Search YouTube and send audio or video` }],
    },
    {
      title: "Downloaders",
      items: [
        { name: "dl", label: `${p}dl — Download media from a supported link` },
        { name: "ig", label: `${p}ig — Download from Instagram` },
        { name: "x", label: `${p}x — Download from X (Twitter)` },
        { name: "fb", label: `${p}fb — Download from Facebook` },
      ],
    },
    {
      title: "Image Search",
      items: [
        { name: "pin", label: `${p}pin — Top Pinterest image (query or link)` },
        { name: "pixiv", label: `${p}pixiv — Top Pixiv illustration (query only)` },
      ],
    },
    {
      title: "Moderation",
      items: [
        { name: "ban", label: `${p}ban — Ban a user (admins)` },
        { name: "unban", label: `${p}unban — Unban a user (admins)` },
      ],
    },
  ];
}

export function buildMenu(): string {
  const lines = [`*${TITLE}*`, `_${SUBTITLE}_`];
  for (const section of sections()) {
    lines.push("", `*${section.title}*`);
    for (const item of section.items) {
      // Informational only. Real enforcement happens in the router.
      lines.push(isCommandEnabled(item.name) ? item.label : `${item.label} (OFF)`);
    }
  }
  lines.push(
    "",
    "*System*",
    "$sys — Show system info (owner only)",
    "!<command> on|off — Enable or disable a command (admins)",
  );
  return lines.join("\n");
}

export const menuCommand: WaCommand = {
  name: "menu",
  aliases: ["start"],
  free: true,
  run: async ({ message }) => {
    const reply = replyTo(message);
    const caption = buildMenu();

    // Show the bot's own profile picture as the menu header, like Telegram does,
    // falling back to a plain text menu when no picture is available.
    try {
      const self = message.sock.user?.id;
      const url = self ? await message.sock.profilePictureUrl(self, "image") : undefined;
      if (url) {
        const response = await fetch(url);
        if (response.ok) {
          await sendImage(reply, Buffer.from(await response.arrayBuffer()), caption);
          return;
        }
      }
    } catch (error) {
      console.error("WhatsApp menu profile picture failed:", error);
    }

    await sendText(reply, caption);
  },
};
