import { describe, expect, it } from "vitest";
import {
  ORG_WIDE,
  branchInScope,
  isOrgWideRoleSet,
  requisitionBranchCondition,
  type HrBranchScope,
} from "../job-requisition-hr-scope";

const noida: HrBranchScope = {
  orgWide: false,
  branchIds: ["b-noida"],
  branchNames: ["NOIDA", "NDA"],
};

describe("isOrgWideRoleSet", () => {
  it("treats head office and admin roles as org-wide", () => {
    expect(isOrgWideRoleSet(["hr_head"])).toBe(true);
    expect(isOrgWideRoleSet(["ho_hr"])).toBe(true);
    expect(isOrgWideRoleSet(["employee", "super_admin"])).toBe(true);
  });

  it("keeps a branch HR user branch-scoped", () => {
    expect(isOrgWideRoleSet(["hr"])).toBe(false);
    expect(isOrgWideRoleSet(["recruitment_hr", "employee"])).toBe(false);
  });
});

describe("requisitionBranchCondition", () => {
  it("does not restrict an org-wide caller", () => {
    expect(requisitionBranchCondition(ORG_WIDE)).toEqual({
      sql: "1=1",
      params: [],
    });
  });

  it("restricts a branch HR user to their branch by id or name", () => {
    const cond = requisitionBranchCondition(noida);
    expect(cond.sql).toBe("(jr.branch_id IN (?) OR jr.branch_name IN (?,?))");
    expect(cond.params).toEqual(["b-noida", "NOIDA", "NDA"]);
  });

  it("shows nothing to an HR user with no branch, never everything", () => {
    expect(
      requisitionBranchCondition({
        orgWide: false,
        branchIds: [],
        branchNames: [],
      }),
    ).toEqual({ sql: "1=0", params: [] });
  });
});

describe("branchInScope", () => {
  it("matches by id or by name", () => {
    expect(branchInScope(noida, "b-noida", null)).toBe(true);
    expect(branchInScope(noida, null, "NOIDA")).toBe(true);
  });

  it("refuses another branch", () => {
    expect(branchInScope(noida, "b-pune", "PUNE")).toBe(false);
    expect(branchInScope(noida, null, null)).toBe(false);
  });

  it("allows everything for an org-wide caller", () => {
    expect(branchInScope(ORG_WIDE, "b-pune", "PUNE")).toBe(true);
  });
});
