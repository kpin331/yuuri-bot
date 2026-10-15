import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  durationLimitError,
  parsePlayLink,
  PLAYLIST_MESSAGE,
  UNSUPPORTED_MESSAGE,
} from "../src/lib/playlink.js";

describe("parsePlayLink", () => {
  it("treats plain text as a search query", () => {
    assert.deepEqual(parsePlayLink("never gonna give you up"), { type: "search" });
    assert.deepEqual(parsePlayLink("  "), { type: "search" });
    assert.deepEqual(parsePlayLink("just some words"), { type: "search" });
  });

  it("normalizes YouTube watch/youtu.be/shorts/embed/live links", () => {
    assert.deepEqual(parsePlayLink("https://www.youtube.com/watch?v=abc123"), {
      type: "link",
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abc123",
    });
    assert.deepEqual(parsePlayLink("https://youtu.be/abc123"), {
      type: "link",
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abc123",
    });
    assert.deepEqual(parsePlayLink("https://www.youtube.com/shorts/abc123"), {
      type: "link",
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abc123",
    });
    assert.deepEqual(parsePlayLink("https://www.youtube.com/embed/abc123"), {
      type: "link",
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abc123",
    });
    assert.deepEqual(parsePlayLink("https://www.youtube.com/live/abc123"), {
      type: "link",
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abc123",
    });
  });

  it("keeps the single video when a YouTube link has both v and list", () => {
    assert.deepEqual(parsePlayLink("https://www.youtube.com/watch?v=abc123&list=PL123"), {
      type: "link",
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abc123",
    });
  });

  it("treats a YouTube link without v but with list as a playlist", () => {
    assert.deepEqual(parsePlayLink("https://www.youtube.com/playlist?list=PL123"), {
      type: "error",
      message: PLAYLIST_MESSAGE,
    });
    assert.deepEqual(parsePlayLink("https://www.youtube.com/watch?list=PL123"), {
      type: "error",
      message: PLAYLIST_MESSAGE,
    });
  });

  it("accepts YouTube Music links and normalizes to youtube.com", () => {
    assert.deepEqual(parsePlayLink("https://music.youtube.com/watch?v=abc123"), {
      type: "link",
      source: "youtube-music",
      url: "https://www.youtube.com/watch?v=abc123",
    });
    assert.deepEqual(parsePlayLink("https://music.youtube.com/playlist?list=PL123"), {
      type: "error",
      message: PLAYLIST_MESSAGE,
    });
  });

  it("accepts SoundCloud tracks and short links, rejects sets and profiles", () => {
    assert.deepEqual(parsePlayLink("https://soundcloud.com/artist/track"), {
      type: "link",
      source: "soundcloud",
      url: "https://soundcloud.com/artist/track",
    });
    assert.deepEqual(parsePlayLink("https://on.soundcloud.com/xyz"), {
      type: "link",
      source: "soundcloud",
      url: "https://on.soundcloud.com/xyz",
    });
    assert.deepEqual(parsePlayLink("https://soundcloud.com/artist/sets/mix"), {
      type: "error",
      message: PLAYLIST_MESSAGE,
    });
    assert.deepEqual(parsePlayLink("https://soundcloud.com/artist"), {
      type: "error",
      message: UNSUPPORTED_MESSAGE,
    });
  });

  it("accepts Spotify tracks and rejects albums/playlists", () => {
    assert.deepEqual(parsePlayLink("https://open.spotify.com/track/abc123"), {
      type: "link",
      source: "spotify",
      url: "https://open.spotify.com/track/abc123",
    });
    assert.deepEqual(parsePlayLink("https://open.spotify.com/album/abc123"), {
      type: "error",
      message: PLAYLIST_MESSAGE,
    });
    assert.deepEqual(parsePlayLink("https://open.spotify.com/playlist/abc123"), {
      type: "error",
      message: PLAYLIST_MESSAGE,
    });
  });

  it("rejects unsupported domains", () => {
    assert.deepEqual(parsePlayLink("https://example.com/video"), {
      type: "error",
      message: UNSUPPORTED_MESSAGE,
    });
    assert.deepEqual(parsePlayLink("https://vimeo.com/12345"), {
      type: "error",
      message: UNSUPPORTED_MESSAGE,
    });
  });
});

describe("durationLimitError", () => {
  it("returns null when under the limit or unknown", () => {
    assert.equal(durationLimitError({ title: "x", duration: 600 }, 10), null);
    assert.equal(durationLimitError({ title: "x", duration: 300 }, 10), null);
    assert.equal(durationLimitError({ title: "x" }, 10), null);
  });

  it("returns a message when over the limit", () => {
    const message = durationLimitError({ title: "x", duration: 900 }, 10);
    assert.ok(message && message.includes("15 minutes"));
    assert.ok(message.includes("10-minute"));
  });

  it("ignores the check when the limit is disabled", () => {
    assert.equal(durationLimitError({ title: "x", duration: 99999 }, 0), null);
  });
});
