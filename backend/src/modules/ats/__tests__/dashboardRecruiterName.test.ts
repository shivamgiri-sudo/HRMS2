import { describe, expect, it } from "vitest";
import { recruiterNameSql } from "../dashboard.scope.js";

describe("recruiterNameSql", () => {
  it("falls back to recruiter_assigned_name when recruiter_name is blank", () => {
    expect(recruiterNameSql()).toBe(
      "COALESCE(NULLIF(TRIM(recruiter_name), ''), NULLIF(TRIM(recruiter_assigned_name), ''))",
    );
  });

  it("qualifies both columns with the table alias", () => {
    const sql = recruiterNameSql("c");
    expect(sql).toContain("c.recruiter_name");
    expect(sql).toContain("c.recruiter_assigned_name");
    expect(sql).not.toMatch(/[^.]recruiter_name/);
  });
});

import { BRANCH_EXPR } from "../dashboard.overview.service.js";

describe("BRANCH_EXPR", () => {
  it("resolves a branch id stored in applied_for_branch before falling back to the raw value", () => {
    const lookup = BRANCH_EXPR.indexOf("FROM branch_master");
    const raw = BRANCH_EXPR.indexOf("NULLIF(applied_for_branch,'')");
    expect(lookup).toBeGreaterThan(-1);
    expect(lookup).toBeLessThan(raw);
    expect(BRANCH_EXPR.startsWith("COALESCE(NULLIF(branch_display_name,'')")).toBe(true);
    expect(BRANCH_EXPR.endsWith("'Unspecified')")).toBe(true);
  });
});
