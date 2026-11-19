import assert from "node:assert/strict";
import { afterEach, beforeEach, it } from "node:test";
import { closeDatabase, getDb, getQuotaRow, initDatabase, setQuotaRow } from "../src/lib/db.js";
import { addWalletMoney, getWallet, transferBank, transferWallet } from "../src/lib/casino-storage.js";
import { bankMessage, transferMessage, addMoneyMessage } from "../src/lib/economy.js";
import { getQuota, resetAllQuotas } from "../src/core/access.js";
import { greetingForTime } from "../src/lib/start-message.js";
import { registerCommands } from "../src/handlers/commands.js";
import { registerQuotaReset } from "../src/handlers/quotareset.js";
import { registerPixiv } from "../src/handlers/pixiv.js";
import { searchIllust } from "../src/lib/pixiv.js";
import { isPixivNsfwEnabled } from "../src/lib/pixiv-settings.js";
import { addXp } from "../src/lib/xp-storage.js";
import { handleIncoming } from "../src/platform/whatsapp/router.js";
import type { IncomingMessage } from "../src/platform/whatsapp/types.js";
import { createTestBot } from "./helpers.js";

const originalFetch = globalThis.fetch;
const envKeys = ["DEFAULT_QUOTA", "OWNER_ID", "OWNER_NUMBERS", "OWNER_NUMBER", "EVERYONE", "TIMEZONE", "GROUP_ONLY"];
let saved: Array<string | undefined>;
beforeEach(() => {
  saved = envKeys.map((key) => process.env[key]);
  envKeys.forEach((key) => delete process.env[key]);
  process.env.OWNER_ID = "222";
  process.env.OWNER_NUMBERS = "628222";
  process.env.EVERYONE = "true";
  closeDatabase();
  initDatabase(":memory:");
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  closeDatabase();
  envKeys.forEach((key, index) => {
    if (saved[index] === undefined) delete process.env[key];
    else process.env[key] = saved[index];
  });
});

it("uses WIB at every greeting boundary", () => {
  for (const [hour, expected] of [[0, "malam"], [4, "pagi"], [11, "siang"], [15, "sore"], [18, "malam"]] as const) {
    assert.equal(greetingForTime(Date.UTC(2026, 0, 2, hour - 7)), expected);
  }
});

it("greets the Telegram user with their level and bot photo, and opens help separately", async () => {
  await addXp({ platform: "telegram", chatId: "111", userId: "222", displayName: "A", amount: 100 });
  const t = createTestBot({ getUserProfilePhotos: { photos: [[{ file_id: "bot-photo" }]] } });
  registerCommands(t.bot);
  await t.bot.handleUpdate(t.textUpdate("/start", { firstName: "A <B> & C" }));
  const photo = t.calls.find((call) => call.method === "sendPhoto");
  assert.equal(photo?.body.photo, "bot-photo");
  assert.match(String(photo?.body.caption), /Selamat .*A &lt;B&gt; &amp; C\.[\s\S]*Jumlah command tersedia: \d+[\s\S]*Level kamu: 2[\s\S]*Ketik help/);
  await t.bot.handleUpdate(t.textUpdate("help"));
  assert.ok(t.replies().some((reply) => reply.includes("Daftar perintah")));
});

it("enforces inclusive transaction bounds without moving funds on rejection", () => {
  getWallet("sender");
  getWallet("receiver");
  getDb()!.prepare("UPDATE casino_wallets SET balance=20000000, bank_balance=20000000 WHERE user_id=?").run("sender");
  for (const amount of [0, 999, 3_000_001, 1000.5]) {
    const before = getWallet("sender");
    assert.equal(transferBank("sender", "deposit", amount).ok, false);
    assert.equal(transferBank("sender", "withdraw", amount).ok, false);
    assert.equal(transferWallet("sender", "receiver", amount).ok, false);
    assert.equal(addWalletMoney("sender", amount).ok, false);
    assert.deepEqual(getWallet("sender"), before);
  }
  for (const amount of [1_000, 3_000_000]) {
    assert.equal(transferBank("sender", "deposit", amount).ok, true);
    assert.equal(transferBank("sender", "withdraw", amount).ok, true);
    assert.equal(transferWallet("sender", "receiver", amount).ok, true);
    assert.equal(addWalletMoney("sender", amount).ok, true);
  }
  for (const reply of [bankMessage("sender", "deposit 999", "/"), transferMessage("sender", "receiver", 999), addMoneyMessage("sender", 999)]) {
    assert.match(reply, /Rp1\.000.*Rp3\.000\.000/);
  }
});

