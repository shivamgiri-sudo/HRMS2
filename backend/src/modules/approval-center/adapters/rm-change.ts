import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { date, f, fields, iso, long, str } from "../format.js";
import { getEmployeeForUser } from "../../../shared/accessGuard.js";
import { keepInBranch } from "./_scope.js";

const AGE_HIGH_MS = 3 * 24 * 3600 * 1000;

/**
 * Reporting-manager change requests. /api/rm-change/pending is already role-gated (admin/hr/wfm/payroll_hr/branch_wfm/branch_head),
 * pending-only and branch-scoped by the module; the only addition is dropping the caller's own request.
 */
export const rmChangeAdapter: ApprovalAdapter = {
  kind: "rm_change",
  label: "Reporting manager change",
  category: "People",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/rm-change/pending");
    // The module treats hr / admin as ORG-WIDE here (approverBranchIds returns null for hasRole("hr"), which is true for admin).
    // Owner policy: admin / hr / branch_head are branch-scoped, so rows are clamped to the branch on the caller's own record.
    const rows: any[] = await keepInBranch(
      ctx.userId,
      ((res?.data ?? []) as any[]).filter((r) => !str(r.status) || str(r.status) === "pending").slice(0, 200),
      (r: any) => ({ branchId: r.branch_id, employeeId: r.employee_id }),
    );
    if (rows.length === 0) return [];
    const me = await getEmployeeForUser(ctx.userId);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (me?.id && String(r.employee_id) === String(me.id)) continue;
      const id = String(r.id);
      const created = iso(r.created_at);
      out.push({
        uid: `rm_change:${id}`,
        kind: "rm_change",
        kindLabel: "Reporting manager change",
        category: "People",
        id,
        title: `${str(r.employee_name) || "Employee"} — manager change`,
        subtitle: `${str(r.current_manager_name) || "—"} to ${str(r.requested_manager_name) || "—"}`,
        requester: { name: r.employee_name, code: r.employee_code, branch: r.branch_name },
        stage: "WFM / branch approval",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          f("Current manager", r.current_manager_name),
          f("Requested manager", r.requested_manager_name),
          long("Reason", r.reason),
          date("Requested on", r.created_at),
        ),
        submittedAt: created,
        priority: created && Date.now() - new Date(created).getTime() > AGE_HIGH_MS ? "high" : "normal",
        viewPath: `/wfm-manager-approvals?approvalId=${encodeURIComponent(id)}`,
        rejectNeedsReason: true,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/rm-change/${encodeURIComponent(item.id)}/action`, {
      body: { action: action === "approve" ? "approved" : "rejected", remarks: remarks || undefined },
    });
  },
};
