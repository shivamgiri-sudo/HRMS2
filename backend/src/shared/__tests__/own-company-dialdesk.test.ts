import { describe, expect, it } from "vitest";
import { notDialDeskProcessSql, ownCompanyBranchSql } from "../ownCompanyCostCentre.js";

describe("DialDesk exclusion predicates", () => {
  it("keeps branches with no recorded company and MAS Callnet spellings, drops other companies", () => {
    const sql = ownCompanyBranchSql("bm");
    expect(sql).toContain("bm.company_name");
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("'%mascallnet%'");
  });

  it("supports an unaliased branch_master", () => {
    expect(ownCompanyBranchSql("")).not.toContain(".company_name");
  });

  it("also drops processes that carry DialDesk in their own name (some have no branch)", () => {
    const sql = notDialDeskProcessSql("p", "bm");
    expect(sql).toContain("p.process_name");
    expect(sql).toContain("NOT LIKE '%dialdesk%'");
    expect(sql).toContain("bm.company_name");
  });
});

describe("I-Spark and GRN exclusion", () => {
  it("hides I-Spark branches by name as well as company", async () => {
    const { ownCompanyBranchSql: branchSql, ownCompanyGrnSql } = await import("../ownCompanyCostCentre.js");
    expect(branchSql("b")).toContain("NOT LIKE '%ispark%'");
    const grn = ownCompanyGrnSql("g");
    expect(grn).toContain("g.branch_id NOT IN");
    expect(grn).toContain("g.cost_centre_id NOT IN");
    expect(grn).toContain("IS NULL");
  });
});
