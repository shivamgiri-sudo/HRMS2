import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { hasAnyRole } from "../../../shared/scopeAccess.js";

const AGE_HIGH_MS = 3 * 24 * 3600 * 1000;
const pretty = (v: unknown) => str(v).replace(/_/g, " ");

/**
 * Attendance manual override (payroll). List/decide endpoints are payroll_head/payroll_admin/admin/super_admin only
 * (403 for everyone else, swallowed by the service). Overrides of a locked payroll month (higher_approval_required)
 * can only be approved by super_admin, so they are shown only to a super_admin.
 */
export const manualOverrideAdapter: ApprovalAdapter = {
  kind: "manual_override",
  label: "Attendance manual override",
  category: "Payroll",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/attendance/manual-overrides", { query: { status: "pending" } });
    const rows: any[] = (res?.data ?? []).filter((r: any) => str(r.approval_status) === "pending").slice(0, 200);
    let superAdmin: boolean | null = null;
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      const locked = Number(r.higher_approval_required) === 1 || r.higher_approval_required === true;
      if (locked) {
        superAdmin ??= await hasAnyRole(ctx.userId, "super_admin");
        if (!superAdmin) continue;
      }
      const created = iso(r.created_at);
      out.push({
        uid: `manual_override:${r.id}`,
        kind: "manual_override",
        kindLabel: "Attendance manual override",
        category: "Payroll",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — ${pretty(r.old_status) || "?"} to ${pretty(r.new_status) || "?"}`,
        subtitle: `For ${str(r.attendance_date).slice(0, 10)}`,
        requester: { name: r.employee_name, code: r.employee_code, branch: r.branch_name },
        stage: locked ? "Locked payroll month — Super Admin approval" : "Payroll approval",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          f("Process", r.process_name),
          date("Attendance date", r.attendance_date),
          badge("Current status", pretty(r.old_status)),
          badge("New status", pretty(r.new_status)),
          f("LWP (old to new)", r.old_lwp !== undefined && r.new_lwp !== undefined && (str(r.old_lwp) || str(r.new_lwp)) ? `${str(r.old_lwp) || "0"} to ${str(r.new_lwp) || "0"}` : ""),
          f("Payroll month", r.payroll_month),
          f("Month locked", locked ? "Yes — Super Admin only" : ""),
          money("Payroll impact", r.payroll_impact_amount),
          long("Reason", r.reason),
          date("Raised on", r.created_at),
        ),
        submittedAt: created,
        priority: locked || (created && Date.now() - new Date(created).getTime() > AGE_HIGH_MS) ? "high" : "normal",
        viewPath: `/hr/attendance-lookup?empCode=${encodeURIComponent(str(r.employee_code))}&approvalId=${encodeURIComponent(String(r.id))}`,
        // The module demands a >=10 char reason; the popup enforces a written reason, the endpoint enforces the length.
        rejectNeedsReason: true,
        meta: { locked },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") {
      await ctx.call("POST", `/api/attendance/manual-overrides/${id}/approve`, { body: {} });
    } else {
      await ctx.call("POST", `/api/attendance/manual-overrides/${id}/reject`, { body: { reason: remarks } });
    }
  },
};
