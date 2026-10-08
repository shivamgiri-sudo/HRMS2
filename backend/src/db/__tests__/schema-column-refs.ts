/**
 * Finds SQL column references that name a column the database does not have.
 *
 * This is the single most common defect in this codebase. A query selects
 * `department_master.department_name` (the real column is `dept_name`), MySQL throws
 * ER_BAD_FIELD_ERROR, and a surrounding `.catch(() => 0)` turns the error into a
 * fabricated zero that renders as a real measurement. The feature looks fine and
 * reports nothing. Recent instances: the BGV PDF had never once downloaded, the
 * payroll recalculation lock matched 0 of 66 runs, and the LMS training-completion
 * report reached 0 of 909 learner rows.
 *
 * Detection is deliberately conservative — it only reports a reference when it can be
 * certain which table an alias belongs to:
 *
 *  - only template literals containing a SQL verb are scanned;
 *  - each literal is split at SELECT so an alias from one statement cannot leak into
 *    the next (file-wide alias maps produced ~94% false positives);
 *  - an alias is resolved only if it appears exactly once in that statement, so a
 *    repeated short alias is skipped rather than guessed;
 *  - SQL line comments are stripped, because prose about a column is not a use of it;
 *  - `x.y(` is treated as a JS method call, not a column (`${ids.join(",")}`).
 *
 * A reference whose *table* is unknown to the snapshot is ignored: that is a
 * table-name problem, and reporting it here would drown the column signal.
 */

export type ColumnRef = { table: string; column: string };

const RESERVED = new Set([
  "this", "db", "res", "req", "err", "e2", "json", "d", "s", "o", "p2", "fs", "path", "new", "con",
]);

const TABLE_RE = /\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z][a-z0-9_]{0,4})\b/gi;
const REF_RE = /\b([a-z][a-z0-9_]{0,4})\.([a-z_][a-z0-9_]*)\b(?!\s*\()/g;
const SQL_VERB_RE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;


/**
 * Remove JS comments before looking for SQL.
 *
 * A doc comment that quotes SQL in backticks is indistinguishable from a
 * template literal to a regex, so prose describing a bug gets scanned as if it
 * were the bug. That produced three false positives in one session - a JSDoc
 * saying `UPDATE t SET a = ?` registered table `t`, and an explanation of a
 * fixed defect kept the defect alive in the baseline. Documentation should be
 * free to name the thing it is documenting.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      if (i === -1) return line;
      // only strip when the // is not inside a quoted string on that line
      const before = line.slice(0, i);
      const quotes = (before.match(/["'`]/g) ?? []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join("\n");
}

/** Extract every alias-qualified column reference this scanner can attribute with confidence. */
export function columnRefsIn(source: string): ColumnRef[] {
  const out: ColumnRef[] = [];
  const seen = new Set<string>();

  for (const literal of stripComments(source).match(/`[^`]*`/g) ?? []) {
    if (!SQL_VERB_RE.test(literal)) continue;

    for (const statement of literal.split(/(?=\bSELECT\b)/i)) {
      const found = [...statement.matchAll(TABLE_RE)].map(
        (m) => [m[1].toLowerCase(), m[2].toLowerCase()] as const
      );
      if (found.length === 0) continue;

      const occurrences = new Map<string, number>();
      for (const [, alias] of found) occurrences.set(alias, (occurrences.get(alias) ?? 0) + 1);

      const aliasToTable = new Map<string, string>();
      for (const [table, alias] of found) {
        if (RESERVED.has(alias) || occurrences.get(alias) !== 1) continue;
        aliasToTable.set(alias, table);
      }
      if (aliasToTable.size === 0) continue;

      const body = statement.replace(/--[^\n]*/g, "");
      for (const m of body.matchAll(REF_RE)) {
        const table = aliasToTable.get(m[1].toLowerCase());
        if (!table) continue;
        const column = m[2].toLowerCase();
        const key = `${table}.${column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ table, column });
      }
    }
  }
  return out;
}

/** Keep only references whose table is known but whose column is not. */
export function brokenRefs(
  refs: ColumnRef[],
  schema: Record<string, string[]>
): ColumnRef[] {
  return refs.filter((r) => {
    const columns = schema[r.table];
    return columns !== undefined && !columns.includes(r.column);
  });
}

