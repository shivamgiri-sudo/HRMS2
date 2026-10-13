/**
 * Absconder pay release workflow, pinned.
 *   - Payroll Head cannot decide before the Branch Head approved (enforced by the existing chain).
 *   - A rejection needs a real reason, is recorded, and does NOT lift the hold.
 *   - Re-request only after a rejection, and clears the stale Branch Head approval.
 *   - Approval records the route once: payroll when an open run was recalculated, otherwise F&F.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, grant, bhRecord, recalc, holdCfg, isHeld, roleHolders, branchHeads } = vi.hoisted(() => ({
  execute: vi.fn(), grant: vi.fn(), bhRecord: vi.fn(), recalc: vi.fn(),
  holdCfg: vi.fn(async () => ({ enabled: true })), isHeld: vi.fn(async () => true),
  roleHolders: vi.fn(async () => [] as string[]), branchHeads: vi.fn(async () => [] as string[]),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../exit/ff-settlement-gate.service.js", () => ({ grantAbscondingFfException: grant, recordBranchHeadFfException: bhRecord }));
vi.mock("../payroll-targeted-recalculation.service.js", () => ({ recalculateOpenPayrollForEmployee: recalc }));
vi.mock("../absconder-hold.service.js", () => ({ absconderHoldConfig: holdCfg, isAbsconderPayHeld: isHeld }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn(async () => undefined), resolveItems: vi.fn(async () => undefined) } }));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds: vi.fn(async () => []) }));
vi.mock("../noc.notifications.js", () => ({ branchHeadUserIds: branchHeads, branchOnlyRoleHolders: roleHolders }));

const svc = await import("../absconder-pay-release.service.js");

const exitRow = (over: Record<string, unknown> = {}) => ({
  id: "x1", employee_id: "e1", branch_id: "b1", employee_code: "MAS1", employee_name: "A B",
  absconding_since: "2026-10-05", last_working_day: "2026-10-05",
  ff_exception_bh_at: null, ff_exception_at: null, pay_release_route: null,
  pay_hold_at: null, exit_type: "involuntary", exit_sub_type: "absconding", status: "exited", ...over,
});
let managerRows: unknown[] = [];
let exit = exitRow();
let lastEvent: { action: string; reason: string | null; created_at: string } | null = null;
const writes: string[] = [];

beforeEach(() => {
  execute.mockReset(); grant.mockReset(); bhRecord.mockReset(); recalc.mockReset(); writes.length = 0;
  exit = exitRow({ pay_hold_at: "2026-10-05" }); lastEvent = null; managerRows = []; holdCfg.mockResolvedValue({ enabled: true }); isHeld.mockResolvedValue(true);
  roleHolders.mockResolvedValue([]); branchHeads.mockResolvedValue([]);
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("JOIN employees m ON m.id")) return [managerRows];
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
  it("is not_held when no hold is placed (paid as normal)", async () => {
    isHeld.mockResolvedValue(false);
    expect((await svc.getReleaseState("x1")).state).toBe("not_held");
  });
});

describe("placing and withdrawing a hold (default is: paid as normal)", () => {
  beforeEach(() => { exit = exitRow(); });
  const reason = "salary withheld pending recovery of company property";

  it("is refused while the feature is off", async () => {
    holdCfg.mockResolvedValue({ enabled: false });
    await expect(svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "u" })).rejects.toMatchObject({ code: "HOLD_FEATURE_OFF" });
  });
  it("needs a real reason", async () => {
    await expect(svc.placeHold({ exitRequestId: "x1", reason: "no", actorUserId: "u" })).rejects.toMatchObject({ code: "HOLD_REASON_REQUIRED" });
  });
  it("only applies to a live absconding exit", async () => {
    exit = exitRow({ exit_sub_type: "resignation", exit_type: "voluntary" });
    await expect(svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "u" })).rejects.toMatchObject({ code: "HOLD_NOT_ABSCONDING" });
    exit = exitRow({ status: "revoked" });
    await expect(svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "u" })).rejects.toMatchObject({ code: "HOLD_NOT_ABSCONDING" });
  });
  it("is refused for anyone who is not the reporting manager, branch Payroll HR or Branch Head", async () => {
    await expect(svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "stranger" })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    expect(recalc).not.toHaveBeenCalled();
  });
  it("the reporting manager can hold, which logs it and drops open lines to 0", async () => {
    managerRows = [{ 1: 1 }];
    expect(await svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "rm" })).toEqual({ role: "reporting_manager" });
    expect(writes.some((w) => w.includes("pay_hold_at = NOW()"))).toBe(true);
    expect(writes.some((w) => w.includes("INSERT INTO absconder_pay_release_event"))).toBe(true);
    expect(recalc).toHaveBeenCalled();
  });
  it("the branch Payroll HR can hold", async () => {
    roleHolders.mockResolvedValue(["pr"]);
    expect((await svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "pr" })).role).toBe("branch_payroll_hr");
  });
  it("the Branch Head can hold", async () => {
    branchHeads.mockResolvedValue(["bh"]);
    expect((await svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "bh" })).role).toBe("branch_head");
  });
  it("cannot hold twice, or after the pay was released", async () => {
    branchHeads.mockResolvedValue(["bh"]);
    exit = exitRow({ pay_hold_at: "2026-10-05" });
    await expect(svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "bh" })).rejects.toMatchObject({ code: "HOLD_ALREADY_PLACED" });
    exit = exitRow({ ff_exception_at: "2026-10-07" });
    await expect(svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "bh" })).rejects.toMatchObject({ code: "HOLD_ALREADY_RELEASED" });
  });
  it("withdrawing clears the hold and restores days, by one of the three only", async () => {
    exit = exitRow({ pay_hold_at: "2026-10-05" });
    await expect(svc.withdrawHold({ exitRequestId: "x1", reason, actorUserId: "stranger" })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    branchHeads.mockResolvedValue(["bh"]);
    await svc.withdrawHold({ exitRequestId: "x1", reason, actorUserId: "bh" });
    expect(writes.some((w) => w.includes("pay_hold_at = NULL"))).toBe(true);
    expect(recalc).toHaveBeenCalled();
  });
  it("withdrawing with no hold placed is refused", async () => {
    exit = exitRow();
    branchHeads.mockResolvedValue(["bh"]);
    await expect(svc.withdrawHold({ exitRequestId: "x1", reason, actorUserId: "bh" })).rejects.toMatchObject({ code: "HOLD_NOT_PLACED" });
  });
});

describe("reject and re-request", () => {
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
    exit = exitRow({ ff_exception_bh_at: "2026-10-06", pay_hold_at: "2026-10-05" });
    const r = await svc.payrollHeadApprove({ exitRequestId: "x1", reason: "legal settlement approved here", actorUserId: "ph" });
    expect(r).toMatchObject({ route: "payroll", openRunRecalculated: true });
    expect(grant).toHaveBeenCalled();
    expect(writes.some((w) => w.includes("pay_release_route"))).toBe(true);
  });
  it("routes through F&F when no open run could be recalculated", async () => {
    recalc.mockResolvedValue({ status: "no_open_run", runId: null, message: "" });
    exit = exitRow({ ff_exception_bh_at: "2026-10-06", pay_hold_at: "2026-10-05" });
    const r = await svc.payrollHeadApprove({ exitRequestId: "x1", reason: "legal settlement approved here", actorUserId: "ph" });
    expect(r).toMatchObject({ route: "fnf", openRunRecalculated: false });
  });
  it("with no hold placed there is nothing to rebuild: no recalculation, no route", async () => {
    exit = exitRow({ ff_exception_bh_at: "2026-10-06", pay_hold_at: null });
    await svc.payrollHeadApprove({ exitRequestId: "x1", reason: "legal settlement approved here", actorUserId: "ph" });
    expect(recalc).not.toHaveBeenCalled();
    expect(writes.some((w) => w.includes("pay_release_route"))).toBe(false);
  });
  it("propagates the chain's refusal (e.g. same approver) and records nothing", async () => {
    grant.mockRejectedValue(Object.assign(new Error("same"), { code: "FF_EXCEPTION_SAME_APPROVER" }));
    await expect(svc.payrollHeadApprove({ exitRequestId: "x1", reason: "legal settlement approved here", actorUserId: "bh" })).rejects.toMatchObject({ code: "FF_EXCEPTION_SAME_APPROVER" });
    expect(writes.some((w) => w.includes("INSERT INTO absconder_pay_release_event"))).toBe(false);
  });
});
