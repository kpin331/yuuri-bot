// Owner-only /database command: browse the shared SQLite database as paginated
// tables, filter rows with guided buttons, inspect a single row, and export the
// current (filtered) result as an Excel file. It is deliberately absent from the
// menu, and every button re-checks that the caller is the owner.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InlineKeyboard, InputFile, type Bot, type Context } from "grammy";
import { registerOwnerSlashCommand } from "../lib/command.js";
import { isOwner } from "../lib/config.js";
import { isDatabaseReady } from "../lib/db.js";
import {
  buildWorkbook,
  clampPage,
  countRows,
  DbSessionStore,
  describeConditions,
  EXPORT_ROW_CAP,
  fetchRowByRowid,
  fetchRows,
  FILTER_OPERATORS,
  getColumns,
  isDbTable,
  isFilterOperator,
  listTables,
  operatorLabel,
  PAGE_SIZE,
  pageCount,
  prepareFilter,
  renderRowDetail,
  renderRowsPage,
  renderTableList,
  type DbSession,
  type FilterCondition,
  type FilterOperator,
} from "../lib/database.js";
import { escapeHtml } from "../lib/info.js";
import { makeTempDir, removeDir } from "../lib/temp.js";

const PREFIX = "db:";
const NUMERIC_OPERATORS = new Set<FilterOperator>(["gt", "ge", "lt", "le"]);

const sessions = new DbSessionStore();

function tablesKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const table of listTables()) {
    keyboard.text(`${table.name} (${table.count})`, `${PREFIX}tbl:${table.name}`).row();
  }
  return keyboard;
}

function rowsKeyboard(
  session: DbSession,
  rows: Array<Record<string, unknown>>,
  total: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  rows.forEach((row, index) => {
    const number = (session.page - 1) * PAGE_SIZE + index + 1;
    keyboard.text(String(number), `${PREFIX}row:${String(row["__rowid"])}`);
    if ((index + 1) % 5 === 0 && index + 1 < rows.length) keyboard.row();
  });
  if (rows.length > 0) keyboard.row();

  const pages = pageCount(total);
  if (pages > 1) {
    if (session.page > 1) keyboard.text("« prev", `${PREFIX}pg:${session.page - 1}`);
    keyboard.text(`${session.page}/${pages}`, `${PREFIX}noop`);
    if (session.page < pages) keyboard.text("next »", `${PREFIX}pg:${session.page + 1}`);
    keyboard.row();
  }

  keyboard.text("Filter", `${PREFIX}filter`).text("Export .xlsx", `${PREFIX}x`);
  if (session.conditions.length > 0) keyboard.text("Clear filter", `${PREFIX}clear`);
  keyboard.row().text("Tables", `${PREFIX}tables`);
  return keyboard;
}

async function edit(
  ctx: Context,
  session: DbSession,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  await ctx.api
    .editMessageText(session.chatId, session.messageId, text, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    })
    .catch(() => undefined);
}

async function showTables(ctx: Context, session: DbSession): Promise<void> {
  session.stage = "tables";
  session.table = null;
  await edit(ctx, session, renderTableList(listTables()), tablesKeyboard());
}

async function showRows(ctx: Context, session: DbSession): Promise<void> {
  if (!session.table) {
    await showTables(ctx, session);
    return;
  }

  const { filter, error } = prepareFilter(session.table, session.conditions);
  if (error) {
    session.conditions = [];
    await edit(ctx, session, `⚠️ ${escapeHtml(error)}`, new InlineKeyboard().text("Tables", `${PREFIX}tables`));
    return;
  }

  const total = countRows(session.table, filter);
  session.page = clampPage(session.page, total);
  const rows = total > 0 ? fetchRows(session.table, filter, PAGE_SIZE, (session.page - 1) * PAGE_SIZE) : [];
  session.stage = "rows";

  const text = renderRowsPage({
    table: session.table,
    page: session.page,
    total,
    columns: getColumns(session.table),
    rows,
    conditions: session.conditions,
  });
  await edit(ctx, session, text, rowsKeyboard(session, rows, total));
}

async function showDetail(ctx: Context, session: DbSession, rowid: number): Promise<void> {
  if (!session.table || !Number.isFinite(rowid)) return;
  const row = fetchRowByRowid(session.table, rowid);
  if (!row) {
    await ctx.reply("That row no longer exists.").catch(() => undefined);
    return;
  }
  session.stage = "detail";
  await edit(
    ctx,
    session,
    renderRowDetail(session.table, row),
    new InlineKeyboard().text("Back", `${PREFIX}back`),
  );
}

