import type { PlayMeta, SearchResult } from "../../lib/play.js";

// WhatsApp has no inline keyboards, so ".play" is driven by plain replies:
// the user is shown a numbered list, then replies with a number, then picks
// audio or video. This keeps one in-progress selection per chat+user.
export interface WaPlaySession {
  key: string;
  chatId: string;
  userId: string;
  stage: "choose" | "format";
  results: SearchResult[];
  selected?: SearchResult;
  meta?: PlayMeta;
  /** Extra line shown in the format prompt (e.g. "matched from YouTube"). */
  note?: string;
  createdAt: number;
}

export class WaPlaySessionStore {
  private readonly sessions = new Map<string, WaPlaySession>();

  constructor(
    private readonly ttlMs: number = 2 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  private key(chatId: string, userId: string): string {
    return `${chatId}:${userId}`;
  }

  create(
    input: Omit<WaPlaySession, "key" | "createdAt"> & { createdAt?: number },
  ): WaPlaySession {
    const key = this.key(input.chatId, input.userId);
    const session: WaPlaySession = { ...input, key, createdAt: input.createdAt ?? this.now() };
    this.sessions.set(key, session);
    return session;
  }

  get(chatId: string, userId: string): WaPlaySession | undefined {
    const key = this.key(chatId, userId);
    const session = this.sessions.get(key);
    if (!session) return undefined;
    if (this.now() - session.createdAt > this.ttlMs) {
      this.sessions.delete(key);
      return undefined;
    }
    return session;
  }

  delete(chatId: string, userId: string): void {
    this.sessions.delete(this.key(chatId, userId));
  }

  clear(): void {
    this.sessions.clear();
  }

  size(): number {
    return this.sessions.size;
  }
}
