import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, dateText, f, fields, iso, long, str } from "../format.js";

/** Leave: reporting manager / skip-level / branch-head exception tier. `can_review` is computed by the leave module itself. */
export const leaveAdapter: ApprovalAdapter = {
  kind: "leave",
  label: "Leave request",
  category: "People",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/leave/requests", { query: { status: "pending,pending_branch_head", limit: 200 } });
    const rows: any[] = res?.data ?? [];
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (!r.can_review) continue;
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
