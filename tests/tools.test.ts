import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { impersonateArgs } from "../src/lib/tools.js";

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
