import { createHash } from "node:crypto";

const CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT";
const CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj";
const HASH_SECRET =
  "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c";
const USER_AGENT = "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)";
const AUTH_URL = "https://oauth.secure.pixiv.net/auth/token";
const API_BASE = "https://app-api.pixiv.net";

const IMAGE_REFERER = "https://www.pixiv.net/";
const AUTH_TIMEOUT_MS = 30_000;
const API_TIMEOUT_MS = 45_000;

export interface PixivIllust {
  id: number;
  title: string;
  author: string;
  imageUrl: string;
  pageUrl: string;
  tags: string[];
  createDate?: string;
}

interface TokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let tokenState: TokenState | null = null;

const API_HEADERS: Record<string, string> = {
  "App-OS": "android",
  "App-OS-Version": "11",
  "App-Version": "5.0.234",
  "User-Agent": USER_AGENT,
  "Accept-Language": "en_US",
};

function clientTime(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

async function refreshAccessToken(refreshToken: string): Promise<TokenState> {
  const time = clientTime();
  const hash = createHash("md5").update(time + HASH_SECRET).digest("hex");

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "X-Client-Time": time,
      "X-Client-Hash": hash,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept-Language": "en_US",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      include_policy: "true",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Pixiv auth failed (HTTP ${res.status})`);

  const data = (await res.json()) as {
    response?: { access_token?: string; refresh_token?: string; expires_in?: number };
  };
  const response = data.response;
  if (!response?.access_token) throw new Error("Pixiv auth returned no access token");

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? refreshToken,
    expiresAt: Date.now() + ((response.expires_in ?? 3600) - 60) * 1000,
  };
}

async function getAccessToken(refreshToken: string): Promise<string> {
  if (tokenState && Date.now() < tokenState.expiresAt) return tokenState.accessToken;
  tokenState = await refreshAccessToken(tokenState?.refreshToken ?? refreshToken);
  return tokenState.accessToken;
}

export async function searchIllust(
  refreshToken: string,
  word: string,
): Promise<PixivIllust | null> {
  const accessToken = await getAccessToken(refreshToken);

  const url = new URL(`${API_BASE}/v1/search/illust`);
  url.searchParams.set("word", word);
  url.searchParams.set("search_target", "partial_match_for_tags");
  url.searchParams.set("sort", "date_desc");
  url.searchParams.set("filter", "for_android");
  url.searchParams.set("include_translated_tags", "true");

  const res = await fetch(url, {
    headers: { ...API_HEADERS, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Pixiv search failed (HTTP ${res.status})`);

  const data = (await res.json()) as {
    illusts?: Array<{
      id?: number;
      title?: string;
      create_date?: string;
      user?: { name?: string };
      tags?: Array<{ name?: string }>;
      image_urls?: { large?: string; medium?: string; square_medium?: string; original?: string };
    }>;
  };

  const illust = data.illusts?.[0];
  if (!illust?.id) return null;

  const imageUrl =
    illust.image_urls?.large ??
    illust.image_urls?.medium ??
    illust.image_urls?.square_medium ??
    illust.image_urls?.original;
  if (!imageUrl) return null;

  return {
    id: illust.id,
    title: illust.title?.trim() || "Untitled",
    author: illust.user?.name?.trim() || "Unknown",
    imageUrl,
    pageUrl: `https://www.pixiv.net/artworks/${illust.id}`,
    tags: (illust.tags ?? []).map((t) => t.name?.trim()).filter((n): n is string => !!n),
    createDate: illust.create_date,
  };
}

export async function downloadIllust(imageUrl: string): Promise<Buffer> {
  const res = await fetch(imageUrl, {
    headers: { Referer: IMAGE_REFERER, "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Pixiv image download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