async function showFilterMenu(ctx: Context, session: DbSession): Promise<void> {
  session.stage = "filter";
  const text = [
    `🔎 <b>Filter: ${escapeHtml(session.table ?? "")}</b>`,
    `Current: ${escapeHtml(describeConditions(session.conditions))}`,
    "",
    "Pick a column, then an operator, then send a value.",
  ].join("\n");
  const keyboard = new InlineKeyboard().text("+ Add condition", `${PREFIX}add`).row();
  if (session.conditions.length > 0) keyboard.text("Clear all", `${PREFIX}clear`).row();
  keyboard.text("Back to rows", `${PREFIX}back`);
  await edit(ctx, session, text, keyboard);
}

async function showColumnPicker(ctx: Context, session: DbSession): Promise<void> {
  if (!session.table) return;
  session.stage = "column";
  const keyboard = new InlineKeyboard();
  for (const column of getColumns(session.table)) {
    keyboard.text(column, `${PREFIX}col:${column}`).row();
  }
  keyboard.text("Back", `${PREFIX}filter`);
  await edit(ctx, session, `🔎 Pick a column in <b>${escapeHtml(session.table)}</b>`, keyboard);
}

async function showOperatorPicker(ctx: Context, session: DbSession): Promise<void> {
  if (!session.table || !session.pendingColumn) return;
  session.stage = "operator";
  const keyboard = new InlineKeyboard();
  for (const operator of FILTER_OPERATORS) {
    keyboard.text(operator.label, `${PREFIX}op:${operator.code}`);
  }
  keyboard.row().text("Back", `${PREFIX}add`);
  await edit(ctx, session, `🔎 Operator for <b>${escapeHtml(session.pendingColumn)}</b>`, keyboard);
}

async function showValuePrompt(ctx: Context, session: DbSession): Promise<void> {
  session.stage = "value";
  const column = session.pendingColumn ?? "";
  const operator = session.pendingOperator ?? "eq";
  const hint = NUMERIC_OPERATORS.has(operator) ? "Send a number." : "Send the text to match.";
  await edit(
    ctx,
    session,
    [
      `🔎 <b>${escapeHtml(column)} ${escapeHtml(operatorLabel(operator))}</b>`,
      hint,
      "",
      "Send the value as a plain message.",
    ].join("\n"),
    new InlineKeyboard().text("Back", `${PREFIX}add`),
  );
}

