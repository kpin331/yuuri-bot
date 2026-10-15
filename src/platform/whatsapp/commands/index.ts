import { registerKnownCommand } from "../../../lib/command.js";
import type { WaCommand } from "../types.js";
import { banCommands } from "./ban.js";
import { downloadCommands } from "./download.js";
import { menuCommand } from "./menu.js";
import { pinCommand } from "./pinterest.js";
import { pixivCommand } from "./pixiv.js";
import { playCommand } from "./play.js";
import { quotaCommand } from "./quota.js";
import { stickerCommand } from "./sticker.js";
import { sysCommand } from "./sys.js";
import { toimgCommand } from "./toimg.js";
import { userinfoCommand } from "./userinfo.js";

// Every WhatsApp command, in menu order. Command names match the Telegram ones
// so the shared enable/disable state applies to both platforms.
const ALL: WaCommand[] = [
  menuCommand,
  userinfoCommand,
  quotaCommand,
  stickerCommand,
  toimgCommand,
  playCommand,
  ...downloadCommands,
  pinCommand,
  pixivCommand,
  ...banCommands,
  sysCommand,
];

const byName = new Map<string, WaCommand>();
for (const command of ALL) {
  byName.set(command.name.toLowerCase(), command);
  // Commands only present on WhatsApp (e.g. "quota") must still be toggleable
  // with "!<command> on|off", which reads the shared known-command set.
  registerKnownCommand(command.name);
  for (const alias of command.aliases ?? []) {
    byName.set(alias.toLowerCase(), command);
    registerKnownCommand(alias);
  }
}

export function findCommand(name: string): WaCommand | undefined {
  return byName.get(name.toLowerCase());
}

export function allCommands(): WaCommand[] {
  return ALL;
}