it("restores 50 plus 9 bonus across daily, manual and Telegram resets", async () => {
  for (const platform of ["telegram", "whatsapp"]) {
    setQuotaRow({ platform, userId: "333", quotaLeft: 1, dailyBonus: 9, permanentBonus: 0, lastReset: "2000-01-01", displayName: "A", at: Date.now() });
    const quota = getQuota(platform, "333", "member", "A");
    assert.equal(quota.quotaLeft, 59);
    assert.equal(quota.total, 59);
    assert.equal(getQuota(platform, "333", "member", "A", Date.now() + 86_400_000).quotaLeft, 59);
  }
  resetAllQuotas(Date.now() + 86_400_000);
  assert.equal(getQuotaRow("whatsapp", "333")?.quotaLeft, 59);
  const t = createTestBot();
  registerQuotaReset(t.bot);
  await t.bot.handleUpdate(t.textUpdate("/quota-reset", { fromId: 222 }));
  assert.equal(getQuotaRow("telegram", "333")?.quotaLeft, 59);
});

it("filters adult tags and restriction metadata unless NSFW is enabled", async () => {
  globalThis.fetch = (async (input) => String(input).includes("oauth")
    ? Response.json({ response: { access_token: "test", expires_in: 3600 } })
    : Response.json({ illusts: [
      { id: 1, tags: [{ name: " R-18 " }], image_urls: { large: "https://example.test/1" } },
      { id: 2, tags: [{ name: "r-18g" }], image_urls: { large: "https://example.test/2" } },
      { id: 3, x_restrict: 1, tags: [], image_urls: { large: "https://example.test/3" } },
      { id: 4, x_restrict: 0, tags: [{ name: "SFW" }], image_urls: { large: "https://example.test/4" } },
    ] })) as typeof fetch;
  assert.equal((await searchIllust("test", "art", false))?.id, 4);
  assert.equal((await searchIllust("test", "art", true))?.id, 1);
});

it("lets non-owners search Pixiv while keeping settings owner-only", async () => {
  delete process.env.PIXIV_REFRESH_TOKEN;
  const t = createTestBot();
  registerPixiv(t.bot);
  await t.bot.handleUpdate(t.textUpdate("/pixiv landscape", { fromId: 333 }));

  assert.ok(t.replies().some((text) => text.includes("PIXIV_REFRESH_TOKEN")));
  assert.ok(!t.replies().some((text) => text.includes("hanya untuk pemilik")));
});

it("protects Pixiv settings on both platforms and shares the saved value", async () => {
  const t = createTestBot();
  registerPixiv(t.bot);
  await t.bot.handleUpdate(t.textUpdate("!pixiv nsfw true", { fromId: 999 }));
  assert.equal(isPixivNsfwEnabled(), false);
  await t.bot.handleUpdate(t.textUpdate("!pixiv nsfw true", { fromId: 222 }));
  assert.equal(isPixivNsfwEnabled(), true);
  const sent: Array<{ text?: string; caption?: string; image?: unknown }> = [];
  const message = {
    sock: { user: { id: "bot" }, profilePictureUrl: async () => undefined, sendMessage: async (_jid: string, content: object) => { sent.push(content); return {}; } },
    chatId: "private", isGroup: false, senderJid: "628222@s.whatsapp.net", senderAlt: null,
    userId: "628222", phone: "628222", name: "Tester", text: "!pixiv nsfw false", message: {}, quoted: null,
  } as unknown as IncomingMessage;
  await handleIncoming({ ...message, userId: "628999", phone: "628999" });
  assert.equal(isPixivNsfwEnabled(), true);
  await handleIncoming(message);
  assert.equal(isPixivNsfwEnabled(), false);
  await handleIncoming({ ...message, text: ".start" });
  assert.ok(sent.some((entry) => /Selamat .*Tester\.[\s\S]*Level kamu:/.test(entry.text ?? "")));
  await handleIncoming({ ...message, text: "help" });
  assert.ok(sent.some((entry) => entry.text?.includes("Daftar perintah")));
});
