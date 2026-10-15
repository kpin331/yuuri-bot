import {
  getAdminNumbers,
  getAdminQuota,
  getDefaultQuota,
  getOwnerNumbers,
  getRateLimit,
  getRateWindowSeconds,
  getTimezone,
} from "../lib/config.js";
import { getQuotaRow, isDatabaseReady, listQuotaRows, setQuotaRow } from "../lib/db.js";
import { secondsUntilNextMidnight, tzDateKey } from "./time.js";

export type Role = "owner" | "admin" | "member";

// Decides a user's role from their normalized phone digits. A user is an admin
// if they are in ADMIN_NUMBERS or (in groups) a WhatsApp group admin.
export function resolveRole(number: string | null, groupAdmin: boolean): Role {
  if (number && getOwnerNumbers().includes(number)) return "owner";
  if (number && getAdminNumbers().includes(number)) return "admin";
  if (groupAdmin) return "admin";
  return "member";
}

// The quota a role gets at each daily reset. Owner is unlimited (Infinity).
export function roleLimit(role: Role): number {
  if (role === "owner") return Number.POSITIVE_INFINITY;
  return role === "admin" ? getAdminQuota() : getDefaultQuota();
}

export interface QuotaStatus {
  quotaLeft: number;
  total: number;
  unlimited: boolean;
  resetInSeconds: number;
  role: Role;
}

// Reads the user's quota, applying the daily reset first when the stored reset
// date is older than today in the configured timezone. This is why no scheduler
// is needed: the reset is computed lazily on the next command.
export function getQuota(
  platform: string,
  userId: string,
  role: Role,
  displayName: string | null,
  now: number = Date.now(),
): QuotaStatus {
  const timeZone = getTimezone();
  const today = tzDateKey(now, timeZone);
  const resetInSeconds = secondsUntilNextMidnight(now, timeZone);

  // The owner skips quota entirely and we never store a limit for them.
  if (role === "owner") {
    return {
      quotaLeft: Number.POSITIVE_INFINITY,
      total: Number.POSITIVE_INFINITY,
      unlimited: true,
      resetInSeconds,
      role,
    };
  }

  const limit = roleLimit(role);

  if (!isDatabaseReady()) {
    return { quotaLeft: limit, total: limit, unlimited: false, resetInSeconds, role };
  }

  const row = getQuotaRow(platform, userId);
  let quotaLeft: number;

  if (!row) {
    // First time we see this user: start them at their role's limit.
    quotaLeft = limit;
    setQuotaRow({ platform, userId, quotaLeft, lastReset: today, displayName, at: now });
  } else if (row.lastReset !== today) {
    // A new day began while the bot may have been offline: reset now.
    quotaLeft = limit;
    setQuotaRow({ platform, userId, quotaLeft, lastReset: today, displayName, at: now });
  } else {
    // Same day: keep the remaining quota, just refresh name/last-seen.
    quotaLeft = row.quotaLeft;
    setQuotaRow({ platform, userId, quotaLeft, lastReset: row.lastReset, displayName, at: now });
  }

  return { quotaLeft, total: limit, unlimited: false, resetInSeconds, role };
}

// Spends 1 quota for a real command run. Never drops below zero.
export function consumeQuota(platform: string, userId: string): void {
  if (!isDatabaseReady()) return;
  const row = getQuotaRow(platform, userId);
  if (!row || row.quotaLeft <= 0) return;
  setQuotaRow({
    platform,
    userId,
    quotaLeft: row.quotaLeft - 1,
    lastReset: row.lastReset,
    displayName: row.displayName,
    at: Date.now(),
  });
}

// === Rate limit (in-memory fixed window) ===
// One window per user, anchored at their first request and lasting
// RATE_WINDOW_SECONDS. Unlike the previous sliding window, the window start does
// not move with each request, so the counter reliably reaches RATE_LIMIT and the
// next request is blocked until the window expires.
interface RateBucket {
  windowStart: number;
  count: number;
}

const rateBuckets = new Map<string, RateBucket>();

export interface RateResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  platform: string,
  userId: string,
  now: number = Date.now(),
): RateResult {
  const windowMs = getRateWindowSeconds() * 1000;
  const limit = getRateLimit();
  const key = `${platform}:${userId}`;

  // Start a fresh window on the first request or once the previous one expired.
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { windowStart: now, count: 0 };
  }

  if (bucket.count >= limit) {
    rateBuckets.set(key, bucket);
    // Seconds until this window ends.
    const remaining = Math.ceil((bucket.windowStart + windowMs - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, remaining) };
  }

  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

// Test helper: forget all rate-limit history.
export function resetRateLimits(): void {
  rateBuckets.clear();
}

export interface QuotaResetEntry {
  platform: string;
  userId: string;
  displayName: string | null;
  role: Role;
  before: number;
  after: number;
  restored: number;
}

// Resets every stored quota back to the user's current role limit, regardless
// of the daily reset date, and reports how much each user got back. Owner rows
// are skipped because owners are unlimited and have no stored limit.
export function resetAllQuotas(now: number = Date.now()): QuotaResetEntry[] {
  if (!isDatabaseReady()) return [];
  const today = tzDateKey(now, getTimezone());
  const entries: QuotaResetEntry[] = [];

  for (const row of listQuotaRows()) {
    const role = resolveRole(row.userId, false);
    if (role === "owner") continue;

    const limit = roleLimit(role);
    setQuotaRow({
      platform: row.platform,
      userId: row.userId,
      quotaLeft: limit,
      lastReset: today,
      displayName: row.displayName,
      at: now,
    });

    entries.push({
      platform: row.platform,
      userId: row.userId,
      displayName: row.displayName,
      role,
      before: row.quotaLeft,
      after: limit,
      restored: limit - row.quotaLeft,
    });
  }

  return entries;
}
