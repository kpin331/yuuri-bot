import type { Role } from "../../../core/access.js";
import { applyCommandToggle, parseToggleInput } from "../../../lib/commandcontrol.js";
import { replyTo, sendText } from "../reply.js";
import type { IncomingMessage } from "../types.js";

// Handles the administrative "!<command> on|off" syntax. This deliberately runs
// outside the quota and disabled-state checks so it can turn commands back on.
export async function runToggle(message: IncomingMessage, raw: string, role: Role): Promise<void> {
  const reply = replyTo(message);
  const parsed = parseToggleInput(raw);

  if (!parsed.ok) {
    // Only guide administrators; never spam ordinary chat that starts with "!".
    if (role !== "member") await sendText(reply, parsed.error);
    return;
  }

  if (role === "member") {
    await sendText(reply, "🚫 Only admins and the owner can change command states.");
    return;
  }

  const result = applyCommandToggle(parsed.command, parsed.state, null);
  await sendText(reply, result.ok ? result.message : result.error);
}
