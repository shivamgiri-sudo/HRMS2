/**
 * Builds a table -> columns snapshot by parsing `backend/sql/*.sql`.
 *
 * Why this exists: dashboard endpoints have repeatedly shipped SQL referencing columns
 * that do not exist (`salary_prep_run.run_label`, `kpi_daily_actual.score_pct`), which
 * MySQL rejects with ER_BAD_FIELD_ERROR. Because those reads swallow their errors, the
 * failure surfaced as a permanently empty panel rather than an error. Parsing the
 * migrations lets a plain unit test catch that class before it reaches a database.
 *
 * Two important caveats, both load-bearing:
 *
 *  1. `000_run_all.sql` sources only a subset of the migration files (306 of 486 at the
 *     time of writing), yet several unsourced files ARE applied in production. So the
 *     runner is a *lower bound* on the real schema, never an upper bound. `sourcedFiles`
 *     is reported separately so callers can flag drift instead of asserting on it.
 *  2. This is a best-effort parser, not a MySQL grammar. It is deliberately permissive:
 *     unknown columns are a false negative (missed bug), never a false positive.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type SqlSchemaSnapshot = {
  /** table name (lowercased) -> set of column names (lowercased) */
  tables: Map<string, Set<string>>;
  /** which migration file first created each table */
  tableOrigin: Map<string, string>;
  /** column "table.column" -> the migration file that introduced it */
  columnOrigin: Map<string, string>;
  /** files listed via SOURCE in 000_run_all.sql */
  sourcedFiles: Set<string>;
  /** every *.sql file found in the directory */
  allFiles: string[];
};

