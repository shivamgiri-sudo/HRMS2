import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../he-policy.service.js", () => ({
  getDailyPlan: vi.fn(async () => ({ walkInsPerDay: 10, minOutreachPerDay: 0, showRatePct: 50, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 })),
  engineAutoOn: vi.fn(), engineMode: vi.fn(),
}));

import { evaluateRequisitionReadiness, isBlocking, NEVER_OVERRIDE, type RequisitionFacts } from "../requisition-readiness.js";
import { getRequisitionReadiness } from "../he-readiness.service.js";

const ok: RequisitionFacts = { approvalStatus: "approved", activeStatus: 1, requested: 5, fulfilled: 1, branchAddress: "Plot 5, Sector 62", bmiLink: "https://bmi.example/x", slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30, t1Approved: 1, t8Approved: 1, sourceType: "meta_live" };
const codes = (f: Partial<RequisitionFacts>) => evaluateRequisitionReadiness({ ...ok, ...f }).map((p) => p.code);

describe("evaluateRequisitionReadiness", () => {
  it("is clean for a ready requisition", () => expect(evaluateRequisitionReadiness(ok)).toEqual([]));
  it("blocks a requisition that is not approved or not active", () => {
    const p = evaluateRequisitionReadiness({ ...ok, approvalStatus: "pending" });
    expect(p).toEqual([{ code: "requisition_not_open", severity: "blocking", message: "Requisition is not approved and active" }]);
    expect(isBlocking(p)).toBe(true);
    expect(codes({ activeStatus: 0 })).toEqual(["requisition_not_open"]);
  });
  it("blocks when no positions are left", () => expect(codes({ fulfilled: 5 })).toEqual(["no_headcount"]));
  it("blocks a missing or blank address", () => {
    expect(codes({ branchAddress: null })).toEqual(["no_branch_address"]);
    expect(codes({ branchAddress: "  " })).toEqual(["no_branch_address"]);
  });
  it("only warns about a multi-line address", () => {
    const p = evaluateRequisitionReadiness({ ...ok, branchAddress: "Plot 5,\nSector 62" });
    expect(p.map((x) => [x.code, x.severity])).toEqual([["address_multiline", "warning"]]);
    expect(isBlocking(p)).toBe(false);
  });
  it("warns about a missing BMI link except for he", () => {
    expect(codes({ bmiLink: null, sourceType: "he" })).toEqual([]);
    expect(codes({ bmiLink: "", sourceType: "meta_live" })).toEqual(["no_bmi_link"]);
    expect(codes({ bmiLink: null, sourceType: null })).toEqual(["no_bmi_link"]);
  });
  it("blocks an invalid slot window", () => {
    expect(codes({ slotStart: "17:30", slotEnd: "10:00" })).toEqual(["no_slot_window"]);
    expect(codes({ slotStart: "", slotEnd: "10:00" })).toEqual(["no_slot_window"]);
    expect(codes({ slotMinutes: 0 })).toEqual(["no_slot_window"]);
  });
  it("blocks without any invite template and warns without T1", () => {
    expect(evaluateRequisitionReadiness({ ...ok, t1Approved: 0, t8Approved: 0 })).toEqual([{ code: "no_template", severity: "blocking", message: "No approved WhatsApp invite template (T1 or T8)" }]);
    const w = evaluateRequisitionReadiness({ ...ok, t1Approved: 0, t8Approved: 2 });
    expect(w).toEqual([{ code: "no_invite_template", severity: "warning", message: "T1 is not approved; T8 is used" }]);
    expect(isBlocking(w)).toBe(false);
  });
  it("lists problems in rule order and exposes the never-override set", () => {
    expect(codes({ approvalStatus: "x", fulfilled: 9, branchAddress: null, bmiLink: null, slotEnd: "09:00", t1Approved: 0, t8Approved: 0 }))
      .toEqual(["requisition_not_open", "no_headcount", "no_branch_address", "no_bmi_link", "no_slot_window", "no_template"]);
    expect([...NEVER_OVERRIDE].sort()).toEqual(["no_headcount", "requisition_not_open"]);
  });
});

describe("getRequisitionReadiness", () => {
  beforeEach(() => execute.mockReset());
  const row = { requisition_code: "REQ-1", branch_name: "Noida", approval_status: "approved", active_status: 1, requested_headcount: 5, fulfilled_headcount: 1, bmi_assessment_url: null, branch_address: "Plot 5" };
  it("reads the facts with a collation-safe single-row address subquery", async () => {
    execute.mockResolvedValueOnce([[row]]).mockResolvedValueOnce([[{ t1: "1", t8: null }]]);
    const r = await getRequisitionReadiness("r1", "meta_live");
    const sql = String(execute.mock.calls[0][0]);
    expect(sql).toContain("COLLATE utf8mb4_unicode_ci");
    expect(sql).toMatch(/SELECT bm\.address FROM branch_master bm WHERE[^)]*LIMIT 1\)/);
    expect(execute.mock.calls[0][1]).toEqual(["r1"]);
    expect(r).toMatchObject({ requisitionId: "r1", code: "REQ-1", branch: "Noida", ok: true });
    expect(r!.problems.map((p) => p.code)).toEqual(["no_bmi_link"]);
  });
  it("is not ok when blocked", async () => {
    execute.mockResolvedValueOnce([[{ ...row, branch_address: null }]]).mockResolvedValueOnce([[{ t1: 0, t8: 0 }]]);
    const r = await getRequisitionReadiness("r1", "he");
    expect(r!.ok).toBe(false);
    expect(r!.problems.map((p) => p.code)).toEqual(["no_branch_address", "no_template"]);
  });
  it("returns null for an unknown requisition", async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await getRequisitionReadiness("nope")).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
