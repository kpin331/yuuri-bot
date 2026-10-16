// Read-only inspection of the shared SQLite database, used by the owner-only
// /database command: a table catalog, a small filter language, paging and an
// Excel export. Table names come from a whitelist and every user value is bound
// as a parameter, so nothing typed in chat is ever interpolated into SQL.
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db.js";
import { escapeHtml } from "./info.js";

export const PAGE_SIZE = 10;
export const EXPORT_ROW_CAP = 50_000;
export const DB_SESSION_TTL_MS = 5 * 60 * 1000;

export const DB_TABLES = [
  { name: "users", label: "Telegram users" },
  { name: "activity", label: "Telegram daily messages" },
  { name: "command_activity", label: "Telegram command uses" },
  { name: "command_states", label: "Command on/off states" },
  { name: "bans", label: "Telegram bans" },
  { name: "platform_quota", label: "Quota (all platforms)" },
  { name: "wa_users", label: "WhatsApp users" },
  { name: "wa_activity", label: "WhatsApp daily messages" },
  { name: "wa_command_activity", label: "WhatsApp command uses" },
  { name: "wa_bans", label: "WhatsApp bans" },
] as const;

export type DbTable = (typeof DB_TABLES)[number]["name"];

const TABLE_NAMES = new Set<string>(DB_TABLES.map((table) => table.name));

export function isDbTable(value: string): value is DbTable {
  return TABLE_NAMES.has(value);
}

export function tableLabel(table: DbTable): string {
  return DB_TABLES.find((entry) => entry.name === table)?.label ?? table;
}

// Epoch-millisecond columns, shown as a readable UTC date in the chat while the
// export keeps the raw value.
const TIMESTAMP_COLUMNS = new Set([
  "first_seen",
  "last_seen",
  "created_at",
  "expires_at",
  "updated_at",
  "last_used",
]);

export function isTimestampColumn(column: string): boolean {
  return TIMESTAMP_COLUMNS.has(column);
}

export const FILTER_OPERATORS = [
  { code: "eq", label: "=" },
  { code: "ne", label: "!=" },
  { code: "ct", label: "contains" },
  { code: "gt", label: ">" },
  { code: "ge", label: ">=" },
  { code: "lt", label: "<" },
  { code: "le", label: "<=" },
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number]["code"];

const OPERATOR_CODES = new Set<string>(FILTER_OPERATORS.map((entry) => entry.code));

export function isFilterOperator(value: string): value is FilterOperator {
  return OPERATOR_CODES.has(value);
}

export function operatorLabel(operator: FilterOperator): string {
  return FILTER_OPERATORS.find((entry) => entry.code === operator)?.label ?? operator;
}

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface PreparedFilter {
  sql: string;
  params: Array<string | number>;
}

export type DbStage = "tables" | "rows" | "detail" | "filter" | "column" | "operator" | "value";

export interface DbSession {
  chatId: number;
  userId: number;
  messageId: number;
  table: DbTable | null;
  page: number;
  conditions: FilterCondition[];
  stage: DbStage;
  pendingColumn?: string;
  pendingOperator?: FilterOperator;
  createdAt: number;
}

function requireDb(): DatabaseSync {
  const db = getDb();
  if (!db) throw new Error("Storage is not available.");
  return db;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function sessionKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

// === Schema introspection ===

export function getColumns(table: DbTable): string[] {
  const rows = requireDb().prepare(`PRAGMA table_info("${table}")`).all();
  return rows
    .map((row) => String((row as Record<string, unknown>)["name"]))
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
}

export interface TableSummary {
  name: DbTable;
  label: string;
  count: number;
}

export function listTables(): TableSummary[] {
  return DB_TABLES.map((table) => ({
    name: table.name,
    label: table.label,
    count: countRows(table.name, { sql: "", params: [] }),
  }));
}

// === Filtering ===

export function prepareFilter(
  table: DbTable,
  conditions: FilterCondition[],
): { filter: PreparedFilter; error: string | null } {
  const columns = new Set(getColumns(table));
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  for (const condition of conditions) {
    if (!columns.has(condition.column)) {
      return { filter: { sql: "", params: [] }, error: `Unknown column: ${condition.column}` };
    }
    const quoted = `"${condition.column}"`;
    switch (condition.operator) {
      case "eq":
        clauses.push(`${quoted} = ?`);
        params.push(condition.value);
        break;
      case "ne":
        clauses.push(`${quoted} != ?`);
        params.push(condition.value);
        break;
      case "ct":
        clauses.push(`${quoted} LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(condition.value)}%`);
        break;
      case "gt":
      case "ge":
      case "lt":
      case "le": {
        const number = Number(condition.value);
        if (!Number.isFinite(number)) {
          return {
            filter: { sql: "", params: [] },
            error: `"${condition.value}" is not a number (needed for ${operatorLabel(condition.operator)}).`,
          };
        }
        const symbol = { gt: ">", ge: ">=", lt: "<", le: "<=" }[condition.operator];
        clauses.push(`${quoted} ${symbol} ?`);
        params.push(number);
        break;
      }
    }
  }

  return {
    filter: { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params },
    error: null,
  };
}

export function describeConditions(conditions: FilterCondition[]): string {
  if (conditions.length === 0) return "none";
  return conditions
    .map((condition) => `${condition.column} ${operatorLabel(condition.operator)} ${condition.value}`)
    .join(" AND ");
}

// === Queries ===

export function countRows(table: DbTable, filter: PreparedFilter): number {
  const row = requireDb()
    .prepare(`SELECT COUNT(*) AS count FROM "${table}" ${filter.sql}`)
    .get(...filter.params) as { count?: number | bigint } | undefined;
  return Number(row?.count ?? 0);
}

export function fetchRows(
  table: DbTable,
  filter: PreparedFilter,
  limit: number,
  offset: number,
): Array<Record<string, unknown>> {
  const rows = requireDb()
    .prepare(`SELECT rowid AS __rowid, * FROM "${table}" ${filter.sql} ORDER BY rowid ASC LIMIT ? OFFSET ?`)
    .all(...filter.params, limit, offset);
  return rows as Array<Record<string, unknown>>;
}

export function fetchRowByRowid(table: DbTable, rowid: number): Record<string, unknown> | null {
  const row = requireDb()
    .prepare(`SELECT rowid AS __rowid, * FROM "${table}" WHERE rowid = ?`)
    .get(rowid);
  return (row as Record<string, unknown> | undefined) ?? null;
}

export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number, total: number, pageSize: number = PAGE_SIZE): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), pageCount(total, pageSize));
}

