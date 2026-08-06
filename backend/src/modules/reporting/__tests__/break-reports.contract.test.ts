import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_CATALOG } from "../report-catalog.js";
import { EXECUTOR_MAP } from "../executors/index.js";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * The Break Activity Daily Summary report was dead on arrival. Its executor queried
 * `bs.session_date` on `break_sessions`, and that column does not exist — the real
 * one is `shift_date`. Every run of the report raised
 * "Unknown column 'session_date' in 'field list'", so the WFM → Break Reports menu
 * item had never returned a row. Nothing caught it because no test touched this
 * executor, and the whole reporting module carries the same schema-drift risk: the
 * SQL is a template literal, so a wrong column name is invisible until MySQL sees it.
 *
 * The catalog entry had drifted too. It declared shift_name / break_count /
 * total_break_minutes at a grain of one row per employee per date, while the executor
 * returned one row per break session with duration_minutes / break_start / break_end.
 * Even with the column name fixed, the grid would have rendered three empty columns
 * and dropped everything the query actually produced.
 *
 * These tests pin both halves: the SQL may only reference columns that exist on the
 * real table, and the executor's output keys must be exactly what the catalog
 * promises the user.
 *
 * Column list verified against mas_hrms on 2026-08-06 via SHOW COLUMNS, not from a
 * migration file — see the schema-drift note in the reporting module. Add to this
 * list only after confirming the column exists in the live database.
 */
const BREAK_SESSIONS_COLUMNS = new Set([
  "id", "employee_id", "employee_code", "branch_id", "process_id", "department_id",
  "manager_id", "shift_date", "break_start_time", "break_end_time", "duration_seconds",
  "duration_minutes", "break_type", "break_reason", "status", "start_source",
  "end_source", "kiosk_device_id", "biometric_punch_in_time", "biometric_punch_out_time",
  "no_biometric_punch_flag", "exception_reason", "manager_approval_required",
  "manager_approved_by", "manager_approved_at", "created_at", "updated_at",
]);

/** Status values that exist on break_sessions.status in the live table. */
const BREAK_SESSION_STATUSES = new Set(["ACTIVE", "COMPLETED", "AUTO_CLOSED", "EXCEPTION"]);

const executorSource = read("src/modules/reporting/executors/attendance.executor.ts");

/** Slice out a single exported executor function body by name. */
function functionBody(name: string): string {
  const start = executorSource.indexOf(`export async function ${name}(`);
  expect(start, `${name} not found in attendance.executor.ts`).toBeGreaterThan(-1);
  const next = executorSource.indexOf("\nexport async function ", start + 1);
  return executorSource.slice(start, next === -1 ? executorSource.length : next);
}

/**
 * Column aliases a SELECT list exposes to the caller, in order.
 * `x AS y` yields y; a bare `t.col` yields col. `_cursor` is stripped by the
 * executor before returning, so it is not part of the output contract.
 */
