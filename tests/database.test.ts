import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { registerDatabase } from "../src/handlers/database.js";
import {
  buildWorkbook,
  clampPage,
  countRows,
  DbSessionStore,
  fetchRows,
  formatCellValue,
  formatTimestampValue,
  getColumns,
  isDbTable,
  listTables,
  pageCount,
  prepareFilter,
  renderRowsPage,
  type FilterCondition,
} from "../src/lib/database.js";
import { closeDatabase, initDatabase, recordIncoming } from "../src/lib/db.js";
import { createTestBot } from "./helpers.js";

const OWNER = 222;
const ENV_KEYS = ["OWNER_ID", "EVERYONE"] as const;
const SEED_AT = Date.UTC(2026, 0, 2, 3, 4, 5);

let saved: Record<string, string | undefined> = {};

function seed(): void {
  recordIncoming({
    user: { id: 1, firstName: "Alice", lastName: "A", username: "alice" },
    command: "play",
    at: SEED_AT,
  });
  recordIncoming({
    user: { id: 1, firstName: "Alice", lastName: "A", username: "alice" },
    at: SEED_AT,
  });
  recordIncoming({
    user: { id: 2, firstName: "Bob", username: "bob" },
    command: "start",
    at: SEED_AT,
  });
}

describe("database lib", () => {
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.OWNER_ID = String(OWNER);
    closeDatabase();
    initDatabase(":memory:");
    seed();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    closeDatabase();
  });

  it("lists the known tables with row counts", () => {
    const tables = listTables();
    assert.equal(tables.length, 10);
    const users = tables.find((table) => table.name === "users");
    assert.equal(users?.count, 2);
    const activity = tables.find((table) => table.name === "activity");
    assert.equal(activity?.count, 2);
  });

  it("recognizes only whitelisted table names", () => {
    assert.equal(isDbTable("users"), true);
    assert.equal(isDbTable("wa_bans"), true);
    assert.equal(isDbTable("sqlite_master"), false);
    assert.equal(isDbTable("users; DROP TABLE users"), false);
  });

  it("reads columns from the live schema", () => {
    assert.deepEqual(getColumns("users"), [
      "user_id",
      "first_name",
      "last_name",
      "username",
      "first_seen",
      "last_seen",
    ]);
  });

  it("builds a parameterized filter", () => {
    const { filter, error } = prepareFilter("users", [
      { column: "username", operator: "ct", value: "a%" },
      { column: "user_id", operator: "gt", value: "1" },
    ]);
    assert.equal(error, null);
    assert.equal(filter.sql, `WHERE "username" LIKE ? ESCAPE '\\' AND "user_id" > ?`);
    assert.deepEqual(filter.params, ["%a\\%%", 1]);
  });

  it("rejects unknown columns and non-numeric comparisons", () => {
    const unknown = prepareFilter("users", [{ column: "nope", operator: "eq", value: "1" }]);
    assert.ok(unknown.error?.includes("Unknown column"));

    const badNumber = prepareFilter("users", [{ column: "user_id", operator: "gt", value: "abc" }]);
    assert.ok(badNumber.error?.includes("not a number"));
  });

  it("counts and pages rows in rowid order", () => {
    const { filter } = prepareFilter("users", []);
    assert.equal(countRows("users", filter), 2);
    const all = fetchRows("users", filter, 10, 0);
    assert.equal(all.length, 2);
    assert.equal(all[0]?.["username"], "alice");
    assert.equal(all[1]?.["username"], "bob");
    const second = fetchRows("users", filter, 1, 1);
    assert.equal(second[0]?.["username"], "bob");
  });

  it("clamps page numbers", () => {
    assert.equal(pageCount(0), 1);
    assert.equal(pageCount(21), 3);
    assert.equal(clampPage(0, 21), 1);
    assert.equal(clampPage(9, 21), 3);
  });

  it("formats epoch timestamps and nulls", () => {
    assert.equal(formatTimestampValue("first_seen", SEED_AT), "2026-01-02 03:04:05 UTC");
    assert.equal(formatTimestampValue("username", SEED_AT), null);
    assert.equal(formatCellValue("last_name", null), "null");
    assert.equal(formatCellValue("user_id", 7), "7");
  });

  it("renders a rows page with the active filter", () => {
    const conditions: FilterCondition[] = [{ column: "username", operator: "eq", value: "alice" }];
    const { filter } = prepareFilter("users", conditions);
    const rows = fetchRows("users", filter, 10, 0);
    const text = renderRowsPage({
      table: "users",
      page: 1,
      total: 1,
      columns: getColumns("users"),
      rows,
      conditions,
    });
    assert.ok(text.includes("filter: username = alice"));
    assert.ok(text.includes("1. "));
    assert.ok(text.includes("username=alice"));
  });

  it("builds a real xlsx workbook", async () => {
    const { filter } = prepareFilter("users", []);
    const { buffer, rows, truncated } = await buildWorkbook("users", filter);
    assert.equal(rows, 2);
    assert.equal(truncated, false);
    assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK", "xlsx is a zip archive");

    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    assert.ok(sheet);
    assert.equal(sheet.getCell("A1").value, "user_id");

    const header = sheet.getRow(1).values as unknown[];
    const usernameColumn = header.indexOf("username");
    const usernames = sheet
      .getColumn(usernameColumn)
      .values.slice(2)
      .map((value) => String(value))
      .sort();
    assert.deepEqual(usernames, ["alice", "bob"]);
  });
});

