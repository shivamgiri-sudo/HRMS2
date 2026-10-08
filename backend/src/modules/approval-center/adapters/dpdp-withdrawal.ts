import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { branchAllowed, callerScope, io } from "./scope-guard.js";

function scopeText(raw: unknown): string {
  const s = str(raw);
  if (!s) return "All consents";
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(arr)) return arr.map((k) => String(k).replace(/_/g, " ")).join(", ") || "All consents";
  } catch {
    /* fall through to raw text */
  }
  return s;
}

/**
 * DPDP consent-withdrawal review. Endpoints are role-gated (hr/admin/dpo/compliance/super_admin) and
 * branch-scoped by the module; open requests = submitted + in_review (approve/reject accept both).
 * The requester can never decide their own request (server enforces; filtered here too).
 * The module treats `admin` as the DPO (accessGuard's admin-superset rule) and so lists every branch's requests to an admin. Owner
 * policy: only a real `dpo` (or an org-wide role) sees all branches; hr / admin / compliance see requests raised by employees of their
 * OWN branch. A requester with no employee record has no branch, so only org-wide / dpo callers see theirs.
 */
export const dpdpWithdrawalAdapter: ApprovalAdapter = {
  kind: "dpdp_withdrawal",
  label: "DPDP consent withdrawal",
  category: "Admin",
  async list(ctx) {
    const [submitted, inReview] = await Promise.all([
      ctx.call("GET", "/api/privacy/dpdp-withdrawal", { query: { status: "submitted" } }),
      ctx.call("GET", "/api/privacy/dpdp-withdrawal", { query: { status: "in_review" } }).catch(() => null),
    ]);
    const rows: any[] = [...(submitted?.data ?? []), ...(inReview?.data ?? [])].slice(0, 200);
    const me = await callerScope(ctx);
    const wide = me.orgWide || me.roles.includes("dpo");
    const requesters = wide ? new Map() : await io.userEmployees(rows.map((r) => r.requester_id));
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (r.status !== "submitted" && r.status !== "in_review") continue;
      if (str(r.requester_id) && str(r.requester_id) === ctx.userId) continue;
      if (!wide && !branchAllowed(me, requesters.get(str(r.requester_id))?.branchId)) continue;
      const due = iso(r.sla_due_at);
      const breached = due ? new Date(due).getTime() < Date.now() : false;
      out.push({
        uid: `dpdp_withdrawal:${r.id}`,
        kind: "dpdp_withdrawal",
        kindLabel: "DPDP consent withdrawal",
        category: "Admin",
        id: String(r.id),
        title: `${str(r.requester_name) || "Requester"} — consent withdrawal`,
        subtitle: [str(r.reference_number), scopeText(r.withdrawal_scope_json ?? r.scope_json)].filter(Boolean).join(" · "),
        requester: { name: r.requester_name },
        stage: r.status === "in_review" ? "In review (processing hold applied)" : "Submitted — awaiting review",
        fields: fields(
          f("Requester", r.requester_name),
          f("Requester type", r.requester_type),
          f("Reference", r.reference_number),
          badge("Status", str(r.status).replace(/_/g, " ")),
          f("Consents withdrawn", scopeText(r.withdrawal_scope_json ?? r.scope_json)),
          long("Reason", r.withdrawal_reason),
          f("Channel", r.request_channel),
          f("Processing hold", r.processing_hold_active ? "Active" : ""),
          f("Escalated", r.escalation_required ? "Yes" : ""),
          date("Decision due (SLA)", r.sla_due_at),
          date("Submitted", r.created_at),
        ),
        submittedAt: iso(r.created_at),
        priority: breached || r.escalation_required ? "high" : "normal",
        viewPath: `/compliance/dpdp-withdrawal-admin?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true, // reject endpoint 400s without a reason
        meta: { status: r.status },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (action === "approve") await ctx.call("POST", `/api/privacy/dpdp-withdrawal/${id}/approve`, { body: { remarks: remarks || undefined } });
    else await ctx.call("POST", `/api/privacy/dpdp-withdrawal/${id}/reject`, { body: { reason: remarks } });
  },
};
