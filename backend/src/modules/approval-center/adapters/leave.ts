import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, dateText, f, fields, iso, long, str } from "../format.js";
import { holdsLiteralRole, keepApproverOrBranchRole, keepInBranch } from "./_scope.js";

const isLegacyLeave = (r: any) => r.legacy_leave_id !== null && r.legacy_leave_id !== undefined && String(r.legacy_leave_id).trim() !== "";

/** Leave: reporting manager / skip-level (manager stage) or literal branch_head (exception tier). Legacy-imported rows are excluded. */
export const leaveAdapter: ApprovalAdapter = {
  kind: "leave",
  label: "Leave request",
  category: "People",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/leave/requests", { query: { status: "pending,pending_branch_head", limit: 200 } });
    // Rows imported from db_bill carry legacy_leave_id (551 of 586 pending rows on prod when this was written): never shown here.
    const reviewable: any[] = (res?.data ?? []).filter((r: any) => r.can_review && !isLegacyLeave(r));
    // can_review only means "this caller is ABLE to review" (super_admin, branch-scoped hr/admin, branch_head by role). The popup is
    // "pending ON ME", so a row is shown only when the caller is its DESIGNATED approver for the CURRENT stage:
    //   - manager stage (pending): the employee's effective approver (reporting manager / skip-level on leave). When no approver is
    //     resolvable the module falls back to hr/admin, so a literal admin / hr / hr_admin / payroll_hr holder of the same branch.
    //   - branch-head exception tier (pending_branch_head): a literal branch_head of the employee's own branch.
    // super_admin / admin / hr / org-wide roles are not shown manager-stage rows they are merely able to review.
    const ref = (r: any) => ({ employeeId: r.employee_id, employeeCode: r.employee_code });
    const mgrStage = reviewable.filter((r) => r.status !== "pending_branch_head");
    const bhStage = reviewable.filter((r) => r.status === "pending_branch_head");
    const mgrRows = await keepApproverOrBranchRole(ctx.userId, mgrStage, ref, ["admin", "hr", "hr_admin", "payroll_hr"]);
    const bhRows = bhStage.length && (await holdsLiteralRole(ctx.userId, "branch_head")) ? await keepInBranch(ctx.userId, bhStage, ref) : [];
    const keepIds = new Set([...mgrRows, ...bhRows].map((r) => String(r.id)));
    const rows: any[] = reviewable.filter((r) => keepIds.has(String(r.id)));
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      const escalated = r.status === "pending_branch_head";
      out.push({
        uid: `leave:${r.id}`,
        kind: "leave",
        kindLabel: "Leave request",
        category: "People",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — ${str(r.leave_type_name) || "Leave"}`,
        subtitle: `${str(r.total_days)} day(s) · ${dateText(r.from_date)} to ${dateText(r.to_date)}`,
        requester: { name: r.employee_name, code: r.employee_code, branch: r.branch_name },
        stage: escalated ? "Branch-head exception tier" : "Reporting manager review",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          f("Process", r.process_name),
          f("Department", r.department_name),
          badge("Leave type", r.leave_type_name),
          date("From", r.from_date),
          date("To", r.to_date),
          f("Total days", r.total_days),
          f("Half day", r.half_day ? "Yes" : ""),
          date("Applied on", r.applied_at),
          long("Reason", r.reason),
        ),
        submittedAt: iso(r.applied_at),
        viewPath: `/leaves?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        meta: { escalated },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const escalated = item.meta?.escalated === true;
    const status = action === "approve" ? (escalated ? "branch_head_approved" : "approved") : escalated ? "branch_head_rejected" : "rejected";
    await ctx.call("PATCH", `/api/leave/requests/${encodeURIComponent(item.id)}/review`, { body: { status, remarks: remarks || null } });
  },
};
