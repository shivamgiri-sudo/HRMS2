import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { date, f, fields, iso, long, str } from "../format.js";
import { callerScope, keepEmployeeRowsInBranch } from "./scope-guard.js";
import { holdsLiteralRole } from "./_scope.js";

/**
 * Salary date revision: Payroll Head / super admin only (endpoint 403s everyone else, which the service swallows). Both are org-wide
 * roles; the branch filter is a second lock so a role mix-up can never widen this, and the caller's own request is never theirs to decide.
 */
export const salaryRevisionAdapter: ApprovalAdapter = {
  kind: "salary_revision",
  label: "Salary date revision",
  category: "Payroll",
  async list(ctx) {
    if (!(await holdsLiteralRole(ctx.userId, "payroll_head", "super_admin"))) return [];
    const res = await ctx.call("GET", "/api/salary-revision/", { query: { status: "pending" } });
    const rows: any[] = await keepEmployeeRowsInBranch(await callerScope(ctx), ((res?.data ?? []) as any[]).slice(0, 200), (r) => r.employee_id);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.status) && str(r.status) !== "pending") continue;
      const aged = r.created_at ? Date.now() - new Date(r.created_at).getTime() > 3 * 86_400_000 : false;
      out.push({
        uid: `salary_revision:${r.id}`,
        kind: "salary_revision",
        kindLabel: "Salary date revision",
        category: "Payroll",
        id: String(r.id),
        title: `${str(r.full_name) || "Employee"} — salary start date`,
        subtitle: `${str(r.current_effective_from).slice(0, 10) || "—"} → ${str(r.requested_effective_from).slice(0, 10)}`,
        requester: { name: r.full_name, code: r.employee_code, branch: r.branch_name },
        stage: "Payroll Head approval",
        fields: fields(
          f("Employee", r.full_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          date("Current salary start date", r.current_effective_from),
          date("Requested salary start date", r.requested_effective_from),
          long("Reason", r.reason),
          f("Requested by", r.requested_by_email),
          date("Requested on", r.created_at),
        ),
        submittedAt: iso(r.created_at),
        priority: aged ? "high" : "normal",
        viewPath: `/salary-revision?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/salary-revision/${encodeURIComponent(item.id)}/review`, {
      body: { action, remarks: remarks || undefined },
    });
  },
};
