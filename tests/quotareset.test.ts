import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { registerQuotaReset } from "../src/handlers/quotareset.js";
import { resetRateLimits } from "../src/core/access.js";
import { closeDatabase, getQuotaRow, initDatabase, setQuotaRow } from "../src/lib/db.js";
import { createTestBot } from "./helpers.js";

const ENV_KEYS = ["OWNER_ID", "DEFAULT_QUOTA", "ADMIN_QUOTA", "TIMEZONE"] as const;

let saved: Record<string, string | undefined> = {};

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("/quota-reset", () => {
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];

    process.env.OWNER_ID = "222";
    process.env.DEFAULT_QUOTA = "25";
    process.env.TIMEZONE = "UTC";

    resetRateLimits();
    closeDatabase();
    initDatabase(":memory:");
  });

  afterEach(() => {
    for (const key of ENV_KEYS) setEnv(key, saved[key]);
    closeDatabase();
    resetRateLimits();
  });

  it("resets every user's quota and reports the restored amount", async () => {
    setQuotaRow({
      platform: "whatsapp",
      userId: "628111",
      quotaLeft: 0,
      lastReset: "2026-01-01",
      displayName: "Raka",
      at: Date.now(),
    });
    setQuotaRow({
      platform: "whatsapp",
      userId: "628222",
      quotaLeft: 20,
      lastReset: "2026-01-01",
      displayName: null,
      at: Date.now(),
    });

    const t = createTestBot();
    registerQuotaReset(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/quota-reset", { fromId: 222 }));

    const reply = t.replies().join("\n");
    assert.ok(reply.includes("Quota reset"), reply);
    assert.ok(reply.includes("Raka"), reply);
    assert.ok(reply.includes("+25"), reply);
    assert.ok(reply.includes("+5"), reply);

    assert.equal(getQuotaRow("whatsapp", "628111")?.quotaLeft, 25);
    assert.equal(getQuotaRow("whatsapp", "628222")?.quotaLeft, 25);
  });

  it("refuses anyone who is not the owner", async () => {
    const t = createTestBot();
    registerQuotaReset(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/quota-reset", { fromId: 999 }));

    assert.ok(t.replies().some((reply) => reply.includes("owner-only")));
  });
});
