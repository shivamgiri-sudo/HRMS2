/**
 * A migration that has failed once must still be recordable as succeeding.
 *
 * THE BUG THIS PINS, observed on production 2026-08-13
 *   buildSchemaMigrationsInsertStatement() returned a bare INSERT on the success path while the
 *   failure path used ON DUPLICATE KEY UPDATE. So once a migration left a success = 0 row, the
 *   NEXT run could never record its success: the INSERT collided with that row on the primary key,
 *   the runner caught the collision and attributed it to the migration, and the failure path then
 *   rewrote success = 0. A permanent loop.
 *
 *   1006_payroll_process_readiness_extend.sql was stuck in it. Its own SQL was fine — every column
 *   and index it adds was already present on the live table — and its recorded error was
 *   "Duplicate entry '1006_...' for key 'schema_migrations.PRIMARY'", a key the migration does not
 *   touch. With STOP_ON_FIRST_FAILURE it blocked all 7 migrations queued behind it, and no fix to
 *   the migration's SQL could have cleared it.
 *
 * WHY A UNIT TEST AND NOT AN INTEGRATION ONE
 *   The failure needs a pre-existing row, a retry, and a runner that treats the recording error as
 *   the migration's own — reproducing that against a real database means deliberately poisoning
 *   schema_migrations. The defect is entirely in one pure string-building function, so it is
 *   pinned there.
 */
import { describe, expect, it } from "vitest";
import { buildSchemaMigrationsInsertStatement } from "../runPendingMigrations.js";

/** The production shape: every optional column present. */
const FULL = {
  hasChecksumSha256: true,
  hasEnvironment: true,
  hasStartTime: true,
  hasEndTime: true,
  hasDurationMs: true,
  hasExecutor: true,
  hasSuccess: true,
  hasErrorMessage: true,
};

/** The oldest shape: filename only, every optional column absent. */
const MINIMAL = {
  hasChecksumSha256: false,
  hasEnvironment: false,
  hasStartTime: false,
  hasEndTime: false,
  hasDurationMs: false,
  hasExecutor: false,
  hasSuccess: false,
  hasErrorMessage: false,
};

describe("recording a SUCCESS over a previous FAILURE", () => {
  it("upserts instead of colliding on the primary key", () => {
    const sql = buildSchemaMigrationsInsertStatement(FULL, { success: true });
    expect(
      sql,
      "A bare INSERT cannot record success for a migration that already has a failure row. " +
        "That is the production defect: the collision was reported as the migration failing, and " +
        "the migration could never clear itself.",
    ).toContain("ON DUPLICATE KEY UPDATE");
  });

  it("flips success back to 1", () => {
    const sql = buildSchemaMigrationsInsertStatement(FULL, { success: true });
    // Without this the row keeps success = 0 and the migration stays "pending" forever, so the
    // upsert alone would fix the crash and not the blockage.
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*success = 1/);
  });

  it("clears the stale error_message", () => {
    const sql = buildSchemaMigrationsInsertStatement(FULL, { success: true });
    // A row reading success = 1 beside the previous run's error text is the kind of contradiction
    // that misdirects whoever reads this table during an incident.
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*error_message = NULL/);
  });

  it("refreshes the timings to the run that actually succeeded", () => {
    const sql = buildSchemaMigrationsInsertStatement(FULL, { success: true });
    for (const col of ["start_time", "end_time", "duration_ms", "executor"]) {
      expect(sql, `${col} should reflect the successful run, not the failed one`)
        .toContain(`${col} = VALUES(${col})`);
    }
  });

  it("still produces a valid statement on a table with no optional columns", () => {
    // Every update entry is conditional on an optional column, so a minimal table could otherwise
    // yield "ON DUPLICATE KEY UPDATE " with an empty clause — a syntax error. This is the exact
    // trap the failure branch already guards with `filename = filename`.
    const sql = buildSchemaMigrationsInsertStatement(MINIMAL, { success: true });
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).not.toMatch(/ON DUPLICATE KEY UPDATE\s*$/);
    expect(sql).toContain("filename = filename");
  });
});

describe("recording a FAILURE keeps working", () => {
  it("still upserts, and still records the failure", () => {
    const sql = buildSchemaMigrationsInsertStatement(FULL, { success: false });
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(sql).toMatch(/success = 0/);
    expect(sql).toContain("error_message = VALUES(error_message)");
  });

  it("never nulls the error it is in the middle of recording", () => {
    const sql = buildSchemaMigrationsInsertStatement(FULL, { success: false });
    expect(sql).not.toContain("error_message = NULL");
  });

  it("is valid on a minimal table too", () => {
    const sql = buildSchemaMigrationsInsertStatement(MINIMAL, { success: false });
    expect(sql).toContain("filename = filename");
  });
});

describe("the two paths stay distinguishable", () => {
  it("success never writes success = 0, and failure never writes success = 1", () => {
    const ok = buildSchemaMigrationsInsertStatement(FULL, { success: true });
    const bad = buildSchemaMigrationsInsertStatement(FULL, { success: false });
    expect(ok).not.toMatch(/success = 0/);
    expect(bad).not.toMatch(/success = 1/);
    // The INSERT half must still carry the literal each path inserts on a fresh row.
    expect(ok.slice(0, ok.indexOf("ON DUPLICATE"))).toMatch(/,\s*1\)/);
    expect(bad.slice(0, bad.indexOf("ON DUPLICATE"))).toMatch(/,\s*0,/);
  });
});
