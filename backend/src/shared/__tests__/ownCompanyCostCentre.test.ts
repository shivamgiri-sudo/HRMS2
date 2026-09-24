import { describe, expect, it } from "vitest";
import { ownCompanyCostCentreSql } from "../ownCompanyCostCentre.js";

describe("ownCompanyCostCentreSql", () => {
  it("normalises the company name on the given alias so every MAS Callnet spelling matches", () => {
    const sql = ownCompanyCostCentreSql("cc");
    expect(sql).toContain("LOWER(COALESCE(cc.company_name, ''))");
    expect(sql).toContain("LIKE '%mascallnet%'");
  });

  it("uses the alias it is given", () => {
    expect(ownCompanyCostCentreSql("ccm")).toContain("ccm.company_name");
    expect(ownCompanyCostCentreSql("ccm")).not.toContain("cc.company_name");
  });
});
