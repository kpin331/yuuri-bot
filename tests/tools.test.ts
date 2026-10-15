import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { galleryDlCookieArgs, impersonateArgs, ytDlpCookieArgs } from "../src/lib/tools.js";

describe("impersonateArgs", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.YTDLP_IMPERSONATE;
    delete process.env.YTDLP_IMPERSONATE;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.YTDLP_IMPERSONATE;
    else process.env.YTDLP_IMPERSONATE = previous;
  });

  it("returns the yt-dlp flag with the default target", () => {
    assert.deepEqual(impersonateArgs(), ["--impersonate", "chrome"]);
  });

  it("uses a configured target", () => {
    process.env.YTDLP_IMPERSONATE = "firefox";
    assert.deepEqual(impersonateArgs(), ["--impersonate", "firefox"]);
  });

  it("returns no args when disabled", () => {
    process.env.YTDLP_IMPERSONATE = "none";
    assert.deepEqual(impersonateArgs(), []);
  });
});

describe("cookie args", () => {
  let yt: string | undefined;
  let gallery: string | undefined;

  beforeEach(() => {
    yt = process.env.YTDLP_COOKIES;
    gallery = process.env.GALLERYDL_COOKIES;
    delete process.env.YTDLP_COOKIES;
    delete process.env.GALLERYDL_COOKIES;
  });

  afterEach(() => {
    if (yt === undefined) delete process.env.YTDLP_COOKIES;
    else process.env.YTDLP_COOKIES = yt;
    if (gallery === undefined) delete process.env.GALLERYDL_COOKIES;
    else process.env.GALLERYDL_COOKIES = gallery;
  });

  it("returns no args when unset", () => {
    assert.deepEqual(ytDlpCookieArgs(), []);
    assert.deepEqual(galleryDlCookieArgs(), []);
  });

  it("passes the configured file for each tool", () => {
    process.env.YTDLP_COOKIES = "D:\\downloads\\cookies.txt";
    process.env.GALLERYDL_COOKIES = "D:\\downloads\\cookies.txt";
    assert.deepEqual(ytDlpCookieArgs(), ["--cookies", "D:\\downloads\\cookies.txt"]);
    assert.deepEqual(galleryDlCookieArgs(), ["--cookies", "D:\\downloads\\cookies.txt"]);
  });

  it("treats a blank value as unset", () => {
    process.env.YTDLP_COOKIES = "   ";
    assert.deepEqual(ytDlpCookieArgs(), []);
  });
});
