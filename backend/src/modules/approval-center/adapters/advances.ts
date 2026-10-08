import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoleKeys, roleMeets } from "./payroll-shared.js";

/**
 * Salary advances. The list endpoint has no status filter (scope-visible, advance_date DESC, max 100/page),
 * so read the two newest pages and keep status = 'pending'. Approve/reject endpoint roles: admin, finance, payroll, payroll_head, super_admin.
 */
export const advancesAdapter: ApprovalAdapter = {
  kind: "salary_advance",
  label: "Salary advance",
  category: "Payroll",
  async list(ctx) {
    const roles = await callerRoleKeys(ctx.userId);
    if (!roleMeets(roles, "admin", "finance", "payroll", "payroll_head")) return [];
    const rows: any[] = [];
    for (const page of [1, 2]) {
      const res = await ctx.call("GET", "/api/payroll/advances", { query: { page, limit: 100 } });
      const batch: any[] = res?.data ?? [];
      rows.push(...batch);
      if (batch.length < 100) break;
    }
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.status).toLowerCase() !== "pending") continue;
      const age = ageDays(r.advance_date ?? r.created_at);
      out.push({
        uid: `salary_advance:${r.id}`,
        kind: "salary_advance",
        kindLabel: "Salary advance",
        category: "Payroll",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — salary advance`,
        subtitle: `₹${Number(r.amount).toLocaleString("en-IN")} · recover over ${str(r.recovery_months) || "?"} month(s)`,
        requester: { name: r.employee_name, code: r.employee_code },
        stage: "HO approval — Finance / Payroll",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          money("Advance amount", r.amount),
          date("Advance date", r.advance_date),
          f("Recovery months", r.recovery_months),
          long("Purpose", r.purpose),
          badge("Status", r.status),
          date("Requested on", r.created_at),
        ),
        submittedAt: iso(r.created_at ?? r.advance_date),
        priority: age !== null && age >= 5 ? "high" : "normal",
        viewPath: `/payroll/ho-queues?tab=advances&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") await ctx.call("PATCH", `/api/payroll/advances/${id}/approve`, { body: {} });
    else await ctx.call("PATCH", `/api/payroll/advances/${id}/reject`, { body: { reason: remarks || undefined } });
  },
};
