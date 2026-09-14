import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ATS notification recipient schema", () => {
  const helperSource = readFileSync(
    resolve(process.cwd(), "src/services/ats-notification.helper.ts"),
    "utf8",
  );

  it("uses the current role assignment table for HR recipients", () => {
    // At least one, not exactly two. The count was incidental: ce64e9ec
    // deliberately rewrote the second query to resolve a recruiter's reporting
    // manager through ats_recruiter_roster instead of user_roles, so pinning the
    // number failed on an intended change. What this test is actually for is the
    // three assertions below — that HR recipients come from the current role
    // table and not the retired user_role / role ones.
    expect((helperSource.match(/JOIN user_roles ur/g) ?? []).length).toBeGreaterThan(0);
    expect(helperSource).toContain("ur.role_key IN ('hr', 'admin', 'super_admin')");
    expect(helperSource).not.toContain("JOIN user_role ur");
    expect(helperSource).not.toContain("JOIN role r");
  });
});
