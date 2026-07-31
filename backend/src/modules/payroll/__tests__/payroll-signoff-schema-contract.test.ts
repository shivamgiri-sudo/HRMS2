/**
 * Payroll sign-off: schema contract and queue predicate.
 *
 * CEO UAT 31-Jul-2026 reported /payroll/sign-off showing "Choose a pending run"
 * with nothing selectable. Two independent defects produced that, both verified
 * against the live schema:
 *
 * 1. The route selects and updates six columns on salary_prep_run that did not
 *    exist — finance_approved_{by,at}, finance_remarks, ceo_acknowledged_{by,at},
 *    ceo_remarks. The live query returned
 *      ERROR 1054: Unknown column 'finance_approved_by' in 'field list'
 *    so every route in the module 500'd and the UI swallowed it into a
 *    placeholder. Migration 1021 adds them.
 *
 * 2. The queue filtered `status IN ('calculated','validated')`. Neither value is
 *    ever written to that column ('calculated' comes from the parallel
 *    payroll-compliance calculator; 'validated' is written to validation_status,
 *    a different column). Live census: FINALIZED 51, approved 12, processing 3,
 *    draft 1 — the filter matched zero rows out of 67.
 *
 * These are source/manifest assertions rather than DB round-trips: the suite has
 * no live database, and the failure mode was a mismatch between what the SQL text
 * references and what the schema provides. That is exactly what source assertions
 * catch and a mocked DB would not.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll-signoff.routes.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(process.cwd(), "sql/1021_payroll_signoff_columns_and_ceo_sod.sql"),
  "utf8",
);
const runner = readFileSync(
  resolve(process.cwd(), "src/db/runPendingMigrations.ts"),
  "utf8",
);

/** Columns the route requires salary_prep_run to have. */
const REQUIRED_COLUMNS = [
  "finance_approved_by",
  "finance_approved_at",
  "finance_remarks",
  "ceo_acknowledged_by",
  "ceo_acknowledged_at",
  "ceo_remarks",
] as const;

