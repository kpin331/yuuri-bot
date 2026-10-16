export interface MediaInfo {
  title?: string;
  author?: string;
  caption?: string;
  date?: string;
  likes?: number;
  views?: number;
  source?: string;
}

const MAX_CAPTION_LENGTH = 1000;

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

function parseLikes(value: unknown): number | undefined {
  const direct = asNumber(value);
  if (direct !== undefined) return direct;
  if (value && typeof value === "object") {
    const nums = Object.values(value as Record<string, unknown>).filter(
      (v): v is number => typeof v === "number",
    );
    if (nums.length > 0) return nums.reduce((sum, n) => sum + n, 0);
  }
  return undefined;
}

function parseDate(value: unknown): string | undefined {
  const direct = asString(value);
  if (!direct) return undefined;
  if (/^\d{8}$/.test(direct)) {
    return `${direct.slice(0, 4)}-${direct.slice(4, 6)}-${direct.slice(6, 8)}`;
  }
  return direct;
}

export function parseInfo(raw: unknown): MediaInfo {
  if (!raw || typeof raw !== "object") return {};
  const data = raw as Record<string, unknown>;
  const info: MediaInfo = {};

  info.title = asString(data.title) ?? asString(data.grid_title) ?? asString(data.fulltitle);
  info.caption =
    asString(data.description) ??
    asString(data.content) ??
    asString(data.full_text) ??
    asString(data.caption) ??
    asString(data.selftext);

  const author = data.pinner ?? data.user ?? data.channel;
  if (typeof author === "string") {
    info.author = author;
  } else if (author && typeof author === "object") {
    const a = author as Record<string, unknown>;
    info.author =
      asString(a.full_name) ??
      asString(a.name) ??
      asString(a.username) ??
      asString(a.screen_name) ??
      asString(a.nick);
  }
  info.author =
    info.author ?? asString(data.uploader) ?? asString(data.channel) ?? asString(data.uploader_id);

  info.likes = parseLikes(
    data.like_count ?? data.favorites ?? data.likes ?? data.favorite_count ?? data.reaction_counts,
  );
  info.views = asNumber(data.view_count) ?? asNumber(data.views) ?? asNumber(data.play_count);
  info.date = parseDate(data.upload_date ?? data.created_at ?? data.date);

  const pinnedId = asString(data.id);
  info.source =
    asString(data.webpage_url) ??
    asString(data.original_url) ??
    (pinnedId && data.pinner ? `https://www.pinterest.com/pin/${pinnedId}/` : undefined) ??
    asString(data.url);

  return info;
}

export function formatInfo(info: MediaInfo): string | undefined {
  const lines: string[] = [];

  if (info.title) lines.push(`<b>${escapeHtml(info.title)}</b>`);
  if (info.author) lines.push(`👤 ${escapeHtml(info.author)}`);
  if (info.date) lines.push(`🗓 ${escapeHtml(info.date)}`);

  const stats: string[] = [];
  if (info.views !== undefined) stats.push(`👁 ${formatCount(info.views)}`);
  if (info.likes !== undefined) stats.push(`❤️ ${formatCount(info.likes)}`);
  if (stats.length > 0) lines.push(stats.join("    "));

  if (info.caption) lines.push("", escapeHtml(info.caption));
  if (info.source) lines.push("", `🔗 <a href="${escapeHtml(info.source)}">Source</a>`);

  if (lines.length === 0) return undefined;

  const text = lines.join("\n");
  return text.length > MAX_CAPTION_LENGTH ? `${text.slice(0, MAX_CAPTION_LENGTH - 1)}…` : text;
}
