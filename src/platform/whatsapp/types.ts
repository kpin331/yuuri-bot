import type { WASocket, WAMessage } from "@whiskeysockets/baileys";
import type { Role } from "../../core/access.js";

// A single inbound WhatsApp message, already normalized so the command layer
// never has to touch JIDs or LID/PN differences directly.
export interface IncomingMessage {
  sock: WASocket;
  /** The chat to reply to (`remoteJid`): a person or a group. */
  chatId: string;
  isGroup: boolean;
  /** The sender's JID as sent by WhatsApp (may be a LID). */
  senderJid: string;
  /** The alternate JID for the sender, when WhatsApp provided one. */
  senderAlt: string | null;
  /** Stable id for storage/quota (phone digits, or "lid:..."). */
  userId: string;
  /** Phone digits when known, otherwise null. */
  phone: string | null;
  /** Push name, when the contact exposed one. */
  name: string | null;
  /** Trimmed text/caption, empty when the message has no text. */
  text: string;
  message: WAMessage;
  /** The quoted message when this one is a reply to media/text. */
  quoted: WAMessage | null;
}

// What a command handler receives once it has been matched and authorized.
export interface CommandContext {
  message: IncomingMessage;
  /** The text after the command name (e.g. the search query). */
  args: string;
  role: Role;
}

export interface WaCommand {
  name: string;
  aliases?: string[];
  /** Only the owner may run it (also reachable with the "$" prefix). */
  ownerOnly?: boolean;
  /** Admins and the owner may run it. */
  adminOnly?: boolean;
  /** Informational commands are not counted against the daily quota. */
  free?: boolean;
  run: (ctx: CommandContext) => Promise<void>;
}
