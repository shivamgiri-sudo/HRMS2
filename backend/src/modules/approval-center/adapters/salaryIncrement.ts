import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { callerRoleKeys, roleMeets } from "./payroll-shared.js";
import { callerScope, keepEmployeeRowsInBranch } from "./scope-guard.js";
import { INCREMENT_ROLE_GATES } from "../../salary-increment/salaryIncrement.service.js";

const STAGE: Record<string, string> = {
  submitted: "Submitted — awaiting HR validation / Payroll Head approval",
  hr_validated: "HR validated — awaiting Payroll Head approval",
  finance_validated: "Finance validated (legacy) — awaiting Payroll Head approval",
};

/**
 * Salary increment: the page's own list (status=pending) filtered to rows the caller's role can move next.
 * Payroll Head / super admin: approve (which also applies it) at any pending stage.
 * HR / admin without that role: only the HR-validate step, only on 'submitted' rows.
 * Roles are matched on the caller's REAL role keys (roleMeets) - accessGuard.hasRole treats `admin` as a wildcard, which
 * would have shown every admin the Payroll Head approve stage. Rows are then kept only for the caller's own branch
 * (org-wide roles: all) and never the caller's own increment (owner branch policy 2026-10-01).
 */
export const salaryIncrementAdapter: ApprovalAdapter = {
  kind: "salary_increment",
  label: "Salary increment",
  category: "Payroll",
  async list(ctx) {
    const roles = await callerRoleKeys(ctx.userId);
    const canApprove = roleMeets(roles, ...INCREMENT_ROLE_GATES.approve);
    const canValidate = roleMeets(roles, ...INCREMENT_ROLE_GATES.hr_validate);
    if (!canApprove && !canValidate) return [];
    const res = await ctx.call("GET", "/api/salary-increment/", { query: { status: "pending", page: 1, limit: 200 } });
    const rows: any[] = await keepEmployeeRowsInBranch(await callerScope(ctx), res?.data ?? [], (r) => r.employee_id);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      const status = str(r.status);
      if (!STAGE[status]) continue;
      // Next action for this caller on this row.
      let action: "approve" | "hr_validate" | null = null;
      if (canApprove) action = "approve";
      else if (canValidate && status === "submitted") action = "hr_validate";
      if (!action) continue;
      const pct = Number(r.increment_percentage);
      const aged = r.created_at ? Date.now() - new Date(r.created_at).getTime() > 7 * 86_400_000 : false;
      out.push({
        uid: `salary_increment:${r.id}`,
        kind: "salary_increment",
        kindLabel: "Salary increment",
        category: "Payroll",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — salary increment`,
        subtitle: `${str(r.current_ctc) ? `₹${Number(r.current_ctc).toLocaleString("en-IN")} → ` : ""}₹${Number(r.proposed_ctc).toLocaleString("en-IN")} CTC${Number.isFinite(pct) ? ` (+${pct.toFixed(2)}%)` : ""}`,
        requester: { name: r.employee_name, code: r.employee_code, branch: r.branch_name },
        stage: STAGE[status],
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          f("Designation", r.designation_name),
          money("Current CTC (annual)", r.current_ctc),
          money("Proposed CTC (annual)", r.proposed_ctc),
          f("Increment %", Number.isFinite(pct) ? `+${pct.toFixed(2)}%` : ""),
          date("Effective from", r.effective_from),
          badge("Status", status.replace(/_/g, " ")),
          f("Reason code", r.reason_code),
          long("Reason / notes", r.reason),
          long("Business justification", r.business_justification),
          date("Requested on", r.created_at),
        ),
        submittedAt: iso(r.created_at),
        priority: aged ? "high" : "normal",
        viewPath: `/salary-increment?approvalId=${encodeURIComponent(String(r.id))}`,
        // Reject remarks are optional on the endpoint, but a rejection should say why.
        rejectNeedsReason: true,
        approveLabel: action === "hr_validate" ? "Validate & forward" : "Approve & apply",
        meta: { action, status },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const next = item.meta?.action === "hr_validate" ? "hr_validate" : "approve";
    await ctx.call("POST", `/api/salary-increment/${encodeURIComponent(item.id)}/action`, {
      body: { action: action === "approve" ? next : "reject", remarks: remarks || undefined },
    });
  },
};
