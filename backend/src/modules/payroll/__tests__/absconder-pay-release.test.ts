/**
 * Absconder pay hold, pinned.
 *   - Paid as normal by default. The reporting manager REQUESTS; only the branch Payroll HR approves,
 *     rejects, places directly and releases. Branch Head and Payroll Head have no part.
 *   - Nothing changes (no recalc) on a request; the days change when Payroll HR approves or releases.
 *   - Release records the route once: payroll when an open run was recalculated, otherwise F&F.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, recalc, holdCfg, isHeld, roleHolders } = vi.hoisted(() => ({
  execute: vi.fn(), recalc: vi.fn(),
  holdCfg: vi.fn(async () => ({ enabled: true })), isHeld: vi.fn(async () => false),
  roleHolders: vi.fn(async () => [] as string[]),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../payroll-targeted-recalculation.service.js", () => ({
  recalculateOpenPayrollForEmployee: recalc,
  isRunSignedOff: (r: { status?: unknown }) => String(r.status ?? "").toLowerCase() === "approved",
}));
vi.mock("../absconder-hold.service.js", () => ({ absconderHoldConfig: holdCfg, isAbsconderPayHeld: isHeld }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn(async () => undefined), resolveItems: vi.fn(async () => undefined) } }));
vi.mock("../noc.notifications.js", () => ({ branchOnlyRoleHolders: roleHolders }));

const svc = await import("../absconder-pay-release.service.js");

const base = {
  id: "x1", employee_id: "e1", branch_id: "b1", employee_code: "MAS1", employee_name: "A B",
  last_working_day: "2026-10-05", pay_hold_requested_at: null, pay_hold_requested_by: null, pay_hold_requested_reason: null,
  pay_hold_at: null, pay_hold_released_at: null, pay_release_route: null, reporting_manager_user_id: "rm",
  exit_type: "involuntary", exit_sub_type: "absconding", status: "exited",
};
let exit: Record<string, unknown> = { ...base };
let runRows: Record<string, Array<Record<string, unknown>>> = {};
let lastEvent: { action: string; reason: string | null; created_at: string } | null = null;
const writes: string[] = [];
const reason = "salary withheld pending recovery of company property";

beforeEach(() => {
  execute.mockReset(); recalc.mockReset(); writes.length = 0; exit = { ...base }; lastEvent = null; runRows = {};
  holdCfg.mockResolvedValue({ enabled: true }); isHeld.mockResolvedValue(false); roleHolders.mockResolvedValue([]);
  recalc.mockResolvedValue({ status: "recalculated", runId: "r1", message: "" });
  execute.mockImplementation(async (sql: string, params?: string[]) => {
    const q = String(sql);
    if (q.includes("FROM exit_request er") && q.includes("JOIN employees e")) return [[exit]];
    if (q.includes("FROM absconder_pay_release_event")) return [lastEvent ? [lastEvent] : []];
    if (q.includes("FROM salary_prep_run spr")) return [runRows[String(params?.[1] ?? "")] ?? []];
    writes.push(q);
    return [{ affectedRows: 1 }];
  });
});

describe("release impact on closed months", () => {
  const held = { pay_hold_requested_at: "2026-10-06", pay_hold_at: "2026-10-07" };
  it("lists the months whose every run is closed or signed off (last worked 2026-10-05 -> checks Oct, Sep, Aug)", async () => {
    exit = { ...base, ...held };
    runRows = { "2026-10": [{ status: "processing" }], "2026-09": [{ status: "FINALIZED" }], "2026-08": [{ status: "approved" }, { status: "locked" }] };
    expect((await svc.getHoldState("x1")).releaseImpact.closedMonths).toEqual(["2026-09", "2026-08"]);
  });
  it("a month with one open run is not closed; a month with no run line is not listed", async () => {
    exit = { ...base, ...held };
    runRows = { "2026-10": [{ status: "FINALIZED" }, { status: "processing" }] };
    expect((await svc.getHoldState("x1")).releaseImpact.closedMonths).toEqual([]);
  });
  it("only asks while held (nothing to warn about otherwise)", async () => {
    runRows = { "2026-10": [{ status: "FINALIZED" }] };
    expect((await svc.getHoldState("x1")).releaseImpact.closedMonths).toEqual([]);
  });
});

describe("state", () => {
  it("is not_held by default (paid as normal)", async () => { expect((await svc.getHoldState("x1")).state).toBe("not_held"); });
  it("is hold_requested after the manager asks", async () => {
    exit = { ...base, pay_hold_requested_at: "2026-10-06" };
    expect((await svc.getHoldState("x1")).state).toBe("hold_requested");
  });
  it("is held once Payroll HR approved, and released after", async () => {
    exit = { ...base, pay_hold_requested_at: "2026-10-06", pay_hold_at: "2026-10-07" };
    expect((await svc.getHoldState("x1")).state).toBe("held");
    exit = { ...exit, pay_hold_released_at: "2026-10-09" };
    expect((await svc.getHoldState("x1")).state).toBe("released");
  });
  it("shows a declined request", async () => {
    lastEvent = { action: "hold_request_rejected", reason: "x", created_at: "2026-10-07" };
    expect((await svc.getHoldState("x1")).state).toBe("request_rejected");
  });
});

describe("request (reporting manager only)", () => {
  it("is refused while the feature is off", async () => {
    holdCfg.mockResolvedValue({ enabled: false });
    await expect(svc.requestHold({ exitRequestId: "x1", reason, actorUserId: "rm" })).rejects.toMatchObject({ code: "HOLD_FEATURE_OFF" });
  });
  it("needs a real reason", async () => {
    await expect(svc.requestHold({ exitRequestId: "x1", reason: "no", actorUserId: "rm" })).rejects.toMatchObject({ code: "HOLD_REASON_REQUIRED" });
  });
  it("only for a live absconding exit", async () => {
    exit = { ...base, exit_sub_type: "resignation", exit_type: "voluntary" };
    await expect(svc.requestHold({ exitRequestId: "x1", reason, actorUserId: "rm" })).rejects.toMatchObject({ code: "HOLD_NOT_ABSCONDING" });
    exit = { ...base, status: "revoked" };
    await expect(svc.requestHold({ exitRequestId: "x1", reason, actorUserId: "rm" })).rejects.toMatchObject({ code: "HOLD_NOT_ABSCONDING" });
  });
  it("is refused for anyone but the reporting manager (not the Branch Head, not Payroll HR)", async () => {
    roleHolders.mockResolvedValue(["pr"]);
    await expect(svc.requestHold({ exitRequestId: "x1", reason, actorUserId: "bh" })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    await expect(svc.requestHold({ exitRequestId: "x1", reason, actorUserId: "pr" })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
  });
  it("records the request and changes nothing in payroll", async () => {
    await svc.requestHold({ exitRequestId: "x1", reason, actorUserId: "rm" });
    expect(writes.some((w) => w.includes("pay_hold_requested_at = NOW()"))).toBe(true);
    expect(recalc).not.toHaveBeenCalled();
  });
  it("cannot request twice or while already held", async () => {
    exit = { ...base, pay_hold_requested_at: "2026-10-06" };
    await expect(svc.requestHold({ exitRequestId: "x1", reason, actorUserId: "rm" })).rejects.toMatchObject({ code: "HOLD_ALREADY_REQUESTED" });
    exit = { ...base, pay_hold_at: "2026-10-07" };
    await expect(svc.requestHold({ exitRequestId: "x1", reason, actorUserId: "rm" })).rejects.toMatchObject({ code: "HOLD_ALREADY_PLACED" });
  });
});

describe("Payroll HR decides", () => {
  beforeEach(() => { exit = { ...base, pay_hold_requested_at: "2026-10-06", pay_hold_requested_reason: "left, laptop missing" }; });

  it("only the branch Payroll HR may approve", async () => {
    await expect(svc.approveHoldRequest({ exitRequestId: "x1", reason, actorUserId: "bh" })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    await expect(svc.approveHoldRequest({ exitRequestId: "x1", reason, actorUserId: "rm" })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    expect(recalc).not.toHaveBeenCalled();
  });
  it("approval makes the days 0 now (recalculates open runs)", async () => {
    roleHolders.mockResolvedValue(["pr"]);
    await svc.approveHoldRequest({ exitRequestId: "x1", reason, actorUserId: "pr" });
    expect(writes.some((w) => w.includes("pay_hold_at = NOW()"))).toBe(true);
    expect(recalc).toHaveBeenCalled();
  });
  it("approval needs a pending request", async () => {
    roleHolders.mockResolvedValue(["pr"]);
    exit = { ...base };
    await expect(svc.approveHoldRequest({ exitRequestId: "x1", reason, actorUserId: "pr" })).rejects.toMatchObject({ code: "HOLD_NOT_REQUESTED" });
  });
  it("rejection needs a reason, clears the request, and leaves salary as normal", async () => {
    roleHolders.mockResolvedValue(["pr"]);
    await expect(svc.rejectHoldRequest({ exitRequestId: "x1", reason: "no", actorUserId: "pr" })).rejects.toMatchObject({ code: "HOLD_REASON_REQUIRED" });
    await svc.rejectHoldRequest({ exitRequestId: "x1", reason, actorUserId: "pr" });
    expect(writes.some((w) => w.includes("pay_hold_requested_at = NULL"))).toBe(true);
    expect(recalc).not.toHaveBeenCalled();
  });
  it("Payroll HR can place a hold directly, nobody else", async () => {
    exit = { ...base };
    await expect(svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "rm" })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    roleHolders.mockResolvedValue(["pr"]);
    expect((await svc.placeHold({ exitRequestId: "x1", reason, actorUserId: "pr" })).role).toBe("branch_payroll_hr");
    expect(recalc).toHaveBeenCalled();
  });
});

describe("release (branch Payroll HR only)", () => {
  beforeEach(() => { exit = { ...base, pay_hold_requested_at: "2026-10-06", pay_hold_at: "2026-10-07" }; roleHolders.mockResolvedValue(["pr"]); });

  it("is refused for the Branch Head, the Payroll Head and the manager", async () => {
    for (const who of ["bh", "ph", "rm"]) {
      await expect(svc.releaseHold({ exitRequestId: "x1", reason, actorUserId: who })).rejects.toMatchObject({ code: "HOLD_NOT_YOUR_CALL" });
    }
  });
  it("needs a placed hold, once", async () => {
    exit = { ...base };
    await expect(svc.releaseHold({ exitRequestId: "x1", reason, actorUserId: "pr" })).rejects.toMatchObject({ code: "HOLD_NOT_PLACED" });
    exit = { ...base, pay_hold_at: "2026-10-07", pay_hold_released_at: "2026-10-09" };
    await expect(svc.releaseHold({ exitRequestId: "x1", reason, actorUserId: "pr" })).rejects.toMatchObject({ code: "HOLD_ALREADY_RELEASED" });
  });
  it("routes through payroll when an open run was recalculated", async () => {
    const r = await svc.releaseHold({ exitRequestId: "x1", reason, actorUserId: "pr" });
    expect(r).toMatchObject({ route: "payroll", openRunRecalculated: true });
    expect(writes.some((w) => w.includes("pay_hold_released_at = NOW()"))).toBe(true);
    expect(writes.some((w) => w.includes("pay_release_route"))).toBe(true);
  });
  it("routes through F&F when no open run could be recalculated", async () => {
    recalc.mockResolvedValue({ status: "no_open_run", runId: null, message: "" });
    expect(await svc.releaseHold({ exitRequestId: "x1", reason, actorUserId: "pr" })).toMatchObject({ route: "fnf", openRunRecalculated: false });
  });
});
