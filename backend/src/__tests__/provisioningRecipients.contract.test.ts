/**
 * Provisioning tasks must reach the branch's SPOC, not everyone with the role.
 *
 * getUsersForBranchRole joined employees on uas.manager_employee_id, a column
 * that is NULL on every row of user_assignment_scope — the SPOC is identified
 * by user_id. So the branch lookup matched nothing for every branch and every
 * role, and resolveUsers fell through to "everyone with this role,
 * company-wide". One NOIDA-2 joiner emailed 51 people (8 IT, 9 admin, 11 WFM,
 * 23 HR) while NOIDA-2's actual IT SPOC sat in that same table.
 *
 * A notification that goes to everyone tells no one it is theirs.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(
  path.resolve(__dirname, "..", "modules", "it-provisioning", "it-provisioning.service.ts"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("branch SPOC resolution", () => {
  it("joins the scope table on user_id", () => {
    expect(code).toMatch(/JOIN auth_user au ON au\.id = uas\.user_id/);
  });

  it("never joins on manager_employee_id, which is always NULL", () => {
    expect(code).not.toMatch(/uas\.manager_employee_id/);
  });

  it("does not fall back to every holder of the role", () => {
    // The old resolveUsers returned getUsersForGlobalRole whenever the branch
    // lookup came back empty, and unconditionally for 'admin'.
    const at = code.indexOf("async function resolveTaskRecipients");
    expect(at).toBeGreaterThan(-1);
    const end = code.indexOf("async function", at + 10);
    const body = code.slice(at, end > at ? end : undefined);
    expect(body).not.toContain("getUsersForGlobalRole");
  });

  it("escalates to the branch head when no SPOC is configured", () => {
    expect(code).toContain("branch_head_escalation");
    expect(code).toContain("branchHeadUsers");
  });
});

describe("who is copied", () => {
  it("CCs each SPOC's reporting manager", () => {
    expect(code).toContain("reportingManagersOf");
    expect(code).toMatch(/reporting_manager_id/);
  });

  it("CCs branch HR, falling back to branch_master.hr_contact", () => {
    expect(code).toContain("branchHrEmails");
    expect(code).toMatch(/hr_contact/);
  });

  it("threads cc through to the mail send", () => {
    expect(code).toMatch(/cc: ccList\.join/);
  });

  it("does not CC someone already in the To line", () => {
    expect(code).toMatch(/!users\.some\(\(u\) => u\.email === e\)/);
  });
});

describe("escalations are still delivered", () => {
  it("notifies whenever there is a recipient, not only when assigned", () => {
    // Gating on !isUnassigned would silence the branch-head escalation — the
    // case where a human most needs to know a task has no owner.
    expect(code).toMatch(/if \(users\.length > 0\) \{\s*await dispatchNotifications/);
  });

  it("still marks an escalated task unassigned so it can be reassigned", () => {
    expect(code).toMatch(/users\.length === 0 \|\| recipients\.unassigned/);
  });
});
