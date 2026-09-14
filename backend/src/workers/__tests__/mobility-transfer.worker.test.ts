/**
 * Future-dated transfers were approved and then never applied: applyPendingTransfers()
 * existed but nothing called it — no route, no worker, no cron. Immediate transfers
 * (effective_date <= today) apply inline at approval and always worked; anything post-dated
 * did not.
 *
 * Business decision 2026-08-15 (Option A): approved does NOT mean applied. The employee
 * moves ON the effective date, so rosters, approval routing and payroll scope stay correct
 * until then. This worker is what makes that true.
 *
 * What is pinned here is the safety that makes scheduling it acceptable — a daily job that
 * bulk-mutates employee master rows must not double-apply, and must not mark a transfer done
 * when the move failed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = { execute: vi.fn() };
vi.mock("../../db/mysql.js", () => ({ db: mockDb }));

// Deliberately NOT mocking applyTransferToEmployee: applyPendingTransfers calls it through
// the module's own `mobilityService` object, so a module mock would not intercept it. The
// real apply runs here against the mocked db, which also exercises the employee UPDATE.
const { mobilityService } = await import("../../modules/mobility/mobility.service.js");
const { millisecondsUntilNextTransferSweep } = await import("../mobility-transfer.worker.js");

const PENDING = [{ id: "t-1", employee_id: "e-1", transfer_type: "branch", to_value: "Gurgaon" }];

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * SELECT returns pending rows; the claim UPDATE returns the given affectedRows.
 * `branchFound` decides whether the real applyTransferToEmployee succeeds or throws.
 */
function arrange(claimAffected: number, branchFound = true, pending = PENDING) {
  mockDb.execute.mockImplementation(async (sql: string) => {
    if (/SELECT id, employee_id/.test(sql)) return [pending, []];
    if (/FROM branch_master/.test(sql)) return [branchFound ? [{ id: "br-9" }] : [], []];
    if (/SET applied_at = NOW\(\)/.test(sql)) return [{ affectedRows: claimAffected }, []];
    return [{ affectedRows: 1 }, []];
  });
}

describe("a deferred transfer is claimed before the employee is moved", () => {
  it("claims with an expected-state UPDATE and only then applies", async () => {
    arrange(1);
    const applied = await mobilityService.applyPendingTransfers();

    expect(applied).toBe(1);
    const claim = mockDb.execute.mock.calls.find((c: any[]) => /SET applied_at = NOW\(\)/.test(String(c[0])));
    expect(String(claim![0])).toMatch(/WHERE id = \? AND applied_at IS NULL/);
    // the employee master really was moved
    const move = mockDb.execute.mock.calls.find((c: any[]) => /UPDATE employees SET branch_id/.test(String(c[0])));
    expect(move![1]).toEqual(["br-9", "e-1"]);
  });

  it("skips the row when another run already claimed it — no double move", async () => {
    arrange(0);
    const applied = await mobilityService.applyPendingTransfers();

    expect(applied).toBe(0);
    const move = mockDb.execute.mock.calls.find((c: any[]) => /UPDATE employees SET branch_id/.test(String(c[0])));
    expect(move).toBeUndefined();
  });
});

describe("a failed apply is retried, not silently marked done", () => {
  it("releases the claim so the next run picks it up", async () => {
    arrange(1, /* branchFound */ false);

    const applied = await mobilityService.applyPendingTransfers();

    expect(applied).toBe(0);
    const release = mockDb.execute.mock.calls.find((c: any[]) =>
      /SET applied_at = NULL/.test(String(c[0])),
    );
    expect(release).toBeDefined();
    expect(release![1]).toEqual(["t-1"]);
  });
});

describe("the sweep runs after midnight, so an effective_date of today is due", () => {
  it("schedules for 01:00 the next time that hour comes round", () => {
    const at0000 = millisecondsUntilNextTransferSweep(new Date("2026-08-16T00:00:00"));
    expect(at0000).toBe(60 * 60 * 1000);

    const at0200 = millisecondsUntilNextTransferSweep(new Date("2026-08-16T02:00:00"));
    expect(at0200).toBe(23 * 60 * 60 * 1000);
  });
});
