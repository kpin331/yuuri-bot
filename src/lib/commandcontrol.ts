import { isKnownCommand } from "./command.js";
import { isDatabaseReady, setCommandState } from "./db.js";

// Commands that must never be disableable: the recovery path back to a working
// bot. `unban` is included so an admin can always release a caught user, and
// `start`/`menu` keep the informational menu reachable.
export const PROTECTED_COMMANDS: ReadonlySet<string> = new Set(["start", "menu", "unban"]);

export type ToggleParse =
  | { ok: true; command: string; state: boolean }
  | { ok: false; error: string };

function normalizeName(value: string): string {
  return value.trim().replace(/^[/$!]/, "").toLowerCase();
}

export function parseToggleInput(raw: string): ToggleParse {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: "Usage: !<command> on|off" };
  if (tokens.length !== 2) return { ok: false, error: "Usage: !<command> on|off" };

  const command = normalizeName(tokens[0] ?? "");
  const stateToken = (tokens[1] ?? "").toLowerCase();

  if (command.length === 0) return { ok: false, error: "Usage: !<command> on|off" };
  if (stateToken !== "on" && stateToken !== "off") {
    return { ok: false, error: "State must be 'on' or 'off'." };
  }

  return { ok: true, command, state: stateToken === "on" };
}

export function isProtectedCommand(command: string): boolean {
  return PROTECTED_COMMANDS.has(normalizeName(command));
}

export type ToggleApply =
  | { ok: true; message: string }
  | { ok: false; error: string };

export function applyCommandToggle(
  command: string,
  enable: boolean,
  actorId: number | null,
): ToggleApply {
  const name = normalizeName(command);

  if (!isKnownCommand(name)) {
    return { ok: false, error: `Unknown command: /${name}` };
  }
  if (!enable && isProtectedCommand(name)) {
    return { ok: false, error: `/${name} is protected and can't be disabled.` };
  }
  if (!isDatabaseReady()) {
    return { ok: false, error: "Storage is unavailable, so the state was not saved." };
  }

  setCommandState(name, enable, actorId);
  return {
    ok: true,
    message: `✅ /${name} is now ${enable ? "enabled" : "disabled"}.`,
  };
}
