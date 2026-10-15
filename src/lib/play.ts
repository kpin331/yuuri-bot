import { escapeHtml } from "./info.js";

export const SEARCH_COUNT = 10;
export const SESSION_TTL_MS = 2 * 60 * 1000;
export const SEARCH_TIMEOUT_MS = 60_000;
export const PROBE_TIMEOUT_MS = 60_000;
export const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export type PlayKind = "audio" | "video";

export interface SearchResult {
  index: number;
  id: string;
  title: string;
  url: string;
  duration?: number;
  uploader?: string;
}

export interface PlayMeta {
  id?: string;
  title: string;
  uploader?: string;
  duration?: number;
  webpageUrl?: string;
  isLive?: boolean;
}

export interface PlaySession {
  chatId: number;
  userId: number;
  messageId: number;
  query: string;
  stage: "choose" | "format";
  results: SearchResult[];
  selected?: SearchResult;
  meta?: PlayMeta;
  /** Extra line shown in the format prompt (e.g. "matched from YouTube"). */
  note?: string;
  createdAt: number;
}

const URL_PATTERN = /^https?:\/\/\S+$/i;

export function sessionKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

export function isPlayUrl(input: string): boolean {
  return URL_PATTERN.test(input.trim());
}

export function formatTime(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function entryUrl(entry: Record<string, unknown>, id: string | undefined): string | undefined {
  const candidates = [entry.webpage_url, entry.url, entry.original_url];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return id ? `https://www.youtube.com/watch?v=${id}` : undefined;
}

export function parseSearchEntries(raw: unknown, count: number = SEARCH_COUNT): SearchResult[] {
  const root = asRecord(raw);
  if (!root || !Array.isArray(root.entries)) return [];

  const results: SearchResult[] = [];
  for (const item of root.entries) {
    const entry = asRecord(item);
    if (!entry) continue;

    const id = typeof entry.id === "string" ? entry.id : undefined;
    const rawTitle = typeof entry.title === "string" ? entry.title.trim() : "";
    const title = rawTitle || id || "";
    const url = entryUrl(entry, id);
    if (!title || !url) continue;

    const uploader =
      typeof entry.uploader === "string"
        ? entry.uploader
        : typeof entry.channel === "string"
          ? entry.channel
          : undefined;

    results.push({
      index: results.length + 1,
      id: id ?? "",
      title,
      url,
      duration: typeof entry.duration === "number" ? entry.duration : undefined,
      uploader,
    });

    if (results.length >= count) break;
  }

  return results;
}

export function extractPlayMeta(raw: unknown): PlayMeta | null {
  const data = asRecord(raw);
  if (!data) return null;

  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) return null;

  return {
    id: typeof data.id === "string" ? data.id : undefined,
    title,
    uploader:
      typeof data.uploader === "string"
        ? data.uploader
        : typeof data.channel === "string"
          ? data.channel
          : undefined,
    duration: typeof data.duration === "number" ? data.duration : undefined,
    webpageUrl:
      typeof data.webpage_url === "string"
        ? data.webpage_url
        : typeof data.original_url === "string"
          ? data.original_url
          : undefined,
    isLive: data.is_live === true,
  };
}

export function formatSearchList(results: SearchResult[]): string {
  const lines = results.map((result) => {
    const time = formatTime(result.duration);
    const suffix = time ? ` <i>(${time})</i>` : "";
    return `${result.index}. ${escapeHtml(truncate(result.title, 64))}${suffix}`;
  });
  return ["🔎 <b>Search results</b>", ...lines].join("\n");
}

export function buildPlayCaption(meta: PlayMeta, kind: PlayKind): string {
  const icon = kind === "audio" ? "🎵" : "🎬";
  const lines = [`${icon} <b>${escapeHtml(meta.title)}</b>`];
  if (meta.uploader) lines.push(`👤 ${escapeHtml(meta.uploader)}`);
  const time = formatTime(meta.duration);
  if (time) lines.push(`⏱ ${time}`);
  if (meta.webpageUrl) lines.push("", `🔗 <a href="${escapeHtml(meta.webpageUrl)}">Source</a>`);
  return lines.join("\n");
}

export class PlaySessionStore {
  private readonly sessions = new Map<string, PlaySession>();

  constructor(
    private readonly ttlMs: number = SESSION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: Omit<PlaySession, "createdAt"> & { createdAt?: number }): PlaySession {
    const session: PlaySession = { ...input, createdAt: input.createdAt ?? this.now() };
    this.sessions.set(sessionKey(session.chatId, session.userId), session);
    return session;
  }

  get(chatId: number, userId: number): PlaySession | undefined {
    const key = sessionKey(chatId, userId);
    const session = this.sessions.get(key);
    if (!session) return undefined;
    if (this.now() - session.createdAt > this.ttlMs) {
      this.sessions.delete(key);
      return undefined;
    }
    return session;
  }

  delete(chatId: number, userId: number): void {
    this.sessions.delete(sessionKey(chatId, userId));
  }

  clear(): void {
    this.sessions.clear();
  }

  size(): number {
    return this.sessions.size;
  }
}