/**
 * Tables named as the target of a write.
 *
 * columnRefsIn() only yields alias-qualified columns, so it sees nothing at all
 * in `UPDATE t SET ...`, `INSERT INTO t (...)` or `DELETE FROM t`. That blind
 * spot is why the exit flow could write to `employee_asset_assignment` (no such
 * table) and `leave_requests` (the table is `leave_request`) for months with a
 * schema guard already running over the tree: all three defects were writes.
 *
 * Scope is deliberately narrow. Only these three shapes are matched, each of
 * which is structurally unambiguous — `UPDATE x SET`, `INSERT INTO x (`,
 * `DELETE FROM x`. A bare `FROM`/`JOIN` is not included: unaliased reads are
 * far more common in prose inside template literals, and matching them produced
 * 531 baseline entries of almost pure noise, which is a ratchet nobody can
 * maintain. A write to a table that does not exist is also the case that fails
 * silently and matters most.
 */
const WRITE_TARGET_RES = [
  /\bUPDATE\s+([a-z_][a-z0-9_]*)\s+SET\b/gi,
  /\bINSERT\s+(?:IGNORE\s+)?INTO\s+([a-z_][a-z0-9_]*)\s*[(]/gi,
  /\bDELETE\s+FROM\s+([a-z_][a-z0-9_]*)\b/gi,
];

export function writeTargetsIn(source: string): string[] {
  const out = new Set<string>();
  for (const literal of stripComments(source).match(/`[^`]*`/g) ?? []) {
    if (!SQL_VERB_RE.test(literal)) continue;
    const body = literal.replace(/--[^\n]*/g, "");
    for (const re of WRITE_TARGET_RES) {
      for (const m of body.matchAll(re)) out.add(m[1].toLowerCase());
    }
  }
  return [...out].sort();
}

/**
 * Write targets the database does not have.
 *
 * Reported separately from brokenRefs() and ratcheted against its own baseline,
 * because a handful of these are legitimate (tables in another database, and
 * scripts that create their own scratch tables).
 */
export function unknownWriteTargets(
  source: string,
  schema: Record<string, string[]>
): string[] {
  return writeTargetsIn(source).filter((t) => schema[t] === undefined);
}

/**
 * Columns a write NAMES, from INSERT column lists and UPDATE SET clauses.
 *
 * columnRefsIn() only yields alias-qualified columns out of SELECT/FROM/JOIN,
 * so the names inside `INSERT INTO t (a, b, c)` and `UPDATE t SET a = ?` are
 * checked by nothing at all. That is not a theoretical gap: seven bulk-upload
 * services wrote `UPDATE upload_batch_row SET ... error_message = ?` when the
 * column is error_messages, and because the statement sat inside the per-row
 * catch, one bad row made the error handler throw and took the whole import
 * down. Both existing guards were blind to it.
 *
 * Conservative on purpose - it skips anything it cannot attribute with
 * certainty:
 *   - a dynamic column list (contains a template placeholder);
 *   - a multi-table UPDATE (anything between the table name and SET), because
 *     a SET column could belong to either side;
 *   - a qualified assignment such as `SET a.col = ?`, for the same reason;
 *   - ON DUPLICATE KEY UPDATE, which is a separate clause shape.
 */
const INSERT_COLS_RE = /INSERT\s+(?:IGNORE\s+)?INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi;
const UPDATE_SET_RE = /UPDATE\s+([a-z_][a-z0-9_]*)\s+SET\s+([\s\S]*?)(?:\bWHERE\b|\bON\s+DUPLICATE\b|$)/gi;
const ASSIGNED_COL_RE = /(?:^|,)\s*`?([a-z_][a-z0-9_]*)`?\s*=/gi;

export function writeColumnRefs(source: string): ColumnRef[] {
  const out: ColumnRef[] = [];
  const seen = new Set<string>();

  const push = (table: string, column: string) => {
    const key = `${table}.${column}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ table, column });
  };

  for (const literal of stripComments(source).match(/`[^`]*`/g) ?? []) {
    if (!SQL_VERB_RE.test(literal)) continue;
    const body = literal.replace(/--[^\n]*/g, "");

    INSERT_COLS_RE.lastIndex = 0;
    for (const m of body.matchAll(INSERT_COLS_RE)) {
      if (m[2].includes("${")) continue;
      const table = m[1].toLowerCase();
      for (const raw of m[2].split(",")) {
        const col = raw.trim().replace(/`/g, "").toLowerCase();
        if (/^[a-z_][a-z0-9_]*$/.test(col)) push(table, col);
      }
    }

    UPDATE_SET_RE.lastIndex = 0;
    for (const m of body.matchAll(UPDATE_SET_RE)) {
      if (m[2].includes("${")) continue;
      const table = m[1].toLowerCase();
      ASSIGNED_COL_RE.lastIndex = 0;
      for (const a of m[2].matchAll(ASSIGNED_COL_RE)) {
        push(table, a[1].toLowerCase());
      }
    }
  }
  return out;
}
