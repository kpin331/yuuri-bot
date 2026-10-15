function parseNumericId(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) ? id : null;
}

function parseIdList(value: string | undefined): number[] {
  if (!value) return [];
  const ids = value
    .split(/[,\s]+/)
    .map((part) => parseNumericId(part))
    .filter((id): id is number => id !== null);
  return [...new Set(ids)];
}

export function getOwnerId(): number | null {
  return parseNumericId(process.env.OWNER_ID);
}

export function isOwner(userId: number | undefined): boolean {
  const ownerId = getOwnerId();
  return ownerId !== null && userId === ownerId;
}

// Admins are configured the same way as the owner: by trusted numeric IDs from
// the environment. Usernames or user-supplied claims are never trusted.
export function getAdminIds(): number[] {
  return parseIdList(process.env.ADMIN_IDS);
}

export function isAdmin(userId: number | undefined): boolean {
  if (userId === undefined) return false;
  return getAdminIds().includes(userId);
}

export function isAuthorized(userId: number | undefined): boolean {
  return isOwner(userId) || isAdmin(userId);
}

export function isEveryoneAllowed(): boolean {
  const value = (process.env.EVERYONE ?? "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "y" || value === "on";
}

export function getPixivRefreshToken(): string | null {
  const value = process.env.PIXIV_REFRESH_TOKEN?.trim();
  return value && value.length > 0 ? value : null;
}

// === WhatsApp + anti-abuse configuration ===

// Turns any phone-like value ("+62 812-345", "62812...") into plain digits, or
// null when there are no digits. Numbers are compared as digits everywhere so
// that "+62 812.." and "62812.." are treated as the same person.
export function normalizeNumber(value: string | undefined | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

// Splits a comma-separated list of phone numbers into normalized digits. We
// split on commas (not spaces) because phone numbers are often written with
// spaces, e.g. "+62 812 3456".
function parseNumberList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\n]+/)
    .map((part) => normalizeNumber(part))
    .filter((part): part is string => part !== null);
}

// Reads a positive integer from the environment, falling back when absent or
// invalid. Used for quota/rate-limit settings.
function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

// The WhatsApp owner's number(s). OWNER_NUMBER is the primary key; OWNER_NUMBERS
// lets you list more than one if needed.
export function getOwnerNumbers(): string[] {
  const single = normalizeNumber(process.env.OWNER_NUMBER);
  const list = parseNumberList(process.env.OWNER_NUMBERS);
  return [...new Set([...(single ? [single] : []), ...list])];
}

// Optional extra admins for private chats (comma separated digits).
export function getAdminNumbers(): string[] {
  return parseNumberList(process.env.ADMIN_NUMBERS);
}

// The number to log in with when using pairing-code login instead of a QR.
export function getPairingNumber(): string | null {
  return normalizeNumber(process.env.PAIRING_NUMBER);
}

// Folder where the WhatsApp login session is stored so restarts keep the login.
export function getWaAuthDir(): string {
  const value = process.env.WA_AUTH_DIR?.trim();
  return value && value.length > 0 ? value : "auth";
}

// Command prefix for WhatsApp. Defaults to "." and only single characters are
// accepted (a multi-character prefix would break the "$"/"!" owner/admin rules).
export function getCommandPrefix(): string {
  const value = process.env.COMMAND_PREFIX?.trim();
  return value && value.length === 1 ? value : ".";
}

export function getOwnerPrefix(): string {
  return "$";
}

export function getAdminPrefix(): string {
  return "!";
}

// Quota limits. Members get DEFAULT_QUOTA, admins get ADMIN_QUOTA, the owner is
// unlimited (handled in the access layer).
export function getDefaultQuota(): number {
  return positiveInt(process.env.DEFAULT_QUOTA, 15);
}

export function getAdminQuota(): number {
  return positiveInt(process.env.ADMIN_QUOTA, 30);
}

// Rate limit: at most RATE_LIMIT requests per RATE_WINDOW_SECONDS per user.
export function getRateLimit(): number {
  return positiveInt(process.env.RATE_LIMIT, 3);
}

export function getRateWindowSeconds(): number {
  return positiveInt(process.env.RATE_WINDOW_SECONDS, 60);
}

// Timezone used for the daily quota reset (default Asia/Jakarta).
export function getTimezone(): string {
  const value = process.env.TIMEZONE?.trim();
  return value && value.length > 0 ? value : "Asia/Jakarta";
}

// === Group access ===

// When true, members may only use the bot inside groups listed in
// ALLOWED_GROUPS. When false (default), any group is allowed.
export function isGroupOnly(): boolean {
  const value = (process.env.GROUP_ONLY ?? "").trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "y" || value === "on";
}

// Normalizes a WhatsApp group id: accepts a full JID ("...@g.us") or a bare id
// and always yields the "...@g.us" form.
function normalizeGroupId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  return trimmed.endsWith("@g.us") ? trimmed : `${trimmed}@g.us`;
}

// Group JIDs allowed to use the bot when GROUP_ONLY is on. Accepts comma-,
// semicolon- or newline-separated ids, with or without the "@g.us" suffix.
export function getAllowedGroups(): string[] {
  const raw = process.env.ALLOWED_GROUPS;
  if (!raw) return [];
  const groups = raw
    .split(/[,;\n]+/)
    .map((part) => normalizeGroupId(part))
    .filter((part) => part.length > 0);
  return [...new Set(groups)];
}

// Whether the given group chat id may use the bot. Always true when GROUP_ONLY
// is off; with it on, only listed groups pass and an empty list allows none.
export function isGroupAllowed(chatId: string | null | undefined): boolean {
  if (!isGroupOnly()) return true;
  if (!chatId) return false;
  return getAllowedGroups().includes(normalizeGroupId(chatId));
}

// === Play link configuration ===

// Optional Spotify app credentials. When both are set the bot uses the Web API
// to read a track's title and artist; otherwise it falls back to oEmbed.
export function getSpotifyClientId(): string | null {
  const value = process.env.SPOTIFY_CLIENT_ID?.trim();
  return value && value.length > 0 ? value : null;
}

export function getSpotifyClientSecret(): string | null {
  const value = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  return value && value.length > 0 ? value : null;
}

// Longest track the bot will download (default 10 minutes). Anything longer is
// refused before downloading.
export function getMaxDurationMinutes(): number {
  return positiveInt(process.env.MAX_DURATION_MINUTES, 10);
}

// === Downloader configuration ===

// Browser to impersonate for yt-dlp (a TLS/HTTP fingerprint that bypasses some
// bot and 403 checks). Accepts any yt-dlp target: "chrome", "firefox",
// "safari", "chrome:windows-10", ... Defaults to "chrome"; set to "none" or
// "off" to disable. (gallery-dl does not support impersonation.)
export function getImpersonateTarget(): string | null {
  const value = (process.env.YTDLP_IMPERSONATE ?? "").trim();
  if (value.length === 0) return "chrome";
  const lower = value.toLowerCase();
  if (["none", "off", "false", "no", "0", "disable", "disabled"].includes(lower)) {
    return null;
  }
  return value;
}