async function exportTable(ctx: Context, session: DbSession): Promise<void> {
  if (!session.table) return;

  const { filter, error } = prepareFilter(session.table, session.conditions);
  if (error) {
    await ctx.reply(`⚠️ ${escapeHtml(error)}`, { parse_mode: "HTML" }).catch(() => undefined);
    return;
  }

  const status = await ctx.reply("Building the Excel file…").catch(() => undefined);
  const dir = await makeTempDir("db");
  try {
    const { buffer, rows, truncated } = await buildWorkbook(session.table, filter);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `db-${session.table}-${stamp}.xlsx`;
    const path = join(dir, name);
    await writeFile(path, buffer);

    const caption = [
      `🗄️ <b>${escapeHtml(session.table)}</b>`,
      `${rows} row(s)${truncated ? ` (capped at ${EXPORT_ROW_CAP})` : ""}`,
      `filter: ${escapeHtml(describeConditions(session.conditions))}`,
    ].join("\n");
    await ctx.replyWithDocument(new InputFile(path, name), { caption, parse_mode: "HTML" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (status) {
      await ctx.api
        .editMessageText(status.chat.id, status.message_id, `Export failed: ${reason}`)
        .catch(() => undefined);
    }
  } finally {
    await removeDir(dir);
  }

  if (status) {
    await ctx.api.deleteMessage(status.chat.id, status.message_id).catch(() => undefined);
  }
}

async function handleCommand(ctx: Context): Promise<void> {
  if (!isDatabaseReady()) {
    await ctx.reply("The database is not available.").catch(() => undefined);
    return;
  }
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (chatId === undefined || userId === undefined) return;

  const sent = await ctx
    .reply(renderTableList(listTables()), { parse_mode: "HTML", reply_markup: tablesKeyboard() })
    .catch(() => undefined);
  if (!sent) return;

  sessions.create({
    chatId,
    userId,
    messageId: sent.message_id,
    table: null,
    page: 1,
    conditions: [],
    stage: "tables",
  });
}

async function handleCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const message = ctx.callbackQuery?.message;
  const chatId = message?.chat.id;
  const userId = ctx.callbackQuery?.from.id;

  if (chatId === undefined || userId === undefined) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }

  if (!isOwner(userId)) {
    await ctx
      .answerCallbackQuery({ text: "Owner only.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  if (!isDatabaseReady()) {
    await ctx
      .answerCallbackQuery({ text: "The database is not available.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  const session = sessions.get(chatId, userId);
  if (!session) {
    await ctx
      .answerCallbackQuery({ text: "This menu expired. Send /database again.", show_alert: true })
      .catch(() => undefined);
    return;
  }

  const [action, value] = data.slice(PREFIX.length).split(":");

  switch (action) {
    case "noop":
      await ctx.answerCallbackQuery().catch(() => undefined);
      return;

    case "tables":
      await ctx.answerCallbackQuery().catch(() => undefined);
      await showTables(ctx, session);
      return;

    case "tbl": {
      if (!value || !isDbTable(value)) {
        await ctx.answerCallbackQuery({ text: "Unknown table.", show_alert: true }).catch(() => undefined);
        return;
      }
      await ctx.answerCallbackQuery().catch(() => undefined);
      session.table = value;
      session.page = 1;
      session.conditions = [];
      await showRows(ctx, session);
      return;
    }

    case "pg":
      await ctx.answerCallbackQuery().catch(() => undefined);
      session.page = Number(value) || 1;
      await showRows(ctx, session);
      return;

    case "row":
      await ctx.answerCallbackQuery().catch(() => undefined);
      await showDetail(ctx, session, Number(value));
      return;

    case "back":
      await ctx.answerCallbackQuery().catch(() => undefined);
      await showRows(ctx, session);
      return;

    case "filter":
      await ctx.answerCallbackQuery().catch(() => undefined);
      await showFilterMenu(ctx, session);
      return;

    case "add":
      await ctx.answerCallbackQuery().catch(() => undefined);
      await showColumnPicker(ctx, session);
      return;

    case "col": {
      if (!session.table || !value || !getColumns(session.table).includes(value)) {
        await ctx.answerCallbackQuery({ text: "Unknown column.", show_alert: true }).catch(() => undefined);
        return;
      }
      await ctx.answerCallbackQuery().catch(() => undefined);
      session.pendingColumn = value;
      await showOperatorPicker(ctx, session);
      return;
    }

    case "op": {
      if (!value || !isFilterOperator(value)) {
        await ctx.answerCallbackQuery({ text: "Unknown operator.", show_alert: true }).catch(() => undefined);
        return;
      }
      await ctx.answerCallbackQuery().catch(() => undefined);
      session.pendingOperator = value;
      await showValuePrompt(ctx, session);
      return;
    }

    case "clear":
      await ctx.answerCallbackQuery().catch(() => undefined);
      session.conditions = [];
      session.page = 1;
      await showRows(ctx, session);
      return;

    case "x":
      await ctx.answerCallbackQuery().catch(() => undefined);
      await exportTable(ctx, session);
      return;

    default:
      await ctx.answerCallbackQuery().catch(() => undefined);
  }
}

// Consumes the next plain message as a filter value, only while this owner has
// an open prompt. Anything that looks like a command falls through untouched.
async function handleValueMessage(ctx: Context, next: () => Promise<void>): Promise<void> {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (chatId === undefined || userId === undefined) return next();

  const session = sessions.get(chatId, userId);
  if (!session || session.stage !== "value" || !session.table) return next();
  if (!isOwner(userId)) return next();

  const text = (ctx.message?.text ?? ctx.message?.caption ?? "").trim();
  if (text.length === 0 || text.startsWith("/") || text.startsWith("$") || text.startsWith("!")) {
    return next();
  }

  const column = session.pendingColumn;
  const operator = session.pendingOperator;
  if (!column || !operator) return next();

  if (NUMERIC_OPERATORS.has(operator) && !Number.isFinite(Number(text))) {
    await ctx.reply(`⚠️ Enter a number for ${escapeHtml(operatorLabel(operator))}.`, { parse_mode: "HTML" }).catch(() => undefined);
    return;
  }

  const condition: FilterCondition = { column, operator, value: text };
  const candidate = [...session.conditions, condition];
  const { error } = prepareFilter(session.table, candidate);
  if (error) {
    await ctx.reply(`⚠️ ${error}`).catch(() => undefined);
    return;
  }

  session.conditions = candidate;
  session.pendingColumn = undefined;
  session.pendingOperator = undefined;
  session.page = 1;
  await ctx.deleteMessage().catch(() => undefined);
  await showRows(ctx, session);
}

export function registerDatabase(bot: Bot): void {
  registerOwnerSlashCommand(bot, "database", handleCommand);
  bot.callbackQuery(/^db:/, handleCallback);
  bot.on("message", handleValueMessage);
}
