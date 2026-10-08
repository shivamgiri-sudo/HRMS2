import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
// @ts-expect-error plain .mjs ops script, no type declarations
import { EXPECTED_COLUMNS, HUB_TABLES, MIGRATION_FILE, RAISED_AT_MIGRATION_FILE, RAISED_AT_SQL, evaluate, refuseWriteMode } from "../roster-requests-verify.mjs";

const backend = path.resolve(__dirname, "../..");
const migration = readFileSync(path.join(backend, "sql", MIGRATION_FILE), "utf8");

/** Column names declared by `CREATE TABLE IF NOT EXISTS <table> (...)` in the migration. */
function declaredColumns(table: string): string[] {
  const start = migration.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  expect(start, `${table} not in migration`).toBeGreaterThan(-1);
  const body = migration.slice(start, migration.indexOf(") ENGINE", start));
  return body
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((w) => w && !/^(INDEX|UNIQUE|PRIMARY|KEY)$/i.test(w));
}

const goodFacts = () => ({
  columns: Object.fromEntries(HUB_TABLES.map((t: string) => [t, [...EXPECTED_COLUMNS[t]]])),
  migrationRow: { filename: MIGRATION_FILE, success: 1 },
  counts: { roster_request_decision_log: 0, roster_request_auto_rule: 0, roster_request_escalation: 0 },
  inboxCounts: {},
  tableCollation: Object.fromEntries(HUB_TABLES.map((t: string) => [t, "utf8mb4_unicode_ci"])),
  idCollation: { employees: "utf8mb4_unicode_ci", process_master: "utf8mb4_unicode_ci", wfm_roster_swap_request: "utf8mb4_unicode_ci" },
  counterpartStatus: true,
  disputeResolverFk: false,
  raisedAt: { disputedAtColumn: true, employeeAckAtColumn: true, disputedWithoutRaisedAt: 0, rejectedWithoutRaisedAt: 0 },
});

describe("roster-requests-verify", () => {
  it("expects exactly the columns migration 1995 declares", () => {
    for (const t of HUB_TABLES) expect(EXPECTED_COLUMNS[t]).toEqual(declaredColumns(t));
  });

  it("names the migration the way the runner manifest records it", () => {
    const runner = readFileSync(path.join(backend, "src/db/runPendingMigrations.ts"), "utf8");
    expect(runner).toContain(`"${MIGRATION_FILE}"`);
  });

  it("refuses any apply mode", () => {
    expect(refuseWriteMode(["apply"])).toMatch(/read-only/);
    expect(refuseWriteMode(["--apply"])).toMatch(/read-only/);
    expect(refuseWriteMode(["--mode=apply"])).toMatch(/read-only/);
    expect(refuseWriteMode([])).toBeNull();
    expect(refuseWriteMode(["--dry-run"])).toBeNull();
  });

  it("passes on a correct schema", () => {
    expect(evaluate(goodFacts()).ok).toBe(true);
  });

  it("fails on a missing table, a missing column, an unrecorded migration, or a collation mismatch", () => {
    const missingTable = goodFacts();
    missingTable.columns.roster_request_auto_rule = null as any;
    expect(evaluate(missingTable).ok).toBe(false);

    const missingColumn = goodFacts();
    missingColumn.columns.roster_request_escalation = ["id", "kind", "source_id"];
    expect(evaluate(missingColumn).ok).toBe(false);

    const unrecorded = goodFacts();
    unrecorded.migrationRow = null as any;
    expect(evaluate(unrecorded).ok).toBe(false);

    const failedRun = goodFacts();
    failedRun.migrationRow = { filename: MIGRATION_FILE, success: 0 };
    expect(evaluate(failedRun).ok).toBe(false);

    const collation = goodFacts();
    collation.idCollation.wfm_roster_swap_request = "utf8mb4_0900_ai_ci";
    const r = evaluate(collation);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c: any) => c.status === "FAIL").detail).toContain("wfm_roster_swap_request.id=utf8mb4_0900_ai_ci");
  });

  it("reports counterpart_status and the dispute-resolver FK without failing", () => {
    const f = goodFacts();
    f.counterpartStatus = false;
    f.disputeResolverFk = true;
    const r = evaluate(f);
    expect(r.ok).toBe(true);
    expect(r.checks.some((c: any) => c.status === "WARN" && /fk_rda_dispute_resolver/.test(c.name))).toBe(true);
  });

  it("is wired into ops-scripts.yml as read-only", () => {
    const wf = readFileSync(path.resolve(backend, "../.github/workflows/ops-scripts.yml"), "utf8");
    expect(wf).toMatch(/options:[\s\S]*- roster-requests-verify/);
    const branch = wf.slice(wf.indexOf("roster-requests-verify)"), wf.indexOf(";;", wf.indexOf("roster-requests-verify)")));
    expect(branch).toContain("node scripts/roster-requests-verify.mjs");
    expect(branch).toMatch(/\[ "\$MODE" = "apply" \][\s\S]*exit 1/);
    expect(branch).not.toContain("--apply");
  });

  it("checks the raised-at columns of migration 2074 and counts rows the backfill missed", () => {
    expect(RAISED_AT_MIGRATION_FILE).toBe("migrations/2074_roster_request_raised_at.sql");
    const runner = readFileSync(path.join(backend, "src/db/runPendingMigrations.ts"), "utf8");
    expect(runner).toContain(`"${RAISED_AT_MIGRATION_FILE}"`);

    const good = evaluate(goodFacts());
    expect(good.checks.find((c: any) => /disputed_at exists/.test(c.name))).toMatchObject({ status: "PASS" });
    expect(good.checks.find((c: any) => /disputed rows without disputed_at/.test(c.name))).toMatchObject({ status: "PASS", detail: "0" });
    expect(good.checks.find((c: any) => /rejected week-offs without employee_ack_at/.test(c.name))).toMatchObject({ status: "PASS", detail: "0" });

    const missing = goodFacts();
    missing.raisedAt = { disputedAtColumn: false, employeeAckAtColumn: true, disputedWithoutRaisedAt: null as any, rejectedWithoutRaisedAt: 0 };
    const r = evaluate(missing);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c: any) => /disputed_at exists/.test(c.name))).toMatchObject({ status: "FAIL" });

    const unfilled = goodFacts();
    unfilled.raisedAt = { disputedAtColumn: true, employeeAckAtColumn: true, disputedWithoutRaisedAt: 3, rejectedWithoutRaisedAt: 2 };
    const u = evaluate(unfilled);
    expect(u.ok).toBe(true);
    expect(u.checks.filter((c: any) => c.status === "WARN" && /without/.test(c.name))).toHaveLength(2);
  });

  it("runs only SELECTs for the raised-at facts", () => {
    for (const sql of Object.values(RAISED_AT_SQL) as string[]) expect(sql.trim()).toMatch(/^SELECT /);
    expect(RAISED_AT_SQL.disputedWithoutRaisedAt).toMatch(/acknowledgement_status = 'disputed' AND disputed_at IS NULL/);
    expect(RAISED_AT_SQL.rejectedWithoutRaisedAt).toMatch(/employee_ack_status = 'rejected' AND employee_ack_at IS NULL/);
  });
});
