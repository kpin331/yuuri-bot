import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml, formatInfo } from "../src/lib/info.js";

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
