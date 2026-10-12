/**
 * F&F settlement gate, pinned.
 *
 *   1. An absconder gets NO settlement without a recorded Payroll Head exception; with one, the
 *      flow is as for anyone else.
 *   2. With the final-approval date switched on, a completed NOC still locks F&F until the
 *      Payroll Head approves; an override unlocks; cases completed before the date are
 *      grandfathered; with the date absent the NOC part is inert.
 *   3. The exception needs a real reason and only applies to an actual absconding exit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../payroll/noc-case.service.js", () => ({ __writeNocEvent: vi.fn() }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn(), resolveItems: vi.fn() } }));
vi.mock("../../../shared/recipient-resolver.js", () => ({ resolveRoleHolderUserIds: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn().mockResolvedValue(undefined) }));

const { ffSettlementGate, grantAbscondingFfException, recordBranchHeadFfException, abscondedWithoutExceptionSql } = await import(
  "../ff-settlement-gate.service.js"
);

interface World {
  er?: Record<string, unknown> | null;
  from?: string | null;
  nc?: Record<string, unknown> | null;
}

function world(w: World) {
  execute.mockImplementation(async (sql?: string) => {
    sql = String(sql ?? "");
    if (sql.includes("FROM exit_request er")) return [w.er ? [w.er] : []];
    if (sql.includes("payroll_config_flags")) return [w.from ? [{ config_value: w.from }] : []];
    if (sql.includes("FROM noc_case")) return [w.nc ? [w.nc] : []];
    if (sql.includes("UPDATE exit_request")) return [{ affectedRows: 1 }];
    return [[]];
  });
}

const leaver = { id: "x1", employee_id: "e1", exit_type: "resignation", exit_sub_type: null, ff_exception_at: null, employment_status: "inactive" };

describe("absconder rule", () => {
  beforeEach(() => execute.mockReset());

  it("blocks an absconding exit with no exception", async () => {
    world({ er: { ...leaver, exit_type: "absconding" } });
    const g = await ffSettlementGate("e1", "x1");
    expect(g).toMatchObject({ allowed: false, code: "ABSCONDED_NO_EXCEPTION" });
  });

  it("blocks on the sub-type and on employment_status as backstops", async () => {
    world({ er: { ...leaver, exit_sub_type: "abandonment" } });
    expect((await ffSettlementGate("e1", "x1")).code).toBe("ABSCONDED_NO_EXCEPTION");
    world({ er: { ...leaver, employment_status: "absconded" } });
    expect((await ffSettlementGate("e1", "x1")).code).toBe("ABSCONDED_NO_EXCEPTION");
  });

  const excepted = { ...leaver, exit_type: "absconding", ff_exception_at: "2026-10-12" };

  it("lets an excepted absconder through only with a signed (completed) NOC", async () => {
    world({ er: excepted, nc: { status: "completed", override_at: null, completed_at: "2026-10-12", payroll_head_approved_at: null } });
    expect((await ffSettlementGate("e1", "x1")).allowed).toBe(true);
  });

  it("keeps an excepted absconder locked while the NOC is not signed", async () => {
    world({ er: excepted, nc: { status: "in_progress", override_at: null, completed_at: null, payroll_head_approved_at: null } });
    expect(await ffSettlementGate("e1", "x1")).toMatchObject({ allowed: false, code: "NOC_INCOMPLETE" });
    world({ er: excepted, nc: null });
    expect((await ffSettlementGate("e1", "x1")).code).toBe("NOC_INCOMPLETE");
  });

  it("does not accept a release override as the signed NOC for an excepted absconder", async () => {
    world({ er: excepted, nc: { status: "in_progress", override_at: "2026-10-12", completed_at: null, payroll_head_approved_at: null } });
    expect((await ffSettlementGate("e1", "x1")).code).toBe("NOC_INCOMPLETE");
  });

  it("applies Payroll Head final approval to an excepted absconder when switched on", async () => {
    world({ er: excepted, from: "2026-10-01", nc: { status: "completed", override_at: null, completed_at: "2026-10-20", payroll_head_approved_at: null } });
    expect((await ffSettlementGate("e1", "x1")).code).toBe("PAYROLL_HEAD_APPROVAL_PENDING");
  });

  it("does not touch an ordinary resignation", async () => {
    world({ er: leaver });
    expect((await ffSettlementGate("e1", "x1")).allowed).toBe(true);
  });
});

describe("Payroll Head final approval", () => {
  beforeEach(() => execute.mockReset());

  it("is inert when the date flag is absent", async () => {
    world({ er: leaver, from: null, nc: { status: "completed", override_at: null, completed_at: "2026-10-20", payroll_head_approved_at: null } });
    expect((await ffSettlementGate("e1", "x1")).allowed).toBe(true);
  });

  it("locks a completed NOC until the Payroll Head approves", async () => {
    world({ er: leaver, from: "2026-10-01", nc: { status: "completed", override_at: null, completed_at: "2026-10-20", payroll_head_approved_at: null } });
    expect(await ffSettlementGate("e1", "x1")).toMatchObject({ allowed: false, code: "PAYROLL_HEAD_APPROVAL_PENDING" });
  });

  it("unlocks after approval", async () => {
    world({ er: leaver, from: "2026-10-01", nc: { status: "completed", override_at: null, completed_at: "2026-10-20", payroll_head_approved_at: "2026-10-21" } });
    expect((await ffSettlementGate("e1", "x1")).allowed).toBe(true);
  });

  it("grandfathers a case completed before the switch-on date", async () => {
    world({ er: leaver, from: "2026-10-15", nc: { status: "completed", override_at: null, completed_at: "2026-10-02", payroll_head_approved_at: null } });
    expect((await ffSettlementGate("e1", "x1")).allowed).toBe(true);
  });

  it("treats a Payroll Head override as already approved", async () => {
    world({ er: leaver, from: "2026-10-01", nc: { status: "in_progress", override_at: "2026-10-05", completed_at: null, payroll_head_approved_at: null } });
    expect((await ffSettlementGate("e1", "x1")).allowed).toBe(true);
  });

  it("locks an incomplete or missing NOC", async () => {
    world({ er: leaver, from: "2026-10-01", nc: { status: "in_progress", override_at: null, completed_at: null, payroll_head_approved_at: null } });
    expect((await ffSettlementGate("e1", "x1")).code).toBe("NOC_INCOMPLETE");
    world({ er: leaver, from: "2026-10-01", nc: null });
    expect((await ffSettlementGate("e1", "x1")).code).toBe("NOC_INCOMPLETE");
  });

  it("does not hold an employee who is still active", async () => {
    world({ er: { ...leaver, employment_status: "active" }, from: "2026-10-01", nc: null });
    expect((await ffSettlementGate("e1", "x1")).allowed).toBe(true);
  });
});

describe("absconder exception: Branch Head first, then Payroll Head", () => {
  beforeEach(() => execute.mockReset());
  const longReason = "a perfectly good reason here";
  const absc = { ...leaver, exit_type: "absconding" };

  it("Payroll Head cannot decide before the Branch Head has approved", async () => {
    world({ er: absc });
    await expect(grantAbscondingFfException({ exitRequestId: "x1", reason: longReason, actorUserId: "ph" })).rejects.toMatchObject({ code: "FF_EXCEPTION_BRANCH_HEAD_PENDING" });
  });

  it("Payroll Head cannot be the same person as the Branch Head", async () => {
    world({ er: { ...absc, ff_exception_bh_at: "2026-10-12", ff_exception_bh_by: "same" } });
    await expect(grantAbscondingFfException({ exitRequestId: "x1", reason: longReason, actorUserId: "same" })).rejects.toMatchObject({ code: "FF_EXCEPTION_SAME_APPROVER" });
  });

  it("refuses a short reason", async () => {
    world({ er: { ...absc, ff_exception_bh_at: "2026-10-12", ff_exception_bh_by: "bh" } });
    await expect(grantAbscondingFfException({ exitRequestId: "x1", reason: "ok", actorUserId: "ph" })).rejects.toMatchObject({ code: "FF_EXCEPTION_REASON_REQUIRED" });
  });

  it("refuses an exit that is not absconding", async () => {
    world({ er: { ...leaver, ff_exception_bh_at: "2026-10-12", ff_exception_bh_by: "bh" } });
    await expect(grantAbscondingFfException({ exitRequestId: "x1", reason: longReason, actorUserId: "ph" })).rejects.toMatchObject({ code: "FF_EXCEPTION_NOT_NEEDED" });
  });

  it("refuses a second exception", async () => {
    world({ er: { ...absc, ff_exception_at: "2026-10-12", ff_exception_bh_at: "2026-10-11", ff_exception_bh_by: "bh" } });
    await expect(grantAbscondingFfException({ exitRequestId: "x1", reason: longReason, actorUserId: "ph" })).rejects.toMatchObject({ code: "FF_EXCEPTION_EXISTS" });
  });

  it("records the Payroll Head exception after a different Branch Head approved", async () => {
    world({ er: { ...absc, ff_exception_bh_at: "2026-10-11", ff_exception_bh_by: "bh" } });
    await grantAbscondingFfException({ exitRequestId: "x1", reason: longReason, actorUserId: "ph" });
    expect(execute.mock.calls.some((c) => String(c[0]).includes("UPDATE exit_request"))).toBe(true);
  });

  it("Branch Head step records once and only for a locked absconder", async () => {
    world({ er: absc });
    await recordBranchHeadFfException({ exitRequestId: "x1", reason: longReason, actorUserId: "bh" });
    expect(execute.mock.calls.some((c) => String(c[0]).includes("ff_exception_bh_by"))).toBe(true);
    world({ er: { ...absc, ff_exception_bh_at: "2026-10-12" } });
    await expect(recordBranchHeadFfException({ exitRequestId: "x1", reason: longReason, actorUserId: "bh" })).rejects.toMatchObject({ code: "FF_EXCEPTION_BH_EXISTS" });
    world({ er: leaver });
    await expect(recordBranchHeadFfException({ exitRequestId: "x1", reason: longReason, actorUserId: "bh" })).rejects.toMatchObject({ code: "FF_EXCEPTION_NOT_NEEDED" });
    await expect(recordBranchHeadFfException({ exitRequestId: "x1", reason: "short", actorUserId: "bh" })).rejects.toMatchObject({ code: "FF_EXCEPTION_REASON_REQUIRED" });
  });
});

describe("pendency predicate", () => {
  it("excludes only absconders without an exception", () => {
    const sql = abscondedWithoutExceptionSql("er", "e");
    expect(sql).toContain("er.ff_exception_at IS NULL");
    expect(sql).toContain("'absconding'");
    expect(sql).toContain("'abandonment'");
  });
});
