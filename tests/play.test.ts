import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPlayCaption,
  extractPlayMeta,
  formatSearchList,
  formatTime,
  isPlayUrl,
  parseSearchEntries,
  PlaySessionStore,
  SEARCH_COUNT,
  type PlaySession,
} from "../src/lib/play.js";

function sampleSession(overrides: Partial<PlaySession> = {}): Omit<PlaySession, "createdAt"> {
  return {
    chatId: 1,
    userId: 2,
    messageId: 10,
    query: "test",
    stage: "choose",
    results: [],
    ...overrides,
  };
}

describe("isPlayUrl", () => {
  it("accepts http(s) URLs", () => {
    assert.equal(isPlayUrl("https://www.youtube.com/watch?v=abc"), true);
    assert.equal(isPlayUrl("http://example.com/a"), true);
  });

  it("rejects plain search text", () => {
    assert.equal(isPlayUrl("never gonna give you up"), false);
    assert.equal(isPlayUrl("  "), false);
  });
});

describe("formatTime", () => {
  it("formats seconds into m:ss and h:mm:ss", () => {
    assert.equal(formatTime(0), "0:00");
    assert.equal(formatTime(65), "1:05");
    assert.equal(formatTime(3600), "1:00:00");
    assert.equal(formatTime(3661), "1:01:01");
  });

  it("returns undefined for missing/invalid values", () => {
    assert.equal(formatTime(undefined), undefined);
    assert.equal(formatTime(Number.NaN), undefined);
    assert.equal(formatTime(-5), undefined);
  });
});

describe("parseSearchEntries", () => {
  const raw = {
    entries: [
      { id: "v1", title: "First", duration: 125, uploader: "Chan", url: "https://x/1" },
      { id: "v2", title: "Second", duration: 3000, webpage_url: "https://x/2" },
      { id: "v3", title: "Third" },
      { id: "v4" },
      { title: "No id and no url" },
    ],
  };

  it("normalizes entries into indexed results", () => {
    const results = parseSearchEntries(raw);
    assert.equal(results.length, 4);

    assert.equal(results[0]?.index, 1);
    assert.equal(results[0]?.id, "v1");
    assert.equal(results[0]?.title, "First");
    assert.equal(results[0]?.url, "https://x/1");

    assert.equal(results[1]?.index, 2);
    assert.equal(results[1]?.url, "https://x/2");

    assert.equal(results[2]?.index, 3);
    assert.equal(results[2]?.url, "https://www.youtube.com/watch?v=v3");

    // A bare id with no title falls back to the id as the title.
    assert.equal(results[3]?.index, 4);
    assert.equal(results[3]?.title, "v4");
    assert.equal(results[3]?.url, "https://www.youtube.com/watch?v=v4");
  });

  it("caps results at the requested count", () => {
    const many = {
      entries: Array.from({ length: SEARCH_COUNT + 5 }, (_, i) => ({ id: `v${i}`, title: `T${i}` })),
    };
    const results = parseSearchEntries(many, SEARCH_COUNT);
    assert.equal(results.length, SEARCH_COUNT);
    assert.equal(results[9]?.index, 10);
  });

  it("returns [] for malformed input", () => {
    assert.deepEqual(parseSearchEntries(null), []);
    assert.deepEqual(parseSearchEntries({}), []);
    assert.deepEqual(parseSearchEntries({ entries: "nope" }), []);
  });
});

describe("extractPlayMeta", () => {
  it("extracts title, uploader, duration and source", () => {
    const meta = extractPlayMeta({
      id: "abc",
      title: "My Video",
      uploader: "Chan",
      duration: 42,
      webpage_url: "https://x/abc",
    });
    assert.deepEqual(meta, {
      id: "abc",
      title: "My Video",
      uploader: "Chan",
      duration: 42,
      webpageUrl: "https://x/abc",
      isLive: false,
    });
  });

  it("returns null when there is no title", () => {
    assert.equal(extractPlayMeta({ uploader: "Chan" }), null);
    assert.equal(extractPlayMeta(null), null);
  });
});

describe("formatSearchList", () => {
  it("numbers results and includes durations, escaping HTML", () => {
    const text = formatSearchList([
      { index: 1, id: "v1", title: "A & B <clip>", url: "https://x/1", duration: 65 },
      { index: 2, id: "v2", title: "Second", url: "https://x/2" },
    ]);
    assert.ok(text.includes("1. A &amp; B &lt;clip&gt; <i>(1:05)</i>"));
    assert.ok(text.includes("2. Second"));
  });
});

describe("buildPlayCaption", () => {
  it("builds an audio caption", () => {
    const caption = buildPlayCaption(
      { title: "Song & Dance", uploader: "Chan", duration: 200, webpageUrl: "https://x/s" },
      "audio",
    );
    assert.ok(caption.includes("🎵"));
    assert.ok(caption.includes("Song &amp; Dance"));
    assert.ok(caption.includes("Chan"));
    assert.ok(caption.includes("3:20"));
    assert.ok(caption.includes('href="https://x/s"'));
  });

  it("builds a video caption", () => {
    const caption = buildPlayCaption({ title: "Clip" }, "video");
    assert.ok(caption.includes("🎬"));
    assert.ok(caption.includes("Clip"));
  });
});

describe("PlaySessionStore", () => {
  it("isolates sessions per chat+user", () => {
    const store = new PlaySessionStore();
    store.create(sampleSession({ chatId: 1, userId: 2, query: "a" }));
    store.create(sampleSession({ chatId: 1, userId: 3, query: "b" }));

    assert.equal(store.get(1, 2)?.query, "a");
    assert.equal(store.get(1, 3)?.query, "b");
    assert.equal(store.get(9, 9), undefined);
    assert.equal(store.size(), 2);
  });

  it("overwrites a session for the same key", () => {
    const store = new PlaySessionStore();
    store.create(sampleSession({ query: "first" }));
    store.create(sampleSession({ query: "second" }));
    assert.equal(store.get(1, 2)?.query, "second");
    assert.equal(store.size(), 1);
  });

  it("expires sessions after the TTL", () => {
    let now = 0;
    const store = new PlaySessionStore(1000, () => now);
    store.create(sampleSession());

    now = 500;
    assert.notEqual(store.get(1, 2), undefined);

    now = 1001;
    assert.equal(store.get(1, 2), undefined);
  });

  it("deletes sessions on demand", () => {
    const store = new PlaySessionStore();
    store.create(sampleSession());
    store.delete(1, 2);
    assert.equal(store.get(1, 2), undefined);
  });
});
