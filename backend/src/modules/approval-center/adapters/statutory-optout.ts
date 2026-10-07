import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { callerHasRole } from "./_roles.js";

const TYPE_LABEL: Record<string, string> = { pf_opt_out: "PF opt-out", esic_opt_out: "ESI opt-out" };
const STALE_DAYS = 5;

/**
 * Statutory opt-out (PF / ESI). The pending list admits finance too, but the approve endpoint is payroll / super_admin
 * only, so we gate on that. effective_from_month is omitted, exactly what the HO Queues dialog sends by default
 * (the route then applies the decision from today and records no month).
 */
export const statutoryOptOutAdapter: ApprovalAdapter = {
  kind: "statutory_optout",
  label: "PF / ESI opt-out",
  category: "Payroll",
  async list(ctx) {
    if (!(await callerHasRole(ctx.userId, "payroll", "super_admin"))) return [];
    const res = await ctx.call("GET", "/api/payroll/statutory-overrides/pending");
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.status) && str(r.status) !== "pending") continue;
      const label = TYPE_LABEL[str(r.override_type)] ?? str(r.override_type).replace(/_/g, " ");
      const submitted = iso(r.requested_at);
      const ageDays = submitted ? (Date.now() - new Date(submitted).getTime()) / 86_400_000 : 0;
      out.push({
        uid: `statutory_optout:${r.id}`,
        kind: "statutory_optout",
        kindLabel: "PF / ESI opt-out",
        category: "Payroll",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — ${label}`,
        subtitle: r.branch_name ? str(r.branch_name) : undefined,
        requester: { name: str(r.employee_name), code: r.employee_code, branch: r.branch_name },
        stage: "Payroll HO review",
        fields: fields(
          f("Employee", str(r.employee_name)),
          f("Employee code", r.employee_code),
          f("Branch", r.branch_name),
          badge("Request", label),
          long("Employee declaration", r.declaration_text),
          date("Requested on", r.requested_at),
          f("Effective from", "Date of approval (month can be set on the HO Queues page)"),
        ),
        submittedAt: submitted,
        priority: ageDays > STALE_DAYS ? "high" : "normal",
        viewPath: `/payroll/ho-queues?tab=optout&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("PATCH", `/api/payroll/statutory-overrides/${encodeURIComponent(item.id)}/approve`, {
      body: { decision: action === "approve" ? "approved" : "rejected", note: remarks || undefined },
    });
  },
};
