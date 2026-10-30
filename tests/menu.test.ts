import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMenu, registerCommands } from "../src/handlers/commands.js";
import { createTestBot } from "./helpers.js";

describe("Telegram menu photo", () => {
  it("answers Jarvis case-insensitively and sends the menu", async () => {
    const t = createTestBot();
    registerCommands(t.bot);

    await t.bot.handleUpdate(t.textUpdate("JARVIS"));

    assert.equal(t.replies()[0], "siap,pak");
    assert.ok(t.replies().some((reply) => reply.includes("Daftar perintah yang tersedia")));
    const menu = buildMenu();
    assert.ok(menu.includes("POWERSHELL:"));
    assert.ok(menu.includes("$purge"));
    assert.ok(menu.includes("/tukar [jumlah Point 1-50]"));
    assert.ok(menu.includes("/bank [deposit|tarik jumlah]"));
    assert.ok(menu.includes("/quota — Lihat, beli kuota, atau upgrade batas harian"));
    assert.ok(menu.includes("<b>&lt;Umum&gt;</b>"));
    assert.ok(menu.includes("================"));
    assert.ok(menu.split("\n").filter((line) => /^- (\/|!|\$|POWERSHELL:)/.test(line)).length > 0);
  });

  it("sends a long menu as text after the profile photo", async () => {
    const t = createTestBot({
      getUserProfilePhotos: {
        total_count: 1,
        photos: [[{ file_id: "profile-photo" }]],
      },
    });
    registerCommands(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/menu"));

    const photo = t.calls.find((call) => call.method === "sendPhoto");
    assert.ok(photo, "expected the profile photo to be sent");
    assert.equal(photo.body.caption, undefined);
    assert.ok(t.replies().some((reply) => reply.includes("Daftar perintah yang tersedia")));
    assert.ok(buildMenu().length > 900);
  });
});
