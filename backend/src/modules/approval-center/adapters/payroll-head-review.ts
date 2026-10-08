import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { hasAnyRole } from "../../../shared/scopeAccess.js";

/**
 * Payroll Head new-hire salary review.
 *
 * GET /queue is open to viewer roles (payroll_hr, branch_head, ...) but approve is payroll_head / super_admin
 * only, so the role is re-checked in-process with the same helper the module uses.
 * Only reviews whose salary package is already accepted are listed: /approve refuses otherwise, and the
 * alternative (/package/approve-offered) needs an effective date the popup cannot collect.
 *
 * Reject needs category + reason_code (validated against payroll_head_review_reason_master) that the popup
 * cannot collect, so reject is NOT offered from the popup: meta.rejectViewOnly = true; the popup should
 * send the user to viewPath. decide("reject") therefore throws.
 */
export const payrollHeadReviewAdapter: ApprovalAdapter = {
  kind: "payroll_head_review",
  label: "Salary review (new hire)",
  category: "Payroll",
  async list(ctx) {
    if (!(await hasAnyRole(ctx.userId, "payroll_head", "super_admin"))) return [];
    const res = await ctx.call("GET", "/api/payroll-head-review/queue", { query: { status: "pending_review" } });
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (!r.package_accepted) continue;
      const hours = Number(r.pending_hours);
      const penny = r.summary?.bank?.penny_drop;
      out.push({
        uid: `payroll_head_review:${r.employee_id}`,
        kind: "payroll_head_review",
        kindLabel: "Salary review (new hire)",
        category: "Payroll",
        id: String(r.employee_id),
        title: `${str(r.full_name) || "Employee"} — salary approval`,
        subtitle: `${str(r.employee_code)} · ${str(r.designation_name)} · ${str(r.branch_name)}`,
        requester: { name: r.full_name, code: r.employee_code, branch: r.branch_name },
        stage: "Payroll Head final salary approval",
        fields: fields(
          f("Employee", r.full_name),
          f("Employee code", r.employee_code),
          f("Designation", r.designation_name),
          f("Branch", r.branch_name),
          f("Process", r.process_name),
          f("Cost centre", r.cost_centre_name),
          badge("Employment type", r.emp_type),
          money("Offered CTC (offer)", r.offered_ctc),
          f("Offer status", r.offer_status),
          money("Final CTC (assigned package)", r.final_ctc),
          f("Package accepted", "Yes", "badge"),
          f("Offer raised by (Payroll HR)", r.phr_by),
          date("Offer submitted", r.phr_at),
          f("Branch head", r.bh_by),
          f("Branch head decision", r.bh_status),
          date("Branch head approved on", r.bh_at),
          long("Branch head remarks", r.bh_remarks),
          f("Bank penny-drop verified", penny ? (penny.verified ? "Yes" : "No") : "", "badge"),
          f("Resubmitted (times)", Number(r.resubmit_count) > 0 ? r.resubmit_count : ""),
          f("Waiting (hours)", Number.isFinite(hours) ? hours : ""),
        ),
        submittedAt: iso(r.created_at),
        priority: Number.isFinite(hours) && hours >= 48 ? "high" : "normal",
        viewPath: `/payroll/salary-review/${encodeURIComponent(String(r.employee_id))}?approvalId=${encodeURIComponent(String(r.employee_id))}`,
        rejectNeedsReason: true,
        rejectLabel: "Open to reject",
        meta: { rejectViewOnly: true },
      });
    }
    return out;
  },
  async decide(ctx, item, action) {
    if (action === "reject") {
      throw new Error("Rejecting a salary review needs a reason category and code. Open the review to reject it.");
    }
    await ctx.call("POST", `/api/payroll-head-review/${encodeURIComponent(item.id)}/approve`, { body: {} });
  },
};
