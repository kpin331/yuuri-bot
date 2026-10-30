import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectPlatform, extractUrl } from "../src/lib/downloader.js";

describe("downloader platform detection", () => {
  it("detects TikTok links for the dedicated downloader command", () => {
    assert.equal(detectPlatform("https://www.tiktok.com/@user/video/123"), "tt");
    assert.equal(detectPlatform("https://vm.tiktok.com/abc/"), "tt");
    assert.equal(extractUrl(".tt https://www.tiktok.com/@user/video/123"), "https://www.tiktok.com/@user/video/123");
  });
});
