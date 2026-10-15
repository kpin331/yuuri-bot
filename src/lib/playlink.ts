import {
  getMaxDurationMinutes,
  getSpotifyClientId,
  getSpotifyClientSecret,
} from "./config.js";
import type { PlayMeta } from "./play.js";
import { probeMeta, searchYouTube } from "./youtube.js";

// Link handling for /play (.play). Plain text is treated as a search query;
// supported links are turned into something the downloader (yt-dlp) understands.
// Spotify cannot be downloaded, so its track is looked up and matched to a
// YouTube search instead.

export type PlaySource = "youtube" | "youtube-music" | "soundcloud" | "spotify";

export const PLAYLIST_MESSAGE = "Playlists not supported yet, send a single track link.";
export const UNSUPPORTED_MESSAGE =
  "Only YouTube, YouTube Music, SoundCloud and Spotify track links are supported.";
export const UNREADABLE_MESSAGE =
  "Could not read that link. It may be private, region-locked, or unavailable.";

export type PlayLinkParse =
  | { type: "search" }
  | { type: "link"; source: PlaySource; url: string }
  | { type: "error"; message: string };

const URL_ONLY = /^https?:\/\/\S+$/i;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (compatible; YuuriBot/1.0)";

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./i, "").toLowerCase();
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter((part) => part.length > 0);
}

function youtubeWatch(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

// --- YouTube / YouTube Music ---

function parseNamedVideoVideo(url: URL): PlayLinkParse {
  const segments = pathSegments(url);
  const first = (segments[0] ?? "").toLowerCase();

  if (first === "playlist") return { type: "error", message: PLAYLIST_MESSAGE };

  if (first === "watch") {
    const v = url.searchParams.get("v");
    // A link with both "v" and "list" is a single video inside a playlist: keep
    // only the video.
    if (v) return { type: "link", source: "youtube", url: youtubeWatch(v) };
    if (url.searchParams.has("list")) return { type: "error", message: PLAYLIST_MESSAGE };
    return { type: "error", message: UNSUPPORTED_MESSAGE };
  }

  if (first === "shorts" || first === "embed" || first === "live") {
    const id = segments[1];
    if (id) return { type: "link", source: "youtube", url: youtubeWatch(id) };
    return { type: "error", message: UNSUPPORTED_MESSAGE };
  }

  return { type: "error", message: UNSUPPORTED_MESSAGE };
}

function parseYouTube(url: URL): PlayLinkParse {
  if (hostOf(url) === "youtu.be") {
    const id = pathSegments(url)[0];
    if (id) return { type: "link", source: "youtube", url: youtubeWatch(id) };
    return { type: "error", message: UNSUPPORTED_MESSAGE };
  }
  return parseNamedVideoVideo(url);
}

function parseYouTubeMusic(url: URL): PlayLinkParse {
  const segments = pathSegments(url);
  const first = (segments[0] ?? "").toLowerCase();

  if (first === "playlist") return { type: "error", message: PLAYLIST_MESSAGE };

  if (first === "watch") {
    const v = url.searchParams.get("v");
    if (v) return { type: "link", source: "youtube-music", url: youtubeWatch(v) };
    if (url.searchParams.has("list")) return { type: "error", message: PLAYLIST_MESSAGE };
    return { type: "error", message: UNSUPPORTED_MESSAGE };
  }

  if (first === "shorts") {
    const id = segments[1];
    if (id) return { type: "link", source: "youtube-music", url: youtubeWatch(id) };
  }

  return { type: "error", message: UNSUPPORTED_MESSAGE };
}

// --- SoundCloud ---

function parseSoundCloud(url: URL): PlayLinkParse {
  const segments = pathSegments(url).map((part) => part.toLowerCase());
  if (segments.includes("sets")) return { type: "error", message: PLAYLIST_MESSAGE };

  // Short links (on.soundcloud.com/xxxx) carry no artist/track structure, so we
  // accept them and resolve the redirect later.
  if (hostOf(url) === "on.soundcloud.com") {
    return { type: "link", source: "soundcloud", url: url.toString() };
  }

  // soundcloud.com/<artist>/<track> needs at least two path segments.
  if (segments.length < 2) return { type: "error", message: UNSUPPORTED_MESSAGE };
  return { type: "link", source: "soundcloud", url: url.toString() };
}

// --- Spotify ---

function spotifyTrackId(url: URL): string | null {
  const segments = pathSegments(url);
  const index = segments.findIndex((part) => part.toLowerCase() === "track");
  if (index === -1) return null;
  return segments[index + 1] ?? null;
}

function parseSpotify(url: URL): PlayLinkParse {
  const segments = pathSegments(url).map((part) => part.toLowerCase());
  if (segments.includes("playlist") || segments.includes("album")) {
    return { type: "error", message: PLAYLIST_MESSAGE };
  }
  if (!spotifyTrackId(url)) return { type: "error", message: UNSUPPORTED_MESSAGE };
  return { type: "link", source: "spotify", url: url.toString() };
}

// Reads the platform from the link's domain. Non-URLs become searches; unknown
// domains and playlists/albums are rejected before any network call.
export function parsePlayLink(input: string): PlayLinkParse {
  const trimmed = input.trim();
  if (!URL_ONLY.test(trimmed)) return { type: "search" };

  const url = parseUrl(trimmed);
  if (!url) return { type: "error", message: UNSUPPORTED_MESSAGE };

  const host = hostOf(url);
  if (host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com") {
    return parseYouTube(url);
  }
  if (host === "music.youtube.com") return parseYouTubeMusic(url);
  if (host === "soundcloud.com" || host === "m.soundcloud.com" || host === "on.soundcloud.com") {
    return parseSoundCloud(url);
  }
  if (host === "open.spotify.com") return parseSpotify(url);
  return { type: "error", message: UNSUPPORTED_MESSAGE };
}

// --- Duration limit ---

export function durationLimitError(meta: PlayMeta, maxMinutes: number): string | null {
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) return null;
  const { duration } = meta;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return null;
  if (duration <= maxMinutes * 60) return null;
  return `That track is about ${Math.round(duration / 60)} minutes long, over the ${maxMinutes}-minute limit.`;
}

