/**
 * Ops Control Tower "BGV pending" reads the per-category checks live, so a joiner whose applicable checks
 * are all clear drops off even while the stored overall_status is the stale value computed when education
 * was still required (owner decision 2026-10-17: education is not applicable). Count and list must agree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import * as svc from "../ops-control-tower.service.js";

const B = "b0000000-0000-0000-0000-000000000001";
const row = (n: number, overall: string) => ({
  employee_id: `e${n}`, employee_code: `MAS${n}`, full_name: `Joiner ${n}`, branch_id: B,
  candidate_id: `c${n}`, status: overall, overall_status: overall, locked: 0, days_open: 5 - n,
});
// c1: identity, bank and address clear, education never run -> complete now.
// c2: address still outstanding -> still pending.
// c3: HR hard reject ('negative') keeps its verdict even with clear checks.
const joiners = [row(1, "in_progress"), row(2, "in_progress"), row(3, "negative")];
const checks = ["c1", "c2", "c3"].flatMap((id) => [
  { candidate_id: id, check_type: "digilocker", status: "verified" },
  { candidate_id: id, check_type: "bank", status: "verified" },
]);
const reports = [
  { candidate_id: "c1", address_status: "passed", education_status: "not_run" },
  { candidate_id: "c2", address_status: "not_run", education_status: "not_run" },
  { candidate_id: "c3", address_status: "passed", education_status: "not_run" },
];

function mockDb(failChecks = false) {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM branch_master")) return [[{ id: B, branch_name: "NOIDA" }]];
    if (sql.includes("FROM ats_onboarding_bridge b")) return [joiners];
    if (sql.includes("FROM candidate_bgv_check")) {
      if (failChecks) throw new Error("boom");
      return [checks];
    }
    if (sql.includes("FROM candidate_bgv_report WHERE candidate_id IN")) return [reports];
    return [[]];
  });
}

beforeEach(() => mockDb());

describe("BGV pending - education not applicable", () => {
  it("summary count drops the joiner whose applicable checks are complete", async () => {
    const blk = await svc.getBgvPendingBlock();
    expect(blk.grandTotal).toBe(2);
  });

  it("drill-down list agrees, and names only the real outstanding work", async () => {
    const rows = await svc.getBgvPendingDetail(B);
    expect(rows.map((r) => r.employeeCode)).toEqual(["MAS2", "MAS3"]);
    expect(rows[0].status).toMatch(/^1 pending: Address/);
    expect(rows[0].status).not.toMatch(/education/i);
  });

  it("falls back to the stored status (over-reporting, never hiding) when the live lookup fails", async () => {
    mockDb(true);
    expect((await svc.getBgvPendingBlock()).grandTotal).toBe(3);
  });
});