describe("DbSessionStore", () => {
  it("expires sessions after the ttl", () => {
    let now = 1_000;
    const store = new DbSessionStore(50, () => now);
    store.create({
      chatId: 1,
      userId: 2,
      messageId: 3,
      table: null,
      page: 1,
      conditions: [],
      stage: "tables",
    });
    assert.ok(store.get(1, 2));
    now = 1_100;
    assert.equal(store.get(1, 2), undefined);
    assert.equal(store.size(), 0);
  });
});

describe("/database command", () => {
  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.OWNER_ID = String(OWNER);
    closeDatabase();
    initDatabase(":memory:");
    seed();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    closeDatabase();
  });

  it("shows the table list to the owner", async () => {
    const t = createTestBot({ sendMessage: { message_id: 7 } });
    registerDatabase(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/database", { fromId: OWNER }));

    const reply = t.replies().join("\n");
    assert.ok(reply.includes("Database"), reply);
    const send = t.calls.find((call) => call.method === "sendMessage");
    const markup = send?.body.reply_markup as
      | { inline_keyboard: Array<Array<{ callback_data: string }>> }
      | undefined;
    const datas = (markup?.inline_keyboard ?? []).flat().map((button) => button.callback_data);
    assert.ok(datas.includes("db:tbl:users"));
  });

  it("refuses anyone who is not the owner", async () => {
    const t = createTestBot({ sendMessage: { message_id: 7 } });
    registerDatabase(t.bot);

    await t.bot.handleUpdate(t.textUpdate("/database", { fromId: 999 }));
    assert.ok(t.replies().some((reply) => reply.includes("owner-only")));
  });

  it("blocks non-owner callback button presses", async () => {
    const t = createTestBot({ sendMessage: { message_id: 7 } });
    registerDatabase(t.bot);

    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:tbl:users", fromId: 999 }));
    const answer = t.calls.find((call) => call.method === "answerCallbackQuery");
    assert.ok(String(answer?.body.text).includes("Owner only"));
  });

  it("browses, filters and exports a table", async () => {
    const t = createTestBot({ sendMessage: { message_id: 7 } });
    registerDatabase(t.bot);
    const chatId = 111;
    const from = { chatId, fromId: OWNER };

    await t.bot.handleUpdate(t.textUpdate("/database", from));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:tbl:users", ...from }));

    const rowsView = t.editedTexts().at(-1) ?? "";
    assert.ok(rowsView.includes("filter: none"), rowsView);
    assert.ok(rowsView.includes("username=alice"), rowsView);

    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:filter", ...from }));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:add", ...from }));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:col:username", ...from }));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:op:eq", ...from }));
    await t.bot.handleUpdate(t.textUpdate("bob", from));

    const filtered = t.editedTexts().at(-1) ?? "";
    assert.ok(filtered.includes("filter: username = bob"), filtered);
    assert.ok(filtered.includes("username=bob"), filtered);
    assert.ok(!filtered.includes("alice"), filtered);

    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:x", ...from }));
    assert.ok(t.calls.some((call) => call.method === "sendDocument"), "export sends a document");
  });

  it("shows full row detail when a row number is tapped", async () => {
    const t = createTestBot({ sendMessage: { message_id: 7 } });
    registerDatabase(t.bot);
    const chatId = 112;
    const from = { chatId, fromId: OWNER };

    const { filter } = prepareFilter("users", []);
    const rowid = Number(fetchRows("users", filter, 1, 0)[0]?.["__rowid"]);

    await t.bot.handleUpdate(t.textUpdate("/database", from));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:tbl:users", ...from }));
    await t.bot.handleUpdate(t.callbackUpdate({ data: `db:row:${rowid}`, ...from }));

    const detail = t.editedTexts().at(-1) ?? "";
    assert.ok(detail.includes("username"), detail);
    assert.ok(detail.includes("alice"), detail);
  });

  it("asks for a number when the operator needs one", async () => {
    const t = createTestBot({ sendMessage: { message_id: 7 } });
    registerDatabase(t.bot);
    const chatId = 113;
    const from = { chatId, fromId: OWNER };

    await t.bot.handleUpdate(t.textUpdate("/database", from));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:tbl:users", ...from }));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:add", ...from }));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:col:user_id", ...from }));
    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:op:gt", ...from }));
    await t.bot.handleUpdate(t.textUpdate("not-a-number", from));

    assert.ok(t.replies().some((reply) => reply.includes("Enter a number")));
  });

  it("reports an expired menu", async () => {
    const t = createTestBot({ sendMessage: { message_id: 7 } });
    registerDatabase(t.bot);

    await t.bot.handleUpdate(t.callbackUpdate({ data: "db:tbl:users", chatId: 779, fromId: OWNER }));
    const answer = t.calls.find((call) => call.method === "answerCallbackQuery");
    assert.ok(String(answer?.body.text).includes("expired"));
  });
});
