/**
 * Configured recipients are the authority; the derived lookup is the fallback.
 *
 * Recipients used to be inferred from three tables with different semantics and
 * nothing stating the intent, so a wrong routing was invisible. One joiner's
 * tasks reached 51 people because a join used an always-NULL column, and a
 * branch's admin task went to a Training & Quality employee for months.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const MOD = path.resolve(__dirname, "..", "modules", "it-provisioning");
const svc = fs.readFileSync(path.join(MOD, "notification-recipients.service.ts"), "utf8");
const prov = fs.readFileSync(path.join(MOD, "it-provisioning.service.ts"), "utf8");
const routes = fs.readFileSync(path.join(MOD, "notification-recipients.routes.ts"), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

describe("configuration wins over inference", () => {
  it("is consulted before the branch-role lookup", () => {
    const at = prov.indexOf("async function resolveTaskRecipients");
    const end = prov.indexOf("async function resolveUsers");
    const body = prov.slice(at, end > at ? end : undefined);
    expect(body.indexOf("getConfiguredRecipients")).toBeGreaterThan(-1);
    expect(body.indexOf("getConfiguredRecipients")).toBeLessThan(body.indexOf("getUsersForBranchRole"));
  });

  it("passes the event code, so config is per task not per role", () => {
    expect(prov).toMatch(/resolveTaskRecipients\(task\.assignedRole, branchId, task\.taskCode\)/);
  });

  it("returns null rather than an empty list when nothing is configured", () => {
    // The caller must be able to tell "not configured, fall back" from
    // "configured to nobody".
    expect(code(svc)).toMatch(/if \(all\.length === 0\) return null;/);
  });

  it("falls back when a branch has CC but no TO", () => {
    // CC-only is a misconfiguration, not an instruction to notify nobody.
    expect(code(svc)).toMatch(/if \(to\.length === 0\) return null;/);
  });
});

describe("recipients that are not employees", () => {
  it("accepts a plain address as well as a linked employee", () => {
    expect(code(svc)).toMatch(/employee_id IS NOT NULL OR email IS NOT NULL|!employeeId && !email/);
  });

  it("resolves an employee's login email, or the free-text one", () => {
    expect(code(svc)).toContain("COALESCE(NULLIF(TRIM(r.email), ''), au.email)");
  });

  it("skips the inbox item for a mailbox with no login", () => {
    // inboxService.createItem with an empty user_id would write a junk row.
    expect(prov).toMatch(/if \(user\.userId\) try \{/);
  });
});

describe("safety", () => {
  it("survives the table not existing yet", () => {
    // Migrations are applied by hand here, so the code must not assume it.
    expect(code(svc)).toContain("information_schema.TABLES");
    expect(code(svc)).toMatch(/hasTable/);
  });

  it("deactivates rather than deletes", () => {
    // Who used to receive a notification is part of the audit trail.
    expect(code(svc)).toMatch(/UPDATE branch_notification_recipient\s*\n?\s*SET active_status = 0/);
  });

  it("restricts configuration to super admins", () => {
    expect(routes).toMatch(/requireRole\("super_admin"/);
  });

  it("exposes an effective-recipients preview", () => {
    // Configuring without seeing the outcome is how the wrong routing survived.
    expect(routes).toContain("/:branchId/effective");
    expect(routes).toContain("branch_head_escalation");
    expect(routes).toContain('basis: "branch_spoc"');
  });
});
