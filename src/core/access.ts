import {
  getAdminNumbers,
  getAdminQuota,
  getDefaultQuota,
  getOwnerNumbers,
  getRateLimit,
  getRateWindowSeconds,
  getTimezone,
} from "../lib/config.js";
import { getQuotaRow, isDatabaseReady, setQuotaRow } from "../lib/db.js";
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

// === Rate limit (in-memory sliding window) ===
// Rate limiting is per user and does not need to survive restarts, so a simple
// in-memory list of recent timestamps is enough.
const rateHits = new Map<string, number[]>();

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

  // Keep only the timestamps that are still inside the window.
  const recent = (rateHits.get(key) ?? []).filter((time) => time > now - windowMs);

  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    rateHits.set(key, recent);
    // Seconds until the oldest hit leaves the window.
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }

  recent.push(now);
  rateHits.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

// Test helper: forget all rate-limit history.
export function resetRateLimits(): void {
  rateHits.clear();
}