function selectAliases(body: string): string[] {
  const start = body.indexOf("SELECT ");
  // Drop SQL line comments first, so a column name mentioned in prose — or a stray
  // bracket in an explanatory note — cannot be parsed as SQL.
  const afterSelect = body.slice(start + "SELECT ".length).replace(/--[^\n]*/g, "");

  // Split on the FROM that closes the select list, which is the first one at paren
  // depth zero. A correlated subquery in the select list carries its own FROM, and
  // taking that one truncates the list and silently hides every later column.
  const aliases: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < afterSelect.length; i++) {
    const ch = afterSelect[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && /\s/.test(ch) && /^FROM\s/i.test(afterSelect.slice(i + 1))) break;
    if (ch === "," && depth === 0) {
      aliases.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  aliases.push(current);

  return aliases
    .map(expr => {
      const trimmed = expr.trim();
      const asMatch = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(trimmed);
      if (asMatch) return asMatch[1];
      const bare = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(trimmed);
      return bare ? bare[1] : "";
    })
    .filter(alias => alias !== "" && alias !== "_cursor");
}

describe("break reports", () => {
  describe.each([
    ["break-daily-summary", "breakDailySummary"],
    ["break-session-log", "breakSessionLog"],
  ])("%s", (code, fnName) => {
    const body = functionBody(fnName);

    it("references only columns that exist on break_sessions", () => {
      // The bug this pins: bs.session_date parsed fine, typechecked fine, and failed
      // only at the database. Anything aliased `bs.` must be a real column.
      const referenced = [...body.matchAll(/\bbs\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]);
      expect(referenced.length, "expected the query to reference break_sessions").toBeGreaterThan(0);

      const unknown = [...new Set(referenced)].filter(col => !BREAK_SESSIONS_COLUMNS.has(col));
      expect(unknown, `not columns on break_sessions: ${unknown.join(", ")}`).toEqual([]);
    });

    it("never uses the column name that broke the report", () => {
      expect(body).not.toContain("session_date");
      expect(body).toContain("bs.shift_date");
    });

    it("filters on real break_sessions.status values", () => {
      const literals = [...body.matchAll(/'([A-Z_]{4,})'/g)].map(m => m[1]);
      const bogus = literals.filter(v => !BREAK_SESSION_STATUSES.has(v));
      expect(bogus, `not valid break_sessions.status values: ${bogus.join(", ")}`).toEqual([]);
    });

    it("is registered so the report code actually resolves to an executor", () => {
      // A catalog entry with no executor 404s as "not yet available" — the report
      // looks present in the library and cannot be run.
      expect(Object.keys(EXECUTOR_MAP)).toContain(code);
    });

    it("returns exactly the columns the catalog promises", () => {
      // The drift that made the fixed report still render wrong: the grid maps
      // catalog column keys onto row keys, so a mismatch shows blank columns and
      // silently discards data the query did return.
      const entry = REPORT_CATALOG.find(r => r.code === code);
      expect(entry, `${code} missing from REPORT_CATALOG`).toBeDefined();

      const declared = entry!.columns.map(c => c.key).sort();
      const produced = selectAliases(body).sort();
      expect(produced).toEqual(declared);
    });
  });

  it("keeps the summary aggregated and the log per-session", () => {
    // These two reports differ only in grain. If the summary loses its GROUP BY it
    // silently becomes a duplicate of the log, at which point break_count is 1 on
    // every row and every downstream break-abuse number is wrong.
    expect(functionBody("breakDailySummary")).toContain("GROUP BY");
    expect(functionBody("breakSessionLog")).not.toContain("GROUP BY");
  });

  it("counts only finished breaks in the summary, and everything in the log", () => {
    // An ACTIVE break has no end time and a null duration. Counting it in the
    // summary reports break minutes nobody has taken yet; excluding it from the log
    // hides the people who are on a break right now, which is the one thing a live
    // log is for.
    expect(functionBody("breakDailySummary")).toContain("bs.status IN ('COMPLETED','AUTO_CLOSED','EXCEPTION')");
    expect(functionBody("breakSessionLog")).not.toContain("bs.status IN (");
  });

  it("returns break minutes as a number, not a string", () => {
    // SUM() over a DECIMAL column arrives from mysql2 as a string. Left alone it
    // lands in the XLSX as text, so the column will not total in Excel.
    expect(functionBody("breakDailySummary")).toContain("CAST(ROUND(SUM(COALESCE(bs.duration_minutes, 0))) AS SIGNED)");
  });

  it("declares both reports as downloadable by the roles that can view them", () => {
    for (const code of ["break-daily-summary", "break-session-log"]) {
      const entry = REPORT_CATALOG.find(r => r.code === code)!;
      expect(entry.exportRoles.length, `${code} has no exportRoles`).toBeGreaterThan(0);
      // Immediate XLSX download is refused above 'confidential' for non-super-admins
      // (report-suite.routes.ts), which would push these behind email delivery.
      expect(["internal", "confidential"]).toContain(entry.sensitivityLevel);
    }
  });
});
