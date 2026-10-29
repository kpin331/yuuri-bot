import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml, formatInfo, formatPinterestInfo, parseInfo } from "../src/lib/info.js";

describe("escapeHtml", () => {
  it("escapes every character Telegram's HTML mode needs, quotes included", () => {
    assert.equal(
      escapeHtml(`<a href="x"> & 'y'`),
      "&lt;a href=&quot;x&quot;&gt; &amp; &#39;y&#39;",
    );
  });

  it("escapes ampersands first so entities are not double-decoded", () => {
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });
});

describe("formatInfo", () => {
  it("keeps a quote in the source URL from breaking out of the href attribute", () => {
    const out = formatInfo({ title: "T", source: 'https://example.com/x"><b>hi</b>' });
    assert.ok(out);
    assert.ok(out.includes('href="https://example.com/x&quot;&gt;&lt;b&gt;hi&lt;/b&gt;"'));
    assert.ok(!out.includes('"><b>'));
  });
});

describe("Pinterest info", () => {
  it("parses comment totals and formats the requested fields safely", () => {
    const info = parseInfo({
      title: "A <title>",
      pinner: { full_name: "Artist" },
      like_count: 12,
      view_count: 345,
      comment_count: 6,
      id: "123",
    });
    const caption = formatPinterestInfo(info);
    assert.equal(info.comments, 6);
    assert.match(caption, /Judul:.*A &lt;title&gt;/);
    assert.match(caption, /Artis:.*Artist/);
    assert.match(caption, /Like:.*12/);
    assert.match(caption, /View:.*345/);
    assert.match(caption, /Komentar:.*6/);
    assert.match(caption, /pinterest\.com\/pin\/123/);
  });
});
