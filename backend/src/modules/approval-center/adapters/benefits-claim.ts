import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { getEmployeeForUser } from "../../../shared/accessGuard.js";

/**
 * Benefits / reimbursement claim review (admin / hr, branch-scoped by the module).
 * GET /api/benefits/claims returns the CALLER'S OWN claims to non-privileged users and adds `stats` only for
 * privileged reviewers, so a response without `stats` is not a review queue and is ignored.
 */
export const benefitsClaimAdapter: ApprovalAdapter = {
  kind: "benefits_claim",
  label: "Benefit / reimbursement claim",
  category: "Finance",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/benefits/claims", { query: { status: "submitted" } });
    if (!res || res.stats === undefined) return [];
    const rows: any[] = (res.data ?? []).slice(0, 200);
    const me = await getEmployeeForUser(ctx.userId).catch(() => null);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (r.status !== "submitted") continue;
      if (me && String(r.employee_id) === me.id) continue; // never review own claim
      out.push({
        uid: `benefits_claim:${r.id}`,
        kind: "benefits_claim",
        kindLabel: "Benefit / reimbursement claim",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — ${str(r.claim_type) || "claim"} claim`,
        subtitle: r.amount !== undefined && r.amount !== null ? `₹${Number(r.amount).toLocaleString("en-IN")}` : undefined,
        requester: { name: r.employee_name, code: r.employee_code },
        stage: "HR review",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          badge("Claim type", r.claim_type),
          money("Amount", r.amount),
          date("Claim date", r.claim_date),
          long("Description", r.description),
          f("Receipt reference", r.receipt_ref),
          date("Submitted", r.created_at),
        ),
        submittedAt: iso(r.created_at ?? r.claim_date),
        viewPath: `/benefits?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false, // review endpoint treats remarks as optional
        meta: {},
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("PATCH", `/api/benefits/claims/${encodeURIComponent(item.id)}/review`, {
      body: { action: action === "approve" ? "approved" : "rejected", remarks: remarks || undefined },
    });
  },
};
