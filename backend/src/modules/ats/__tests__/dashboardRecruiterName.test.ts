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
