import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, dateText, f, fields, iso, long, str } from "../format.js";
import { visitorService } from "../../visitor/visitor.service.js";

/**
 * Who is the DESIGNATED decider of a visit, narrowed from what visitorService.decide merely accepts:
 *  - the assigned host, always;
 *  - a branch role (branch_head, security_head, ho_hr, hr_admin) of the visit's OWN branch;
 *  - `admin` of the visit's own branch only when the visit has NO host (otherwise admin is merely able to decide);
 *  - super_admin is NOT a designation: it is shown a visit only as the host or by holding one of the branch roles above.
 */
export const VISITOR_BRANCH_APPROVER_ROLES = ["branch_head", "security_head", "ho_hr", "hr_admin"];

export function canDecideVisit(
  scope: { employeeId: string | null; branchId: string | null; roles: string[] },
  visit: { host_employee_id?: string | null; branch_id?: string | null },
): boolean {
  if (scope.employeeId && visit.host_employee_id === scope.employeeId) return true;
  const sameBranch = Boolean(scope.branchId && scope.branchId === visit.branch_id);
  if (!sameBranch) return false;
  if (scope.roles.some((r) => VISITOR_BRANCH_APPROVER_ROLES.includes(r))) return true;
  return !visit.host_employee_id && scope.roles.includes("admin");
}

/**
 * Visitor visit approval. /api/visitor/visits returns every visit in the caller's visibility (any branch
 * security/reception role sees the whole branch), so rows are filtered to the ones decide() would accept.
 */
export const visitorAdapter: ApprovalAdapter = {
  kind: "visitor",
  label: "Visitor visit",
  category: "Admin",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/visitor/visits", { query: { status: "pending_approval", limit: 200 } });
    const rows: any[] = res?.data ?? [];
    if (!rows.length) return [];
    const scope = await visitorService.getScope(ctx.userId);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (r.status !== "pending_approval") continue;
      if (!canDecideVisit(scope, r)) continue;
      out.push({
        uid: `visitor:${r.id}`,
        kind: "visitor",
        kindLabel: "Visitor visit",
        category: "Admin",
        id: String(r.id),
        title: `${str(r.visitor_name) || "Visitor"}${r.company_name ? ` (${str(r.company_name)})` : ""} — visit`,
        subtitle: [str(r.branch_name), r.scheduled_start ? dateText(r.scheduled_start) : "", str(r.host_display_name) && `host ${str(r.host_display_name)}`].filter(Boolean).join(" · ") || undefined,
        requester: { name: r.visitor_name, branch: r.branch_name },
        stage: "Host / branch approval",
        fields: fields(
          f("Visitor", r.visitor_name),
          f("Company", r.company_name),
          f("Mobile", r.masked_mobile),
          f("Host", r.host_display_name),
          f("Branch", r.branch_name),
          badge("Visit type", str(r.visit_type).replace(/_/g, " ")),
          long("Purpose", r.purpose),
          date("Scheduled start", r.scheduled_start),
          date("Scheduled end", r.scheduled_end),
          f("Visit number", r.visit_number),
        ),
        submittedAt: iso(r.scheduled_start),
        viewPath: `/visitor-management/approvals?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true, // reject endpoint requires >= 3 chars
        meta: {},
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    const reason = remarks.trim();
    if (action === "approve") {
      // approve's reason is optional but must be >= 3 chars when sent.
      await ctx.call("POST", `/api/visitor/visits/${id}/approve`, { body: reason.length >= 3 ? { reason } : {} });
    } else {
      await ctx.call("POST", `/api/visitor/visits/${id}/reject`, { body: { reason } });
    }
  },
};
