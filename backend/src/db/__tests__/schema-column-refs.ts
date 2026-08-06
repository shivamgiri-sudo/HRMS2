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

/** Extract every alias-qualified column reference this scanner can attribute with confidence. */
export function columnRefsIn(source: string): ColumnRef[] {
  const out: ColumnRef[] = [];
  const seen = new Set<string>();

  for (const literal of source.match(/`[^`]*`/g) ?? []) {
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
