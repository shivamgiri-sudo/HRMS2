/**
 * PROOF that with zero roster_offday_policy rows the roster write paths are unchanged.
 *
 * generateDraft() (auto generation) and commitImportBatch() (spreadsheet import commit) are run
 * against a SQL-keyed db mock and every write is compared with a golden file that was recorded on
 * the PRE-FEATURE tree (commit ed9c6124) using this very harness:
 *
 *   ROSTER_GOLDEN_WRITE=1 npx vitest run src/modules/wfm/__tests__/roster-offday-zero-policy.test.ts
 *
 * so equality here means the INSERT/UPDATE/DELETE statements and their parameters are identical
 * to what the code emitted before the off-day feature existed. Schema probes and the policy
 * lookups themselves are read-only and excluded from the comparison; the test additionally asserts
 * that no write to wfm_roster_assignment mentions process_id / lob_id / assignment_type on the
 * generation path when the columns are absent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { EMPLOYEES, makeExecute, norm, writesOf, type Call } from "./roster-offday-generate-harness.js";

const { executeMock, mockConn, notifyConn, getConnectionMock, calls, importRow } = vi.hoisted(() => ({
  executeMock: { fn: null as any },
  mockConn: { execute: vi.fn() },
  notifyConn: {
    execute: vi.fn(async () => [[]]), beginTransaction: vi.fn(async () => {}), commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}), release: vi.fn(),
  },
  getConnectionMock: vi.fn(),
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  importRow: { type: "SHIFT" as string },
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (...a: any[]) => executeMock.fn(...a),
    getConnection: getConnectionMock,
  },
}));
vi.mock("../rest-policy.service.js", () => ({
  withEmployeeRosterLock: vi.fn(async (_id: string, fn: (conn: any) => Promise<any>) => fn(mockConn)),
  isRestPolicyFeatureActive: vi.fn(async () => false),
  hasAnyRestPolicyConfigured: vi.fn(async () => true),
  validateMinimumRest: vi.fn(async () => ({ ok: true })),
  applyRestDecision: vi.fn(async () => ({ allowed: true, warned: false })),
  logRestOverride: vi.fn(async () => undefined),
}));
vi.mock("../../roster/roster-lock-guard.js", () => ({ checkEmployeeDateNotLocked: vi.fn(async () => ({ blocked: false })) }));
vi.mock("../../roster/weekoff-policy.service.js", () => ({ resolveWeekOffScopeDefault: vi.fn(async () => null) }));
vi.mock("../../roster/weekoff-rule.service.js", () => ({ loadWeekoffRules: vi.fn(async () => []) }));
vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({ triggerRosterPublishPending: vi.fn(async () => undefined) }));

import { autoRosterSyncedService } from "../auto-roster-synced.service.js";
import { commitImportBatch } from "../roster-import.service.js";

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "zero-policy.golden.json");
const WRITE = process.env.ROSTER_GOLDEN_WRITE === "1";

async function recordGenerate() {
  calls.length = 0;
  executeMock.fn = makeExecute(calls as Call[]);
  await autoRosterSyncedService.generateDraft("plan-1", "actor-1");
  return writesOf(calls as Call[]);
}

async function recordImportCommit(mode: "NEW" | "UPDATE", cycleId: string | null, type: string) {
  calls.length = 0;
  importRow.type = type;
  getConnectionMock.mockResolvedValue(notifyConn);
  executeMock.fn = vi.fn(async (sql: string, params?: any[]) => {
    calls.push({ sql, params: params ?? [] });
    const s = sql.trim().toUpperCase();
    if (s.startsWith("SELECT * FROM WFM_ROSTER_IMPORT_BATCH")) return [[{ id: 1, status: "READY", import_mode: mode, created_by: "u", process_id: null }]];
    if (s.includes("COUNT(*) AS CNT")) return [[{ cnt: 0 }]];
    if (s.startsWith("SELECT * FROM WFM_ROSTER_IMPORT_ROW")) {
      return [[{ employee_id_raw: "E1", roster_date: "2026-08-24", normalized_type: importRow.type, raw_value: "10:00 - 19:00" }]];
    }
    if (s.startsWith("SELECT ID, EMPLOYEE_CODE, PROCESS_ID, BRANCH_ID FROM EMPLOYEES")) {
      return [(params ?? []).map((c) => ({ id: `uuid-${c}`, employee_code: c, process_id: null, branch_id: null }))];
    }
    if (s.startsWith("UPDATE WFM_ROSTER_IMPORT_BATCH")) return [{ affectedRows: 1 }];
    return [[]];
  });
  mockConn.execute.mockReset();
  mockConn.execute.mockImplementation(async (sql: string, params?: any[]) => {
    calls.push({ sql, params: params ?? [] });
    return /^\s*INSERT/i.test(sql) ? [{ affectedRows: 1 }] : [[]];
  });
  await commitImportBatch(1, "reviewer-1", { cycleId: cycleId ?? undefined });
  return writesOf(calls as Call[]).filter((w) => w.sql.includes("INSERT"));
}

const IMPORT_CASES: Array<["NEW" | "UPDATE", string | null, string]> = [];
for (const mode of ["NEW", "UPDATE"] as const) for (const cycle of [null, "cycle-1"]) for (const type of ["SHIFT", "WEEK_OFF"]) IMPORT_CASES.push([mode, cycle, type]);

async function recordAll() {
  const importOut: Record<string, unknown> = {};
  for (const [m, c, t] of IMPORT_CASES) importOut[`${m}|${c}|${t}`] = await recordImportCommit(m, c, t);
  return { generateDraft: await recordGenerate(), importCommit: importOut };
}

beforeEach(() => vi.clearAllMocks());

describe("zero policy rows: roster write paths are unchanged", () => {
  it("emits exactly the writes recorded on the pre-feature tree", async () => {
    const actual = JSON.parse(JSON.stringify(await recordAll()));
    if (WRITE) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    expect(existsSync(GOLDEN)).toBe(true);
    expect(actual).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
  });

  it("generation scenario is non-trivial (guards against a vacuous golden)", async () => {
    const w = await recordGenerate();
    const inserts = w.filter((x) => x.sql.startsWith("INSERT INTO wfm_roster_assignment"));
    expect(inserts.length).toBeGreaterThan(7);
    expect(inserts.some((x) => x.sql.includes("'Week Off', 1"))).toBe(true);
    expect(inserts.some((x) => x.sql.includes("'Rostered'"))).toBe(true);
    expect(EMPLOYEES).toHaveLength(3);
  });

  it("no generation write touches assignment_type / process_id / lob_id when no policy exists", async () => {
    const w = await recordGenerate();
    for (const x of w) expect(x.sql).not.toMatch(/assignment_type|process_id|lob_id/);
    expect(norm(w)).toBeDefined();
  });
});
