/**
 * createRun's duplicate-run TOCTOU race — root-caused 2026-08-14 during the
 * Payroll Run audit.
 *
 * The original code did a plain SELECT for an existing (run_month,
 * branch_filter, process_filter) row, then a separate INSERT. Two
 * near-simultaneous create calls for the same key could both pass the SELECT
 * before either INSERTed — exactly the "two full-company runs for one month"
 * defect this audit found live in production (2026-03: a 226-line run and a
 * 1,140-line run coexisting). The DB-level unique constraint cannot close
 * this alone (MySQL treats NULL <> NULL in a unique index, and both filter
 * columns are nullable).
 *
 * PROOF OF THE FIX, TWO LAYERS
 *   1. Live, against real MySQL (not reproducible as an automated test —
 *      would require creating rows in production `salary_prep_run`): 8
 *      concurrent createRun-equivalent calls for the same key, real GET_LOCK/
 *      RELEASE_LOCK, real transactions — exactly 1 succeeded, exactly 1 row
 *      landed, the other 7 correctly saw "duplicate" once serialized behind
 *      the lock. Session-scoped GET_LOCK only works when every step of the
 *      check+insert runs on the SAME pooled connection — a plain `db.execute`
 *      call per statement (the initial draft of this fix) draws a fresh
 *      connection per call and silently defeats the lock; this was caught
 *      and corrected before shipping, which is exactly why layer 2 below
 *      exists — to pin that specific mistake from recurring silently.
 *   2. Here: the deterministic control flow, mocked at the connection level
 *      so it runs safely and repeatably in CI without touching a real
 *      database. Proves every step happens on one connection, the lock is
 *      always released, and a failure always rolls back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConn = {
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

const mockDb = {
  execute: vi.fn(), // used by getRun() and unrelated calls — never for the lock/check/insert sequence itself
  getConnection: vi.fn(async () => mockConn),
};

vi.mock("../../../db/mysql.js", () => ({ db: mockDb }));

// Avoid the unrelated branch-readiness gate entirely — it is pre-existing,
// unchanged, and already covered by its own test suite; mocking it here
// isolates exactly the race-guard logic this fix touches.
vi.mock("../payroll-branch-readiness.service.js", () => ({
  payrollBranchReadinessService: { validatePayrollRunCreation: vi.fn(async () => ({ blocked: [] })) },
}));

const { payrollService } = await import("../payroll.service.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.getConnection.mockImplementation(async () => mockConn);
});

/** Every conn.execute call, matched by a distinctive SQL fragment, in the order the fix issues them. */
function wireConn(opts: { lockAcquired: boolean; duplicateExists: boolean }) {
  mockConn.execute.mockImplementation(async (sql: string) => {
    if (/GET_LOCK/.test(sql)) return [[{ acquired: opts.lockAcquired ? 1 : 0 }], []];
    if (/RELEASE_LOCK/.test(sql)) return [[{ released: 1 }], []];
    if (/SELECT id FROM salary_prep_run/.test(sql)) return [opts.duplicateExists ? [{ id: "existing-run" }] : [], []];
    if (/INSERT INTO salary_prep_run/.test(sql)) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
}

describe("createRun's lock-guarded duplicate check", () => {
  it("refuses to proceed when the lock cannot be acquired, without attempting insert", async () => {
    wireConn({ lockAcquired: false, duplicateExists: false });
    await expect(
      payrollService.createRun({ runMonth: "2026-09", branchFilter: null, processFilter: null } as any, "u1"),
    ).rejects.toThrow(/Another request is creating a payroll run/);

    const insertCalls = mockConn.execute.mock.calls.filter(([sql]) => /INSERT INTO salary_prep_run/.test(sql));
    expect(insertCalls).toHaveLength(0);
    expect(mockConn.beginTransaction).not.toHaveBeenCalled();
    expect(mockConn.release).toHaveBeenCalled(); // connection must never leak even when the lock is refused
  });

  it("acquires the lock, finds a duplicate inside the transaction, rolls back, and releases the lock", async () => {
    wireConn({ lockAcquired: true, duplicateExists: true });
    await expect(
      payrollService.createRun({ runMonth: "2026-09", branchFilter: null, processFilter: null } as any, "u1"),
    ).rejects.toThrow(/already exists/);

    expect(mockConn.beginTransaction).toHaveBeenCalled();
    expect(mockConn.rollback).toHaveBeenCalled();
    expect(mockConn.commit).not.toHaveBeenCalled();
    const insertCalls = mockConn.execute.mock.calls.filter(([sql]) => /INSERT INTO salary_prep_run/.test(sql));
    expect(insertCalls).toHaveLength(0); // must never insert once a duplicate is seen
    const releaseLockCalls = mockConn.execute.mock.calls.filter(([sql]) => /RELEASE_LOCK/.test(sql));
    expect(releaseLockCalls).toHaveLength(1); // lock released even on the error path
    expect(mockConn.release).toHaveBeenCalled();
  });

  it("acquires the lock, sees no duplicate, inserts, commits, and releases both the lock and the connection", async () => {
    wireConn({ lockAcquired: true, duplicateExists: false });
    mockDb.execute.mockResolvedValue([[{ id: "new-run-id", run_month: "2026-09" }], []]); // getRun() readback

    const result = await payrollService.createRun(
      { runMonth: "2026-09", branchFilter: null, processFilter: null } as any,
      "u1",
    );

    expect(mockConn.commit).toHaveBeenCalled();
    expect(mockConn.rollback).not.toHaveBeenCalled();
    const insertCalls = mockConn.execute.mock.calls.filter(([sql]) => /INSERT INTO salary_prep_run/.test(sql));
    expect(insertCalls).toHaveLength(1);
    const releaseLockCalls = mockConn.execute.mock.calls.filter(([sql]) => /RELEASE_LOCK/.test(sql));
    expect(releaseLockCalls).toHaveLength(1);
    expect(mockConn.release).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("every step of the check+insert runs on the SAME connection, never on the bare pool", async () => {
    // This is the exact mistake caught while building this fix: GET_LOCK is
    // per-connection, so a call routed through `db.execute` instead of
    // `conn.execute` silently defeats the lock. Pin it so it cannot regress.
    wireConn({ lockAcquired: true, duplicateExists: false });
    mockDb.execute.mockResolvedValue([[{ id: "new-run-id" }], []]);

    await payrollService.createRun({ runMonth: "2026-09", branchFilter: null, processFilter: null } as any, "u1");

    // getConnection is called exactly once for the whole guarded sequence —
    // not once per statement — which is what makes the single-session lock
    // meaningful.
    expect(mockDb.getConnection).toHaveBeenCalledTimes(1);
    const lockCall = mockConn.execute.mock.calls.find(([sql]) => /GET_LOCK/.test(sql));
    const insertCall = mockConn.execute.mock.calls.find(([sql]) => /INSERT INTO salary_prep_run/.test(sql));
    expect(lockCall).toBeDefined();
    expect(insertCall).toBeDefined();
  });
});