describe("payroll sign-off — schema contract", () => {
  it.each(REQUIRED_COLUMNS)(
    "migration 1021 provisions the %s column the route depends on",
    (column) => {
      expect(routes, `route no longer references ${column}`).toContain(column);
      expect(
        migration,
        `route uses ${column} but migration 1021 never adds it — the route will 500 with ER_BAD_FIELD_ERROR`
      ).toMatch(new RegExp(`ADD COLUMN ${column}\\b`));
    },
  );

  it("is registered in MIGRATION_MANIFEST or it can never run", () => {
    // The runner iterates a hardcoded array, not the sql/ directory. An unmanifested
    // file is inert — this is why 601 and 099 never applied.
    expect(runner).toContain('"1021_payroll_signoff_columns_and_ceo_sod.sql"');
  });

  it("is idempotent — guards every ADD COLUMN through information_schema", () => {
    // Match the statement, not the phrase — the header comment mentions
    // "ADD COLUMN IF NOT EXISTS" and would otherwise be counted.
    const addCount = (migration.match(/ALTER TABLE salary_prep_run ADD COLUMN/g) ?? []).length;
    const guardCount = (migration.match(/information_schema\.COLUMNS/g) ?? []).length;
    expect(addCount).toBe(REQUIRED_COLUMNS.length);
    expect(guardCount).toBeGreaterThanOrEqual(addCount);
  });

  it("adds no table and drops nothing", () => {
    expect(migration).not.toMatch(/\bCREATE TABLE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
    expect(migration).not.toMatch(/\bDELETE FROM\b/i);
  });
});

describe("payroll sign-off — pending-run queue predicate", () => {
  const queueQuery = (() => {
    // Regex, not a literal slice — the file is CRLF and indentation shifts.
    const start = routes.search(/router\.get\(\s*"\/runs"/);
    expect(start, "GET /runs handler not found").toBeGreaterThan(-1);
    const next = routes.indexOf("router.", start + 20);
    return routes.slice(start, next === -1 ? undefined : next);
  })();

  it("no longer filters on statuses that are never written to this column", () => {
    expect(
      queueQuery,
      "'calculated' is only written by the payroll-compliance calculator and " +
        "'validated' goes to validation_status, not status — this matched 0 of 67 live runs"
    ).not.toMatch(/status IN \('calculated', ?'validated'\)/);
  });

  it("selects runs whose calculation has completed", () => {
    expect(queueQuery).toMatch(/=\s*'processing'/);
  });

  it("excludes FINALIZED, which is closed history and not a sign-off queue", () => {
    // 51 runs spanning 2021-03 to 2026-04 across 63,316 payslip lines.
    expect(queueQuery).not.toMatch(/'finalized'/i);
  });

  it("compares status case-insensitively", () => {
    // The column mixes casing — FINALIZED is uppercase, everything else lowercase.
    // A case-sensitive comparison has already caused production defects here.
    expect(queueQuery).toMatch(/LOWER\(\s*COALESCE\(\s*(?:\w+\.)?status/);
  });

  it("still excludes runs already signed off", () => {
    expect(queueQuery).toMatch(/finance_approved_at IS NULL/);
  });

  it("excludes synthetic runs so test data cannot be signed off", () => {
    // Live data on 31-Jul-2026 held a 'test-auto-gen' run for 2026-07 worth
    // ₹1.22 Cr across 1,288 payslip lines, rendering identically to the real
    // 'system' run beside it. Without this guard finance is offered a test run
    // as a signable option.
    expect(routes).toMatch(/SYNTHETIC_RUN_CREATORS\s*=\s*\[[^\]]*"test-auto-gen"/);
    expect(queueQuery).toMatch(/created_by[^\n]*NOT IN/);
  });

  it("returns created_by so the caller can see run provenance", () => {
    // created_by is unvalidated free text across the live table, so the guard is
    // defence-in-depth; surfacing it lets a human catch what the list misses.
    expect(queueQuery).toMatch(/SELECT[\s\S]*?created_by/);
  });

  it("parameterises the synthetic-creator list rather than interpolating values", () => {
    // Only the placeholder count is interpolated; the values are bound.
    expect(queueQuery).toMatch(/\$\{placeholders\}/);
    expect(queueQuery).toMatch(/SYNTHETIC_RUN_CREATORS,\s*\)/);
  });

  it("derives headcount from salary_prep_line instead of the stale run header", () => {
    // salary_prep_run.total_employees disagrees with the actual line population on
    // 16 of the 67 live runs. The Jul-2026 run finance signs off claims 1,288
    // against 1,467 real employees; the May-2026 draft claims 11 against 1,148;
    // two FINALIZED runs claim 0 against ~1,100.
    expect(queueQuery).toMatch(/COUNT\(DISTINCT l\.employee_id\)\s+AS employee_count/);
    expect(queueQuery).toMatch(/LEFT JOIN salary_prep_line l ON l\.run_id = r\.id/);
  });

  it("derives net salary from the lines too", () => {
    expect(queueQuery).toMatch(/SUM\(l\.net_salary\)[^)]*\)\s+AS total_net_salary/);
  });

  it("still exposes the header count so the discrepancy stays visible", () => {
    // Hiding the stale value would mask a data-integrity problem rather than
    // surface it. Both numbers are returned; the UI can flag the mismatch.
    expect(queueQuery).toMatch(/total_employees AS header_employee_count/);
  });
});

describe("segregation of duties — ceo grants", () => {
  it("removes Create and Export from the ceo PAYROLL_SIGN_OFF grant", () => {
    expect(migration).toMatch(
      /UPDATE role_page_access[\s\S]*?can_create = 0,[\s\S]*?can_export = 0[\s\S]*?page_code = 'PAYROLL_SIGN_OFF'/,
    );
  });

  it("reduces the ceo AGENT_PERFORMANCE full-CRUD grant to read + export", () => {
    expect(migration).toMatch(
      /UPDATE role_page_access[\s\S]*?can_delete = 0[\s\S]*?page_code = 'AGENT_PERFORMANCE'/,
    );
  });

  it("leaves finance approval authority with finance and payroll_head, not the CEO", () => {
    // The CEO must not be able to finance-approve. Acknowledgement is a separate,
    // threshold-gated step and is deliberately still available to them.
    expect(routes).toMatch(
      /"\/runs\/:runId\/finance-approve",\s*\n?\s*requireRole\((?:(?!ceo)[^)])*\)/,
    );
    expect(routes).toMatch(/"\/runs\/:runId\/ceo-acknowledge",\s*\n?\s*requireRole\("ceo"/);
  });
});
