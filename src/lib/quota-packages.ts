export const QUOTA_PACKAGES = ["minimum", "basic", "max"] as const;
export type QuotaPackage = (typeof QUOTA_PACKAGES)[number];

export function isQuotaPackage(value: string): value is QuotaPackage {
  return QUOTA_PACKAGES.some((name) => name === value);
}

export function quoteQuotaRefill(name: QuotaPackage, limit: number, remaining: number): { amount: number; cost: number } | null {
  if (!isQuotaPackage(name) || !Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(remaining) || remaining < 0) return null;
  const missing = Math.max(0, limit - remaining);
  const requested = name === "minimum" ? Math.ceil(limit / 4) : name === "basic" ? Math.ceil(limit / 2) : missing;
  const amount = Math.min(requested, missing);
  const cost = amount === 0 ? 0 : Math.max(500, Math.min(amount, 500) * 100);
  return { amount, cost };
}
