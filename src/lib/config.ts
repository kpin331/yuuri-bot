function parseNumericId(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) ? id : null;
}

export function getOwnerId(): number | null {
  return parseNumericId(process.env.OWNER_ID);
}

export function isOwner(userId: number | undefined): boolean {
  const ownerId = getOwnerId();
  return ownerId !== null && userId === ownerId;
}
