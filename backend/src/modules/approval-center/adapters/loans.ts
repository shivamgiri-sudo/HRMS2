import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { holdsLiteralRole } from "./_scope.js";
import { ageDays } from "./payroll-shared.js";
import { callerScope, keepEmployeeRowsInBranch } from "./scope-guard.js";

/**
 * Loans: GET /api/payroll/loans?status=pending_approval (branch-scoped for the caller). Approve/reject are head-level only
 * (finance_head, payroll_head, admin, super_admin) and the creator cannot decide their own loan — both rules are applied here
 * so the popup never shows a loan the endpoint would refuse.
 */
export const loansAdapter: ApprovalAdapter = {
  kind: "loan",
  label: "Loan / advance request",
  category: "Payroll",
  async list(ctx) {
    if (!(await holdsLiteralRole(ctx.userId, "finance_head", "payroll_head", "admin", "super_admin"))) return [];
    const res = await ctx.call("GET", "/api/payroll/loans/", { query: { status: "pending_approval", page: 1, limit: 200 } });
    // The module scopes by employee (and includes the caller's own row); keep only the caller's own branch (admin is branch-scoped,
    // finance_head / payroll_head org-wide) and never a loan for the caller themself.
    // Loans imported from the legacy system carry legacy_loan_id (employee_loans.*): history, never listed.
    const live = ((res?.data ?? []) as any[]).filter((r) => !str(r.legacy_loan_id));
    const rows: any[] = await keepEmployeeRowsInBranch(await callerScope(ctx), live, (r) => r.employee_id);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.status) !== "pending_approval") continue;
      if (r.created_by && String(r.created_by) === String(ctx.userId)) continue;
      const age = ageDays(r.created_at);
      out.push({
        uid: `loan:${r.id}`,
        kind: "loan",
        kindLabel: "Loan / advance request",
        category: "Payroll",
        id: String(r.id),
        title: `${str(r.employee_name) || str(r.employee_code) || "Employee"} — ${str(r.loan_type) || "Loan"}`,
        subtitle: `₹${Number(r.amount).toLocaleString("en-IN")} · ${str(r.installments)} installment(s)`,
        requester: { name: r.employee_name, code: r.employee_code, branch: r.branch_name },
        stage: "Head approval — Finance / Payroll Head",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          f("Cost centre", r.cost_center),
          badge("Loan type", r.loan_type),
          money("Amount", r.amount),
          f("Installments", r.installments),
          money("Deduction per month", r.deduction_per_month),
          date("Start date", r.start_date),
          date("End date", r.end_date),
          f("Guarantor", [r.guarantor_name, r.guarantor_emp_code].map(str).filter(Boolean).join(" · ")),
          f("Cheque", [r.cheque_number, r.cheque_bank, r.cheque_date ? String(r.cheque_date).slice(0, 10) : ""].map(str).filter(Boolean).join(" · ")),
          f("RTGS", [r.rtgs_number, r.rtgs_date ? String(r.rtgs_date).slice(0, 10) : ""].map(str).filter(Boolean).join(" · ")),
          long("Reason", r.reason),
          date("Requested on", r.created_at),
        ),
        submittedAt: iso(r.created_at),
        priority: age !== null && age >= 5 ? "high" : "normal",
        viewPath: `/payroll/loans?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") await ctx.call("POST", `/api/payroll/loans/${id}/approve`, { body: {} });
    else await ctx.call("POST", `/api/payroll/loans/${id}/reject`, { body: { reason: remarks || undefined } });
  },
};