// --- Resolution ---

export interface PlayResolved {
  source: PlaySource;
  url: string;
  meta: PlayMeta;
  matchedFromYouTube: boolean;
  matchedQuery?: string;
}

export type PlayResolve =
  | { type: "search"; query: string }
  | { type: "media"; value: PlayResolved }
  | { type: "error"; message: string };

interface SpotifyTrack {
  title: string;
  artist?: string;
}

let spotifyToken: { value: string; expiresAt: number } | null = null;

async function getSpotifyToken(clientId: string, clientSecret: string): Promise<string | null> {
  if (spotifyToken && Date.now() < spotifyToken.expiresAt) return spotifyToken.value;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;

    spotifyToken = {
      value: data.access_token,
      expiresAt: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000,
    };
    return spotifyToken.value;
  } catch {
    return null;
  }
}

async function fetchSpotifyTrackApi(trackId: string): Promise<SpotifyTrack | null> {
  const clientId = getSpotifyClientId();
  const clientSecret = getSpotifyClientSecret();
  if (!clientId || !clientSecret) return null;

  const token = await getSpotifyToken(clientId, clientSecret);
  if (!token) return null;

  try {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { name?: string; artists?: Array<{ name?: string }> };
    const title = data.name?.trim();
    if (!title) return null;
    return { title, artist: data.artists?.[0]?.name?.trim() || undefined };
  } catch {
    return null;
  }
}

async function fetchSpotifyOEmbed(url: string): Promise<SpotifyTrack | null> {
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;

    const data = (await res.json()) as { title?: string };
    const title = data.title?.trim();
    if (!title) return null;
    // oEmbed only exposes the track title, not the artist.
    return { title };
  } catch {
    return null;
  }
}

// Prefers the Web API (title + artist) and falls back to oEmbed (title only).
async function fetchSpotifyTrack(trackId: string, url: string): Promise<SpotifyTrack | null> {
  const viaApi = await fetchSpotifyTrackApi(trackId);
  if (viaApi) return viaApi;
  return fetchSpotifyOEmbed(url);
}

async function resolveSpotify(url: string): Promise<PlayResolve> {
  const trackId = spotifyTrackId(new URL(url));
  if (!trackId) return { type: "error", message: UNSUPPORTED_MESSAGE };

  const track = await fetchSpotifyTrack(trackId, url);
  if (!track) {
    return { type: "error", message: "Could not read that Spotify link. Try again or send a YouTube link." };
  }

  const query = track.artist ? `${track.artist} - ${track.title}` : track.title;
  const results = await searchYouTube(query);
  if (results.length === 0) {
    return { type: "error", message: `No YouTube match found for "${query}".` };
  }

  const best = results[0]!;
  const probed = await probeMeta(best.url);
  const meta: PlayMeta = probed ?? {
    id: best.id,
    title: best.title,
    uploader: best.uploader,
    duration: best.duration,
    webpageUrl: best.url,
  };

  const tooLong = durationLimitError(meta, getMaxDurationMinutes());
  if (tooLong) return { type: "error", message: tooLong };

  return {
    type: "media",
    value: { source: "spotify", url: best.url, meta, matchedFromYouTube: true, matchedQuery: query },
  };
}

// Follows an on.soundcloud.com redirect so a set behind a short link is still
// detected. Best-effort: on failure the original short link is used.
async function resolveSoundCloudRedirect(url: string): Promise<string> {
  try {
    if (hostOf(new URL(url)) !== "on.soundcloud.com") return url;
  } catch {
    return url;
  }

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.url && res.url !== url ? res.url : url;
  } catch {
    return url;
  }
}

// The single entry point both platforms use: turns any /play input into either a
// search query or downloadable media with resolved metadata.
export async function resolvePlayInput(input: string): Promise<PlayResolve> {
  const parsed = parsePlayLink(input);
  if (parsed.type === "search") return { type: "search", query: input.trim() };
  if (parsed.type === "error") return { type: "error", message: parsed.message };

  if (parsed.source === "spotify") return resolveSpotify(parsed.url);

  let target: { source: PlaySource; url: string } = { source: parsed.source, url: parsed.url };
  if (parsed.source === "soundcloud") {
    const finalUrl = await resolveSoundCloudRedirect(parsed.url);
    if (finalUrl !== parsed.url) {
      const recheck = parsePlayLink(finalUrl);
      if (recheck.type === "error") return { type: "error", message: recheck.message };
      if (recheck.type === "link") target = { source: recheck.source, url: recheck.url };
    }
  }

  const meta = await probeMeta(target.url);
  if (!meta) return { type: "error", message: UNREADABLE_MESSAGE };

  const tooLong = durationLimitError(meta, getMaxDurationMinutes());
  if (tooLong) return { type: "error", message: tooLong };

  return {
    type: "media",
    value: { source: target.source, url: target.url, meta, matchedFromYouTube: false },
  };
}
