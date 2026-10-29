import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { registerCommands } from "../src/handlers/commands.js";
import { registerPinterest } from "../src/handlers/pinterest.js";
import { createTestBot } from "./helpers.js";
import { closeDatabase, initDatabase, setCommandState } from "../src/lib/db.js";

describe("Telegram Jarvis trigger", () => {
  it("handles only a whole trimmed jarvis message and leaves command arguments alone", async () => {
    const t = createTestBot();
    closeDatabase();
    initDatabase(":memory:");
    setCommandState("pin", false, null);
    registerCommands(t.bot);
    registerPinterest(t.bot);
    let downstream = 0;
    t.bot.on("message", async (_ctx, next) => { downstream += 1; await next(); });
    try {
      await t.bot.handleUpdate(t.textUpdate("  JARVIS  ", { hasCommand: false }));
      assert.ok(t.replies().includes("siap,pak"));
      await t.bot.handleUpdate(t.textUpdate("Please say jarvis", { hasCommand: false }));
      await t.bot.handleUpdate(t.textUpdate("/pin jarvis"));
      assert.equal(t.replies().filter((line) => line === "siap,pak").length, 1);
      assert.ok(t.replies().some((line) => line.includes("Perintah ini sedang dinonaktifkan")));
      assert.ok(downstream >= 1);
    } finally { closeDatabase(); }
  });
});
