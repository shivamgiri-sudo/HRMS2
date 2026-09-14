import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every literal the code WRITES to wfm_roster_assignment.final_roster_status must be a
 * member of the enum the migrations declare.
 *
 * This is not hypothetical tidiness. Production runs with STRICT_TRANS_TABLES, so an
 * out-of-enum write does not coerce to '' with a warning — it raises ER_DATA_TRUNCATED
 * (1265) and the request 500s. That is exactly what
 * POST /api/wfm/roster/:assignmentId/reject-employee-request did from the day the column
 * was created: it writes 'manager_rejected_employee_request', which the enum did not
 * contain. Verified live 2026-08-15 — all 413,386 rows sat at 'generated' and none held
 * '', so the path had never once succeeded, and because the throw lands before the
 * roster_decision_audit INSERT the rejection left no audit trail either.
 *
 * The failure is invisible to a reader: the route is long, carefully scoped and
 * lock-checked, and the offending literal reads like every other state name around it.
 * Only the enum definition disagrees, and it lives in a different file.
 */

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const ENUM_MIGRATION = read("sql/1222_roster_manager_rejected_enum.sql");
const WFM_ROUTES = read("src/modules/wfm/wfm.routes.ts");

/** The enum members as declared by the newest migration that redefines the column. */
function declaredMembers(): string[] {
  const m = ENUM_MIGRATION.match(/final_roster_status enum\(([^)]*)\)/i);
  if (!m) throw new Error("could not find the final_roster_status enum in migration 1222");
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

/** Every literal assigned to the column anywhere in the WFM routes. */
function writtenLiterals(source: string): string[] {
  const out = new Set<string>();
  const re = /final_roster_status\s*=\s*'([a-z_]+)'/gi;
  for (const match of source.matchAll(re)) out.add(match[1]);
  return [...out];
}

describe("final_roster_status enum parity", () => {
  it("declares the member the manager-reject route writes", () => {
    expect(declaredMembers()).toContain("manager_rejected_employee_request");
  });

  it("keeps every pre-existing member, and appends rather than reorders", () => {
    // MySQL stores an enum by ordinal. Inserting a member mid-list silently reinterprets
    // every stored row, so the new value must be last and the prefix must be untouched.
    const members = declaredMembers();
    expect(members.slice(0, 10)).toEqual([
      "generated",
      "pending_employee_ack",
      "acknowledged",
      "rejected_by_employee",
      "pending_manager_action",
      "realigned_by_manager",
      "force_approved_by_manager",
      "escalated_to_hr",
      "approved_final",
      "published_to_rta",
    ]);
    expect(members[members.length - 1]).toBe("manager_rejected_employee_request");
  });

  it("writes no literal the enum does not contain", () => {
    // The general guard: this is what would have caught the original bug, and what will
    // catch the next state someone adds to a route without touching the column.
    const members = new Set(declaredMembers());
    const written = writtenLiterals(WFM_ROUTES);
    expect(written.length).toBeGreaterThan(0); // the matcher itself must still work
    const unknown = written.filter((v) => !members.has(v));
    expect(unknown).toEqual([]);
  });

  it("is guarded and idempotent, and does not reorder on re-run", () => {
    expect(ENUM_MIGRATION).toMatch(/information_schema\.COLUMNS/i);
    expect(ENUM_MIGRATION).toMatch(/PREPARE stmt FROM @ddl/);
    expect(ENUM_MIGRATION).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    // The guard must key on the member being absent, not on the column existing.
    expect(ENUM_MIGRATION).toMatch(/COLUMN_TYPE NOT LIKE '%manager_rejected_employee_request%'/);
  });

  it("is registered in the migration manifest", () => {
    const manifest = read("src/db/runPendingMigrations.ts");
    expect(manifest).toContain('"1222_roster_manager_rejected_enum.sql"');
  });
});
