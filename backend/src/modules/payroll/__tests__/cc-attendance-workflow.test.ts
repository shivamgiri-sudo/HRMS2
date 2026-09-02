/**
 * The cost-centre attendance sign-off chain is a three-stage approval over data that decides what
 * people are paid for, so the guards that matter are the ones that are invisible when they work:
 *
 *  - a stage can only be cleared from the stage before it (no skipping Branch Head);
 *  - the same human cannot clear two stages, however many roles they hold;
 *  - a concurrent transition loses rather than silently overwriting;
 *  - an unlock reopens a NEW cycle instead of editing the approved one away;
 *  - reasons are mandatory where the audit trail depends on them.
 *
 * These are exercised against a mocked pool, so they assert the service's own decisions rather
 * than MySQL's. The read path (day counts, cost-centre grouping) is verified separately against
 * the live database, where a mock would prove nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const query = vi.fn();
const connection = {
  execute,
  query,
  beginTransaction: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  rollback: vi.fn(async () => {}),
  release: vi.fn(() => {}),
};

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute,
    query,
    getConnection: async () => connection,
  },
}));
vi.mock("../weekoff-eligibility.service.js", () => ({
  calculateWeekoffEligibility: async () => 4,
}));
vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent: vi.fn(async () => {}),
  listFinanceApprovalEvents: vi.fn(async () => []),
}));

const svc = await import("../payroll-cc-attendance.service.js");
const { recordFinanceApprovalEvent } = await import("../../../shared/financeApprovalEvent.js");

const MONTH = "2026-08";
const BRANCH = "branch-1";
const CC = "cc-1";
const HR = { userId: "user-hr", role: "payroll_hr" };
const BRANCH_HEAD = { userId: "user-bh", role: "branch_head" };
const PAYROLL_HEAD = { userId: "user-ph", role: "payroll_head" };

/** A finalization row in a given state, as findFinalization() would return it. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "fin-1",
    process_month: MONTH,
    branch_id: BRANCH,
    cost_centre_id: CC,
    status: "hr_finalized",
    cycle_no: 1,
    hr_finalized_by: HR.userId,
    branch_head_approved_by: null,
    ho_approved_by: null,
    ...over,
  };
}

/**
 * Routes every statement the service issues. `finalizationRow` is what a SELECT of the
 * finalization returns; `updateAffected` is what the guarded UPDATE reports back, which is how a
 * lost race is simulated.
 */
function installMock(opts: {
  finalizationRow?: Record<string, unknown> | null;
  unlockRequestRow?: Record<string, unknown> | null;
  updateAffected?: number;
}) {
  const impl = async (sql: string) => {
    const s = String(sql);
    if (s.includes("CREATE TABLE")) return [{}, []];
    if (s.includes("FROM payroll_cc_attendance_unlock_request")) {
      return [opts.unlockRequestRow ? [opts.unlockRequestRow] : [], []];
    }
    if (s.includes("FROM payroll_cc_attendance_finalization")) {
      return [opts.finalizationRow ? [opts.finalizationRow] : [], []];
    }
    if (s.startsWith("UPDATE") || s.includes("UPDATE payroll_cc_attendance")) {
      return [{ affectedRows: opts.updateAffected ?? 1 }, []];
    }
    if (s.includes("INSERT")) return [{ affectedRows: 1 }, []];
    if (s.includes("DELETE")) return [{ affectedRows: 0 }, []];
    if (s.includes("FROM cost_centre_master")) return [[{ cost_centre_name: "CC One" }], []];
    return [[], []];
  };
  execute.mockImplementation(impl);
  query.mockImplementation(impl);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stage order", () => {
  it("refuses HO approval on a packet the Branch Head has not approved", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized" }) });
    await expect(svc.approve("ho", MONTH, BRANCH, CC, PAYROLL_HEAD)).rejects.toMatchObject({
      status: 409,
      code: "CC_ATT_WRONG_STAGE",
    });
  });

  it("refuses Branch Head approval on a packet nobody has finalized", async () => {
    installMock({ finalizationRow: null });
    await expect(svc.approve("branch", MONTH, BRANCH, CC, BRANCH_HEAD)).rejects.toMatchObject({
      status: 404,
      code: "CC_ATT_NOT_FOUND",
    });
  });

  it("accepts Branch Head approval from hr_finalized", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized" }) });
    const res = await svc.approve("branch", MONTH, BRANCH, CC, BRANCH_HEAD);
    expect(res.status).toBe("branch_head_approved");
  });

  it("accepts HO approval from branch_head_approved", async () => {
    installMock({
      finalizationRow: row({ status: "branch_head_approved", branch_head_approved_by: BRANCH_HEAD.userId }),
    });
    const res = await svc.approve("ho", MONTH, BRANCH, CC, PAYROLL_HEAD);
    expect(res.status).toBe("ho_approved");
  });
});

