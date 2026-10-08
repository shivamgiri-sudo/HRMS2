/**
 * `LIMIT ?` / `OFFSET ?` cannot be bound through a prepared statement on this MySQL + mysql2 combination:
 * a JavaScript number is sent as a DOUBLE and the server answers
 *   ER_WRONG_ARGUMENTS "Incorrect arguments to mysqld_stmt_execute".
 * That has been fixed one route at a time (exit, roster, work-inbox, cost-centre ...) and was still the cause of
 * a 500 on the Payslip Center's run lines (production error reference 04698198), with dozens of call sites
 * written the same way.
 *
 * This rewrites such a placeholder into the literal integer BEFORE the statement is prepared. It only touches a
 * placeholder that
 *   - directly follows the keyword LIMIT or OFFSET (or is the second item of `LIMIT ?, ?`), and
 *   - is bound to a non-negative whole number (a number, or a string of digits).
 * Anything else is left exactly as written, so a genuinely bad value still fails the way it did before. The
 * value is validated as an integer first, so inlining it cannot carry SQL.
 */
export function inlineLimitPlaceholders(
  sql: string,
  params: unknown[] | undefined,
): { sql: string; params: unknown[] | undefined } {
  if (!params || params.length === 0 || !/\b(?:LIMIT|OFFSET)\b/i.test(sql)) return { sql, params };

  const asInt = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647 ? v : null;
    if (typeof v === "string" && /^\d{1,10}$/.test(v)) { const n = Number(v); return n <= 2_147_483_647 ? n : null; }
    return null;
  };

  const out: string[] = [];
  const kept: unknown[] = [];
  let ordinal = 0;
  let lastPlaceholderEnd = -1;   // index in `sql` just after the previous placeholder
  let prevWasLimitFirst = false; // the previous placeholder was `LIMIT ?` (so `, ?` may follow)
  let changed = false;
  let i = 0;

  const flushTo = (end: number, from: number) => out.push(sql.slice(from, end));
  let copiedFrom = 0;

  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];

    // skip string literals, quoted identifiers and comments: a "?" inside them is not a placeholder
    if (c === "'" || c === '"' || c === "`") {
      const q = c; i++;
      while (i < sql.length) {
        if (sql[i] === "\\" && q !== "`") { i += 2; continue; }
        if (sql[i] === q) { if (sql[i + 1] === q) { i += 2; continue; } i++; break; }
        i++;
      }
      continue;
    }
    if ((c === "-" && n === "-" && /\s/.test(sql[i + 2] ?? " ")) || c === "#") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    if (c === "?") {
      const idx = ordinal++;
      const before = sql.slice(0, i).replace(/\s+$/, "");
      const afterLimitKeyword = /\b(?:LIMIT|OFFSET)$/i.test(before);
      const isLimitKeyword = /\bLIMIT$/i.test(before);
      const secondOfLimitPair =
        prevWasLimitFirst && lastPlaceholderEnd >= 0 && /^\s*,\s*$/.test(sql.slice(lastPlaceholderEnd, i));
      const value = asInt(params[idx]);

      if ((afterLimitKeyword || secondOfLimitPair) && value !== null) {
        flushTo(i, copiedFrom);
        out.push(String(value));
        copiedFrom = i + 1;
        changed = true;
        // `LIMIT ?, ?`: remember a first item so the second one is recognised too
        prevWasLimitFirst = isLimitKeyword && !secondOfLimitPair;
      } else {
        kept.push(params[idx]);
        prevWasLimitFirst = isLimitKeyword && !secondOfLimitPair;
      }
      lastPlaceholderEnd = i + 1;
      i++;
      continue;
    }
    i++;
  }

  if (!changed) return { sql, params };
  out.push(sql.slice(copiedFrom));
  return { sql: out.join(""), params: kept };
}
