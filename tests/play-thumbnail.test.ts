import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchPlayThumbnail } from "../src/lib/play-thumbnail.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("play thumbnail", () => {
  it("loads a supported image and keeps its file extension", async () => {
    globalThis.fetch = (async () => new Response(Buffer.from([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "3" },
    })) as typeof fetch;

    const thumbnail = await fetchPlayThumbnail("https://img.test/video.jpg");
    assert.deepEqual(thumbnail, { data: Buffer.from([1, 2, 3]), fileName: "thumbnail.jpg" });
  });

  it("rejects unsupported schemes and non-image responses", async () => {
    globalThis.fetch = (async () => new Response("not an image", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })) as typeof fetch;

    assert.equal(await fetchPlayThumbnail("file:///etc/passwd"), null);
    assert.equal(await fetchPlayThumbnail("https://img.test/video"), null);
  });
});