describe("maker-checker", () => {
  it("blocks the person who finalized from approving it as Branch Head", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized", hr_finalized_by: "same-person" }) });
    await expect(
      svc.approve("branch", MONTH, BRANCH, CC, { userId: "same-person", role: "branch_head" })
    ).rejects.toMatchObject({ status: 409, code: "CC_ATT_MAKER_CHECKER" });
  });

  it("blocks regardless of which role the JWT presents, when the user also holds payroll_hr", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized", hr_finalized_by: "dual-hat" }) });
    await expect(
      svc.approve("branch", MONTH, BRANCH, CC, {
        userId: "dual-hat",
        role: "branch_head",
        roles: ["branch_head", "payroll_hr"],
      })
    ).rejects.toMatchObject({ code: "CC_ATT_MAKER_CHECKER" });
  });

  it("blocks the Branch Head approver from also giving HO approval", async () => {
    installMock({
      finalizationRow: row({
        status: "branch_head_approved",
        hr_finalized_by: HR.userId,
        branch_head_approved_by: "both-hats",
      }),
    });
    await expect(
      svc.approve("ho", MONTH, BRANCH, CC, { userId: "both-hats", role: "payroll_head" })
    ).rejects.toMatchObject({ code: "CC_ATT_MAKER_CHECKER" });
  });

  it("exempts super_admin, the documented break-glass role", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized", hr_finalized_by: "root" }) });
    const res = await svc.approve("branch", MONTH, BRANCH, CC, {
      userId: "root",
      role: "super_admin",
    });
    expect(res.status).toBe("branch_head_approved");
  });
});

describe("concurrency", () => {
  it("refuses when the guarded UPDATE matches no row, rather than reporting success", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized" }), updateAffected: 0 });
    await expect(svc.approve("branch", MONTH, BRANCH, CC, BRANCH_HEAD)).rejects.toMatchObject({
      status: 409,
      code: "CC_ATT_STATE_CHANGED",
    });
    expect(connection.rollback).toHaveBeenCalled();
  });
});

describe("send back", () => {
  it("requires a reason", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized" }) });
    await expect(svc.sendBack("branch", MONTH, BRANCH, CC, BRANCH_HEAD, "   ")).rejects.toMatchObject({
      status: 400,
      code: "CC_ATT_REASON_REQUIRED",
    });
  });

  it("returns the packet to unprocessed so it must be finalized again", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized" }) });
    const res = await svc.sendBack("branch", MONTH, BRANCH, CC, BRANCH_HEAD, "Two regularizations still open");
    expect(res.status).toBe("unprocessed");
  });
});

