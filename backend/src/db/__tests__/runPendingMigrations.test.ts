import { describe, expect, it } from "vitest";
import {
  buildSchemaMigrationsAppliedQuery,
  buildSchemaMigrationsAppliedRowsQuery,
  buildSchemaMigrationsInsertStatement,
} from "../runPendingMigrations.js";

describe("buildSchemaMigrationsAppliedQuery", () => {
  it("uses the success filter when the column exists", () => {
    expect(buildSchemaMigrationsAppliedQuery(true)).toContain("WHERE success = 1 OR success IS NULL");
  });

  it("falls back to the legacy schema_migrations shape when success is absent", () => {
    expect(buildSchemaMigrationsAppliedQuery(false)).toBe("SELECT filename FROM schema_migrations");
  });
});

describe("buildSchemaMigrationsAppliedRowsQuery", () => {
  it("reads checksum and success filter when both columns exist", () => {
    expect(
      buildSchemaMigrationsAppliedRowsQuery({ hasChecksumSha256: true, hasSuccess: true })
    ).toBe("SELECT filename, checksum_sha256 FROM schema_migrations WHERE success = 1 OR success IS NULL");
  });

  it("uses a NULL checksum alias for legacy schema_migrations tables", () => {
    expect(
      buildSchemaMigrationsAppliedRowsQuery({ hasChecksumSha256: false, hasSuccess: false })
    ).toBe("SELECT filename, NULL AS checksum_sha256 FROM schema_migrations");
  });
});

describe("buildSchemaMigrationsInsertStatement", () => {
  it("writes only filename when governance columns do not exist yet", () => {
    const sql = buildSchemaMigrationsInsertStatement(
      {
        hasChecksumSha256: false,
        hasEnvironment: false,
        hasStartTime: false,
        hasEndTime: false,
        hasDurationMs: false,
        hasExecutor: false,
        hasSuccess: false,
        hasErrorMessage: false,
      },
      { success: true }
    );
    // This test is about the COLUMN LIST — that no governance column is named on a table which
    // does not have one. It previously asserted the whole string with toBe(), which also pinned
    // the ABSENCE of a duplicate-key clause, and that was incidental rather than intended.
    //
    // The success path now upserts, for the reason in migration-success-overwrites-failure.test.ts:
    // a bare INSERT could not record success over a previous failure row, which permanently wedged
    // 1006_payroll_process_readiness_extend.sql on production and blocked 7 migrations behind it.
    // On a minimal table the clause degrades to the no-op `filename = filename`, exactly as the
    // failure path has always done — so the two paths stay symmetrical and the statement stays
    // valid. Asserting the INSERT half keeps this test's real subject intact.
    expect(sql.slice(0, sql.indexOf(" ON DUPLICATE"))).toBe(
      "INSERT INTO schema_migrations (filename) VALUES (?)"
    );
    expect(sql).toContain("ON DUPLICATE KEY UPDATE filename = filename");
  });

  it("adds duplicate-key failure updates only for supported columns", () => {
    expect(
      buildSchemaMigrationsInsertStatement(
        {
          hasChecksumSha256: true,
          hasEnvironment: true,
          hasStartTime: true,
          hasEndTime: true,
          hasDurationMs: true,
          hasExecutor: true,
          hasSuccess: true,
          hasErrorMessage: true,
        },
        { success: false }
      )
    ).toContain("ON DUPLICATE KEY UPDATE end_time = VALUES(end_time), success = 0, error_message = VALUES(error_message)");
  });
});
