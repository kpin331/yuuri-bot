// WhatsApp identifies users in two ways:
//   - PN  (phone number)  -> "6281234567890@s.whatsapp.net"
//   - LID (linked id)     -> "123456789012345@lid"
// Which one a message carries depends on the chat's addressing mode. Baileys
// gives us both when it can via the key's `participantAlt`/`remoteJidAlt`. These
// helpers turn any of those forms into the plain phone digits we compare against
// OWNER_NUMBER/ADMIN_NUMBERS, or into a stable id for storage when only a LID is
// known.

const PN_SUFFIX = "@s.whatsapp.net";
const LID_SUFFIX = "@lid";

// Extracts the digits from a JID, dropping the "@server" part and any ":device"
// suffix ("62812:5@s.whatsapp.net" -> "62812"). Returns null when empty.
export function jidDigits(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const at = jid.indexOf("@");
  const user = at === -1 ? jid : jid.slice(0, at);
  const base = user.split(":")[0] ?? user;
  const digits = base.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function isPnJid(jid: string | null | undefined): boolean {
  return typeof jid === "string" && jid.endsWith(PN_SUFFIX);
}

export function isLidJid(jid: string | null | undefined): boolean {
  return typeof jid === "string" && jid.endsWith(LID_SUFFIX);
}

// Returns the phone digits for a user when we can determine them, checking the
// primary JID and then the alternate form. Returns null when only a LID is known.
export function resolvePhone(
  jid: string | null | undefined,
  alt: string | null | undefined,
): string | null {
  if (isPnJid(jid)) return jidDigits(jid);
  if (isPnJid(alt)) return jidDigits(alt);
  return null;
}

// A stable id used for per-user storage, quota and rate limiting. Phone digits
// are preferred so a user looks the same across chats; when only a LID is known
// we tag it ("lid:123") so it can never be confused with a real phone number.
export function canonicalUserId(
  jid: string | null | undefined,
  alt: string | null | undefined,
): string | null {
  const phone = resolvePhone(jid, alt);
  if (phone) return phone;
  const digits = jidDigits(jid) ?? jidDigits(alt);
  return digits ? `lid:${digits}` : null;
}

// True when the id is a place we cannot attach a phone number to (a LID).
export function isLidId(id: string): boolean {
  return id.startsWith("lid:");
}
