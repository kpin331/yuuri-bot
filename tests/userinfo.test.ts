import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { registerUserinfo } from "../src/handlers/userinfo.js";
import { closeDatabase, initDatabase, recordIncoming } from "../src/lib/db.js";
import { createTestBot } from "./helpers.js";

describe("userinfo", () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    closeDatabase();
  });

  it("falls back to a text report when there is no profile photo", async () => {
    const t = createTestBot({ getUserProfilePhotos: { total_count: 0, photos: [] } });
    registerUserinfo(t.bot);
    recordIncoming({ user: { id: 222, firstName: "User", username: "user" } });

    await t.bot.handleUpdate(t.textUpdate("/userinfo", { fromId: 222 }));

    assert.ok(t.replies().some((r) => r.includes("Activity")));
    assert.equal(
      t.calls.some((call) => call.method === "sendPhoto"),
      false,
    );
  });

  it("sends the profile photo as a header when one is available", async () => {
    const t = createTestBot({
      getUserProfilePhotos: {
        total_count: 1,
        photos: [[{ file_id: "pfp-small" }, { file_id: "pfp-large" }]],
      },
    });
    registerUserinfo(t.bot);
    recordIncoming({ user: { id: 222, firstName: "User", username: "user" } });

    await t.bot.handleUpdate(t.textUpdate("/userinfo", { fromId: 222 }));

    const photoCall = t.calls.find((call) => call.method === "sendPhoto");
    assert.ok(photoCall, "expected a sendPhoto call");
    assert.equal(photoCall?.body.photo, "pfp-large");
    assert.ok(String(photoCall?.body.caption ?? "").includes("Activity"));
  });
});
