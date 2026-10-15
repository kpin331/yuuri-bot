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
