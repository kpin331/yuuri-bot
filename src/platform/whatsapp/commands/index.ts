import { registerKnownCommand } from "../../../lib/command.js";
import type { WaCommand } from "../types.js";
import { banCommands } from "./ban.js";
import { groupinfoCommand, pingCommand } from "./admin.js";
import { commandHelpCommand } from "./help.js";
import { downloadCommands } from "./download.js";
import { menuCommand } from "./menu.js";
import { pinCommand } from "./pinterest.js";
import { pixivCommand } from "./pixiv.js";
import { rankCommands } from "./rank.js";
import { playCommand } from "./play.js";
import { quotaCommand } from "./quota.js";
import { smemeCommand } from "./smeme.js";
import { stickerCommand } from "./sticker.js";
import { sysCommand } from "./sys.js";
import { toimgCommand } from "./toimg.js";
import { tovidCommand } from "./tovid.js";
import { qrCommand } from "./qr.js";
import { userinfoCommand } from "./userinfo.js";
import { casinoCommands } from "./casino.js";
import { purgeCommand } from "./purge.js";
import { economyCommands } from "./economy.js";
import { broadcastCommand } from "./broadcast.js";
import { wordleCommand } from "./wordle.js";
import { stickerAddCommand, stickerRemoveCommand } from "./sticker-catalog.js";

// Every WhatsApp command, in menu order. Command names match the Telegram ones
// so the shared enable/disable state applies to both platforms.
const ALL: WaCommand[] = [
  menuCommand,
  commandHelpCommand,
  pingCommand,
  groupinfoCommand,
  userinfoCommand,
  quotaCommand,
  ...casinoCommands,
  ...economyCommands,
  broadcastCommand,
  ...rankCommands,
  stickerCommand,
  stickerAddCommand,
  stickerRemoveCommand,
  smemeCommand,
  toimgCommand,
  tovidCommand,
  qrCommand,
  playCommand,
  ...downloadCommands,
  pinCommand,
  pixivCommand,
  wordleCommand,
  ...banCommands,
  sysCommand,
  purgeCommand,
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
registerKnownCommand("d");

export function findCommand(name: string): WaCommand | undefined {
  return byName.get(name.toLowerCase());
}

export function allCommands(): WaCommand[] {
  return ALL;
}
