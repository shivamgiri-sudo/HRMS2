/**
 * Absconder pay release workflow, pinned.
 *   - Payroll Head cannot decide before the Branch Head approved (enforced by the existing chain).
 *   - A rejection needs a real reason, is recorded, and does NOT lift the hold.
 *   - Re-request only after a rejection, and clears the stale Branch Head approval.
 *   - Approval records the route once: payroll when an open run was recalculated, otherwise F&F.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, grant, bhRecord, recalc, holdCfg, isHeld } = vi.hoisted(() => ({
  execute: vi.fn(), grant: vi.fn(), bhRecord: vi.fn(), recalc: vi.fn(),
  holdCfg: vi.fn(async () => ({ enabled: true, from: "2026-10-01" })), isHeld: vi.fn(async () => true),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../exit/ff-settlement-gate.service.js", () => ({ grantAbscondingFfException: grant, recordBranchHeadFfException: bhRecord }));
vi.mock("../payroll-targeted-recalculation.service.js", () => ({ recalculateOpenPayrollForEmployee: recalc }));
vi.mock("../absconder-hold.service.js", () => ({ absconderHoldConfig: holdCfg, isAbsconderPayHeld: isHeld }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn(async () => undefined), resolveItems: vi.fn(async () => undefined) } }));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds: vi.fn(async () => []) }));
vi.mock("../noc.notifications.js", () => ({ branchHeadUserIds: vi.fn(async () => []) }));

const svc = await import("../absconder-pay-release.service.js");

const exitRow = (over: Record<string, unknown> = {}) => ({
  id: "x1", employee_id: "e1", branch_id: "b1", employee_code: "MAS1", employee_name: "A B",
  absconding_since: "2026-10-05", last_working_day: "2026-10-05",
  ff_exception_bh_at: null, ff_exception_at: null, pay_release_route: null, ...over,
});
let exit = exitRow();
let lastEvent: { action: string; reason: string | null; created_at: string } | null = null;
const writes: string[] = [];

beforeEach(() => {
  execute.mockReset(); grant.mockReset(); bhRecord.mockReset(); recalc.mockReset(); writes.length = 0;
  exit = exitRow(); lastEvent = null; holdCfg.mockResolvedValue({ enabled: true, from: "2026-10-01" }); isHeld.mockResolvedValue(true);
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM exit_request er JOIN employees")) return [[exit]];
    if (q.includes("FROM absconder_pay_release_event")) return [lastEvent ? [lastEvent] : []];
    writes.push(q);
    return [{ affectedRows: 1 }];
  });
});

describe("state", () => {
  it("awaits the Branch Head first", async () => {
    expect((await svc.getReleaseState("x1")).state).toBe("awaiting_branch_head");
  });
  it("awaits the Payroll Head after the Branch Head", async () => {
    exit = exitRow({ ff_exception_bh_at: "2026-10-06" });
    expect((await svc.getReleaseState("x1")).state).toBe("awaiting_payroll_head");
  });
  it("is released once the Payroll Head step exists", async () => {
    exit = exitRow({ ff_exception_bh_at: "2026-10-06", ff_exception_at: "2026-10-07" });
    expect((await svc.getReleaseState("x1")).state).toBe("released");
  });
  it("shows a rejection and still holds", async () => {
    lastEvent = { action: "ph_rejected", reason: "no", created_at: "2026-10-08" };
    exit = exitRow({ ff_exception_bh_at: "2026-10-06" });
    const s = await svc.getReleaseState("x1");
    expect(s.state).toBe("rejected_by_payroll_head");
    expect(s.held).toBe(true);
  });
  it("is not_held when nothing is held", async () => {
    isHeld.mockResolvedValue(false);
    expect((await svc.getReleaseState("x1")).state).toBe("not_held");
  });
});

describe("request, reject, re-request", () => {
  it("does nothing while the hold is off", async () => {
    holdCfg.mockResolvedValue({ enabled: false, from: null });
    await svc.requestRelease("x1", "u");
    expect(writes.length).toBe(0);
    expect(recalc).not.toHaveBeenCalled();
  });
  it("logs the request and recalculates open lines when on", async () => {
    await svc.requestRelease("x1", "u");
    expect(writes.some((w) => w.includes("INSERT INTO absconder_pay_release_event"))).toBe(true);
    expect(recalc).toHaveBeenCalled();
  });
  it("refuses a short rejection reason", async () => {
    await expect(svc.branchHeadReject({ exitRequestId: "x1", reason: "no", actorUserId: "bh" })).rejects.toMatchObject({ code: "RELEASE_REASON_REQUIRED" });
  });
  it("Payroll Head cannot reject before the Branch Head approved", async () => {
    await expect(svc.payrollHeadReject({ exitRequestId: "x1", reason: "a perfectly good reason", actorUserId: "ph" })).rejects.toMatchObject({ code: "RELEASE_BRANCH_HEAD_PENDING" });
  });
  it("records a rejection and leaves the exit approvals alone", async () => {
    await svc.branchHeadReject({ exitRequestId: "x1", reason: "a perfectly good reason", actorUserId: "bh" });
    expect(writes.some((w) => w.includes("INSERT INTO absconder_pay_release_event"))).toBe(true);
    expect(writes.some((w) => w.includes("UPDATE exit_request"))).toBe(false);
  });
  it("re-request only after a rejection, and it clears the stale Branch Head approval", async () => {
    await expect(svc.reRequest({ exitRequestId: "x1", reason: "new facts have come up here", actorUserId: "hr" })).rejects.toMatchObject({ code: "RELEASE_NOT_REJECTED" });
    lastEvent = { action: "ph_rejected", reason: "x", created_at: "2026-10-08" };
    exit = exitRow({ ff_exception_bh_at: "2026-10-06" });
    await svc.reRequest({ exitRequestId: "x1", reason: "new facts have come up here", actorUserId: "hr" });
    expect(writes.some((w) => w.includes("ff_exception_bh_by = NULL"))).toBe(true);
  });
});

describe("Payroll Head approval", () => {
  it("routes through payroll when an open run was recalculated", async () => {
    recalc.mockResolvedValue({ status: "recalculated", runId: "r1", message: "" });
    exit = exitRow({ ff_exception_bh_at: "2026-10-06" });
    const r = await svc.payrollHeadApprove({ exitRequestId: "x1", reason: "legal settlement approved here", actorUserId: "ph" });
    expect(r).toMatchObject({ route: "payroll", openRunRecalculated: true });
    expect(grant).toHaveBeenCalled();
    expect(writes.some((w) => w.includes("pay_release_route"))).toBe(true);
  });
  it("routes through F&F when no open run could be recalculated", async () => {
    recalc.mockResolvedValue({ status: "no_open_run", runId: null, message: "" });
    exit = exitRow({ ff_exception_bh_at: "2026-10-06" });
    const r = await svc.payrollHeadApprove({ exitRequestId: "x1", reason: "legal settlement approved here", actorUserId: "ph" });
    expect(r).toMatchObject({ route: "fnf", openRunRecalculated: false });
  });
  it("propagates the chain's refusal (e.g. same approver) and records nothing", async () => {
    grant.mockRejectedValue(Object.assign(new Error("same"), { code: "FF_EXCEPTION_SAME_APPROVER" }));
    await expect(svc.payrollHeadApprove({ exitRequestId: "x1", reason: "legal settlement approved here", actorUserId: "bh" })).rejects.toMatchObject({ code: "FF_EXCEPTION_SAME_APPROVER" });
    expect(writes.some((w) => w.includes("INSERT INTO absconder_pay_release_event"))).toBe(false);
  });
});
