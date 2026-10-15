import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeWhatsApp, htmlToWhatsApp } from "../src/lib/text.js";

describe("whatsapp text conversion", () => {
  it("converts the shared HTML into WhatsApp markup", () => {
    const html =
      "<b>Title</b>\n<i>sub</i>\n<code>code</code>\n" +
      '<a href="https://x.test/">link</a><br>next';
    assert.equal(
      htmlToWhatsApp(html),
      "*Title*\n_sub_\n```code```\nlink (https://x.test/)\nnext",
    );
  });

  it("unescapes entities after stripping tags", () => {
    assert.equal(htmlToWhatsApp("&lt;b&gt; &amp; &lt;i&gt;"), "<b> & <i>");
  });

  it("escapes WhatsApp control characters", () => {
    const escaped = escapeWhatsApp("*bold* _it_ `c`");
    assert.ok(!escaped.includes("*bold*"));
    assert.ok(escaped.includes("\u200b"));
  });
});