// === Formatting ===

export function formatTimestampValue(column: string, value: unknown): string | null {
  if (!isTimestampColumn(column)) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export function formatCellValue(column: string, value: unknown): string {
  if (value === null || value === undefined) return "null";
  const timestamp = formatTimestampValue(column, value);
  if (timestamp) return timestamp;
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  return String(value);
}

// The value as it goes into the spreadsheet: numbers stay numbers so Excel can
// sort and sum them; everything else is text.
export function toCellValue(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  return String(value);
}

export function renderTableList(tables: TableSummary[]): string {
  const total = tables.reduce((sum, table) => sum + table.count, 0);
  return [`🗄️ <b>Database</b>`, `${tables.length} tables, ${total} rows total.`].join("\n");
}

export function renderRowsPage(input: {
  table: DbTable;
  page: number;
  total: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  conditions: FilterCondition[];
}): string {
  const { table, page, total, columns, rows, conditions } = input;
  const lines = [
    `🗄️ <b>${escapeHtml(table)}</b> (${escapeHtml(tableLabel(table))})`,
    `${total} row(s) · page ${page}/${pageCount(total)}`,
    `filter: ${escapeHtml(describeConditions(conditions))}`,
  ];

  if (rows.length === 0) {
    lines.push("", "No rows match.");
    return lines.join("\n");
  }

  rows.forEach((row, index) => {
    const number = (page - 1) * PAGE_SIZE + index + 1;
    const cells = columns.map(
      (column) => `${escapeHtml(column)}=${escapeHtml(truncate(formatCellValue(column, row[column]), 28))}`,
    );
    lines.push(`${number}. ${cells.join(" · ")}`);
  });
  return lines.join("\n");
}

export function renderRowDetail(table: DbTable, row: Record<string, unknown>): string {
  const lines = [`🗄️ <b>${escapeHtml(table)}</b>`, ""];
  for (const [column, value] of Object.entries(row)) {
    if (column === "__rowid") continue;
    const formatted = formatCellValue(column, value);
    const text =
      isTimestampColumn(column) && typeof value === "number"
        ? `${formatted} (${value})`
        : truncate(formatted, 200);
    lines.push(`<b>${escapeHtml(column)}</b>: ${escapeHtml(text)}`);
  }
  return lines.join("\n");
}

// === Excel export ===

export async function buildWorkbook(
  table: DbTable,
  filter: PreparedFilter,
): Promise<{ buffer: Buffer; rows: number; truncated: boolean }> {
  const columns = getColumns(table);
  const total = countRows(table, filter);
  const limit = Math.min(total, EXPORT_ROW_CAP);
  const rows = limit > 0 ? fetchRows(table, filter, limit, 0) : [];

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.slice(0, 31));
  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(columns.map((column) => toCellValue(row[column])));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), rows: rows.length, truncated: total > limit };
}

// === Session store ===

export class DbSessionStore {
  private readonly sessions = new Map<string, DbSession>();

  constructor(
    private readonly ttlMs: number = DB_SESSION_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  create(input: Omit<DbSession, "createdAt"> & { createdAt?: number }): DbSession {
    const session: DbSession = { ...input, createdAt: input.createdAt ?? this.now() };
    this.sessions.set(sessionKey(session.chatId, session.userId), session);
    return session;
  }

  get(chatId: number, userId: number): DbSession | undefined {
    const key = sessionKey(chatId, userId);
    const session = this.sessions.get(key);
    if (!session) return undefined;
    if (this.now() - session.createdAt > this.ttlMs) {
      this.sessions.delete(key);
      return undefined;
    }
    return session;
  }

  delete(chatId: number, userId: number): void {
    this.sessions.delete(sessionKey(chatId, userId));
  }

  clear(): void {
    this.sessions.clear();
  }

  size(): number {
    return this.sessions.size;
  }
}