describe("unlock", () => {
  it("is only available once the HO has approved", async () => {
    installMock({ finalizationRow: row({ status: "branch_head_approved" }) });
    await expect(
      svc.requestUnlock(MONTH, BRANCH, CC, "A late leave approval landed", HR)
    ).rejects.toMatchObject({ status: 409, code: "CC_ATT_NOT_APPROVED" });
  });

  it("refuses a reason too short to be an audit trail", async () => {
    installMock({ finalizationRow: row({ status: "ho_approved" }) });
    await expect(svc.requestUnlock(MONTH, BRANCH, CC, "oops", HR)).rejects.toMatchObject({
      status: 400,
      code: "CC_ATT_UNLOCK_REASON_REQUIRED",
    });
  });

  it("moves an approved packet to unlock_requested", async () => {
    installMock({ finalizationRow: row({ status: "ho_approved" }) });
    const res = await svc.requestUnlock(MONTH, BRANCH, CC, "A late leave approval landed", HR);
    expect(res.status).toBe("unlock_requested");
  });

  it("blocks the requester from reviewing their own unlock request", async () => {
    installMock({
      unlockRequestRow: {
        id: "req-1", finalization_id: "fin-1", cycle_no: 1, status: "pending",
        requested_by: "self", process_month: MONTH, branch_id: BRANCH, cost_centre_id: CC,
      },
    });
    await expect(
      svc.reviewUnlock("req-1", "approve", { userId: "self", role: "payroll_head" })
    ).rejects.toMatchObject({ code: "CC_ATT_MAKER_CHECKER" });
  });

  it("granting an unlock reopens the packet at unprocessed and bumps the cycle", async () => {
    installMock({
      unlockRequestRow: {
        id: "req-1", finalization_id: "fin-1", cycle_no: 1, status: "pending",
        requested_by: HR.userId, process_month: MONTH, branch_id: BRANCH, cost_centre_id: CC,
      },
    });
    const res = await svc.reviewUnlock("req-1", "approve", PAYROLL_HEAD, "Approved, correct and resubmit");
    expect(res.status).toBe("approved");
    expect(res.finalizationStatus).toBe("unprocessed");
    const sql = execute.mock.calls.map((c) => String(c[0])).join("\n");
    expect(sql).toMatch(/cycle_no = cycle_no \+ 1/);
    // The previous cycle's snapshot rows and events must survive the reopen.
    expect(sql).not.toMatch(/DELETE FROM payroll_cc_attendance_line/);
  });

  it("refusing an unlock leaves the packet approved", async () => {
    installMock({
      unlockRequestRow: {
        id: "req-1", finalization_id: "fin-1", cycle_no: 1, status: "pending",
        requested_by: HR.userId, process_month: MONTH, branch_id: BRANCH, cost_centre_id: CC,
      },
    });
    const res = await svc.reviewUnlock("req-1", "reject", PAYROLL_HEAD, "Raise it in next month's cycle");
    expect(res.finalizationStatus).toBe("ho_approved");
  });

  it("requires a reason to refuse", async () => {
    installMock({
      unlockRequestRow: { id: "req-1", finalization_id: "fin-1", status: "pending", requested_by: HR.userId },
    });
    await expect(svc.reviewUnlock("req-1", "reject", PAYROLL_HEAD)).rejects.toMatchObject({
      status: 400,
      code: "CC_ATT_REJECT_REASON_REQUIRED",
    });
  });

  it("refuses a request that has already been decided", async () => {
    installMock({
      unlockRequestRow: { id: "req-1", finalization_id: "fin-1", status: "approved", requested_by: HR.userId },
    });
    await expect(svc.reviewUnlock("req-1", "approve", PAYROLL_HEAD)).rejects.toMatchObject({
      code: "CC_ATT_UNLOCK_WRONG_STAGE",
    });
  });
});

describe("audit", () => {
  it("writes an approval event inside the same connection as the transition", async () => {
    installMock({ finalizationRow: row({ status: "hr_finalized" }) });
    await svc.approve("branch", MONTH, BRANCH, CC, BRANCH_HEAD);
    expect(recordFinanceApprovalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "payroll_cc_attendance",
        fromStatus: "hr_finalized",
        toStatus: "branch_head_approved",
        actorRole: "branch_head",
      }),
      connection
    );
  });
});

describe("month handling", () => {
  it("rejects anything that is not YYYY-MM, since run_month is a VARCHAR and a bad value matches nothing", async () => {
    installMock({});
    await expect(svc.approve("branch", "2026-08-01", BRANCH, CC, BRANCH_HEAD)).rejects.toMatchObject({
      code: "CC_ATT_BAD_MONTH",
    });
  });
});