const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?\s*\(/gi;

const ALTER_ADD_RE =
  /ALTER\s+TABLE\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi;

/**
 * The conditional-DDL idiom used across this repo:
 *   SET @tbl = 'salary_prep_line';
 *   SET @sql = IF(<not exists>, CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN paid_working_days ...'), ...);
 * The table comes from `SET @tbl`, the column from the CONCAT'd ALTER fragment.
 */
const SET_TBL_RE = /SET\s+@tbl\s*=\s*'([A-Za-z0-9_]+)'/gi;
const CONCAT_ADD_RE =
  /'ALTER\s+TABLE\s*',\s*@tbl\s*,\s*'\s*ADD\s+(?:COLUMN\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi;
/** Some files inline the table name instead of using @tbl. */
const CONCAT_ADD_INLINE_RE =
  /'ALTER\s+TABLE\s+([A-Za-z0-9_]+)\s+ADD\s+(?:COLUMN\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi;

/** Strip comments and string-literal noise that would otherwise produce phantom columns. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ")
    .replace(/^\s*#.*$/gm, " ");
}

/** Extract column names from the body of a CREATE TABLE (...) block. */
function parseCreateBody(body: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  for (const raw of parts) {
    const line = raw.trim();
    if (!line) continue;
    // Skip table constraints — they are not columns.
    if (
      /^(PRIMARY\s+KEY|UNIQUE(\s+KEY|\s+INDEX)?|KEY|INDEX|FULLTEXT|SPATIAL|CONSTRAINT|FOREIGN\s+KEY|CHECK)\b/i.test(
        line,
      )
    ) {
      continue;
    }
    const m = line.match(/^[`"]?([A-Za-z0-9_]+)[`"]?\s+/);
    if (m) columns.push(m[1].toLowerCase());
  }
  return columns;
}

/** Find the matching close paren for the `(` at `openIdx`. */
function matchParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function buildSqlSchemaSnapshot(sqlDir: string): SqlSchemaSnapshot {
  const allFiles = readdirSync(sqlDir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();

  const tables = new Map<string, Set<string>>();
  const tableOrigin = new Map<string, string>();
  const columnOrigin = new Map<string, string>();

  const addColumn = (table: string, column: string, file: string) => {
    const t = table.toLowerCase();
    const c = column.toLowerCase();
    if (!tables.has(t)) {
      tables.set(t, new Set());
      tableOrigin.set(t, file);
    }
    const set = tables.get(t)!;
    if (!set.has(c)) {
      set.add(c);
      columnOrigin.set(`${t}.${c}`, file);
    }
  };

  for (const file of allFiles) {
    let raw: string;
    try {
      raw = readFileSync(join(sqlDir, file), "utf8");
    } catch {
      continue;
    }
    const sql = stripComments(raw);

    // CREATE TABLE ... ( ... )
    CREATE_TABLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CREATE_TABLE_RE.exec(sql)) !== null) {
      const table = m[1];
      const open = sql.indexOf("(", m.index + m[0].length - 1);
      const close = matchParen(sql, open);
      if (open === -1 || close === -1) continue;
      if (!tables.has(table.toLowerCase())) {
        tables.set(table.toLowerCase(), new Set());
        tableOrigin.set(table.toLowerCase(), file);
      }
      for (const col of parseCreateBody(sql.slice(open + 1, close))) {
        addColumn(table, col, file);
      }
    }

    // ALTER TABLE ... ADD [COLUMN] x
    ALTER_ADD_RE.lastIndex = 0;
    while ((m = ALTER_ADD_RE.exec(sql)) !== null) {
      const [, table, column] = m;
      // "ADD INDEX/KEY/CONSTRAINT/..." are not columns.
      if (/^(index|key|unique|primary|constraint|foreign|fulltext|spatial|check)$/i.test(column)) continue;
      addColumn(table, column, file);
    }

    // Conditional CONCAT('ALTER TABLE ', @tbl, ' ADD COLUMN x ...') idiom
    SET_TBL_RE.lastIndex = 0;
    const tblAssignments: { index: number; table: string }[] = [];
    while ((m = SET_TBL_RE.exec(sql)) !== null) {
      tblAssignments.push({ index: m.index, table: m[1] });
    }
    CONCAT_ADD_RE.lastIndex = 0;
    while ((m = CONCAT_ADD_RE.exec(sql)) !== null) {
      // Bind to the most recent `SET @tbl` before this position.
      let table: string | null = null;
      for (const a of tblAssignments) {
        if (a.index < m.index) table = a.table;
        else break;
      }
      if (table) addColumn(table, m[1], file);
    }
    CONCAT_ADD_INLINE_RE.lastIndex = 0;
    while ((m = CONCAT_ADD_INLINE_RE.exec(sql)) !== null) {
      addColumn(m[1], m[2], file);
    }
  }

  // Which files does the runner actually execute?
  const sourcedFiles = new Set<string>();
  try {
    const runner = readFileSync(join(sqlDir, "000_run_all.sql"), "utf8");
    // Entries look like `SOURCE sql/001_core_org.sql;` — strip any directory prefix
    // and key on the basename, which is how the snapshot indexes files.
    const re = /^\s*SOURCE\s+(?:[^\s;]*[/\\])?([A-Za-z0-9_.\-]+\.sql)/gim;
    let m: RegExpExecArray | null;
    while ((m = re.exec(runner)) !== null) sourcedFiles.add(m[1]);
  } catch {
    /* runner is optional */
  }

  return { tables, tableOrigin, columnOrigin, sourcedFiles, allFiles };
}

export function hasColumn(snapshot: SqlSchemaSnapshot, table: string, column: string): boolean {
  return snapshot.tables.get(table.toLowerCase())?.has(column.toLowerCase()) ?? false;
}

export function hasTable(snapshot: SqlSchemaSnapshot, table: string): boolean {
  return snapshot.tables.has(table.toLowerCase());
}

/** The migration that introduced a column, or null if the column is unknown. */
export function columnSource(
  snapshot: SqlSchemaSnapshot,
  table: string,
  column: string,
): string | null {
  return snapshot.columnOrigin.get(`${table.toLowerCase()}.${column.toLowerCase()}`) ?? null;
}
