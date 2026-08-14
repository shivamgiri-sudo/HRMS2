import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * HRMS2 delta-audit, 2026-08-14 (P1, DPDP): data_retention_policy carried 7
 * active rows but privacy-retention.worker.ts can only act end-to-end on 1
 * (ats_candidate). is_active=1 on the other 6 was a false compliance signal.
 * Migration 1217 suspends exactly those 6, leaving ats_candidate untouched.
 */
describe("migration 1217 suspends only the 6 unhandled retention-policy rows", () => {
  const migration = read("sql/1219_suspend_unhandled_retention_policies.sql");
  const runner = read("src/db/runPendingMigrations.ts");

  it("is registered in the migration manifest", () => {
    expect(runner).toContain('"1219_suspend_unhandled_retention_policies.sql"');
  });

  it("targets exactly the 6 entity_types with no working handler", () => {
    for (const entityType of [
      "data_breach_log",
      "leave_request",
      "portal_otp",
      "salary_prep_run",
      "wfm_attendance_session",
      "employees",
    ]) {
      expect(migration, `missing entity_type: ${entityType}`).toContain(`'${entityType}'`);
    }
  });

  it("does not touch ats_candidate — the one entity_type that actually works end-to-end", () => {
    expect(migration).not.toMatch(/'ats_candidate'/);
  });

  it("only flips is_active — retention_days and action_on_expiry are untouched", () => {
    expect(migration).toContain("SET is_active = 0");
    expect(migration).not.toMatch(/SET[\s\S]*retention_days\s*=/i);
    expect(migration).not.toMatch(/SET[\s\S]*action_on_expiry\s*=/i);
  });

  it("is idempotent — guarded on is_active = 1 so a re-run updates 0 rows", () => {
    expect(migration).toMatch(/WHERE[\s\S]*AND\s+is_active\s*=\s*1/i);
  });

  it("matches the worker's actual handler coverage — ats_candidate is the only ANONYMIZE_HANDLERS entry", () => {
    const worker = read("src/workers/privacy-retention.worker.ts");
    const handlersBlock = worker.slice(
      worker.indexOf("const ANONYMIZE_HANDLERS"),
      worker.indexOf("async function hasActiveHold")
    );
    // Exactly one entity_type key inside the handlers map.
    const keys = [...handlersBlock.matchAll(/^\s{2}(\w+):\s*async/gm)].map((m) => m[1]);
    expect(keys).toEqual(["ats_candidate"]);
  });
});
