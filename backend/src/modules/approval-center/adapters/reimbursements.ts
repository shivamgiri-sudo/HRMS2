import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays } from "./payroll-shared.js";
import { branchAllowed, callerHolds, callerScope, isOwnEmployee } from "./scope-guard.js";

type Stage = "manager" | "branch_head";

function mapClaim(r: any, stage: Stage): ApprovalItem {
  const mgr = stage === "manager";
  const since = mgr ? r.submitted_at ?? r.created_at : r.manager_reviewed_at ?? r.submitted_at;
  const age = ageDays(since);
  return {
    uid: `reimbursement:${r.id}`,
    kind: "reimbursement",
    kindLabel: "Reimbursement claim",
    category: "Finance",
    id: String(r.id),
    title: `${str(r.employee_name) || str(r.employee_code) || "Employee"} — ${str(r.claim_type) || "Claim"} reimbursement`,
    subtitle: `₹${Number(r.amount_claimed).toLocaleString("en-IN")} · ${str(r.claim_month)}`,
    requester: { name: r.employee_name, code: r.employee_code },
    stage: mgr ? "Stage 1 of 2 — Reporting manager" : "Stage 2 of 2 — Branch head",
    fields: fields(
      f("Employee", r.employee_name),
      f("Employee code", r.employee_code),
      badge("Claim type", r.claim_type),
      f("Claim month", r.claim_month),
      money("Amount claimed", r.amount_claimed),
      money("Amount approved so far", r.amount_approved),
      long("Description", r.description),
      f("Attachment", r.attachment_original_name),
      date("Submitted on", r.submitted_at ?? r.created_at),
      date("Manager reviewed on", r.manager_reviewed_at),
      long("Manager note", r.manager_review_note),
    ),
    submittedAt: iso(since),
    priority: age !== null && age >= 5 ? "high" : "normal",
    viewPath: `/payroll/reimbursements?approvalId=${encodeURIComponent(String(r.id))}`,
    // Both manager-reject and branch-head-reject refuse an empty reason.
    rejectNeedsReason: true,
    meta: { stage },
  };
}

/**
 * Reimbursement / imprest claims, two approval stages. Each queue endpoint already returns only what the caller can act on
 * (manager queue = the caller's own reportees' submitted claims; branch-head queue = manager-approved claims in the caller's
 * branches, role-gated). The third queue (conversion to GRN) is a finance conversion, not an approve/reject, so it is not listed.
 *
 * Responsible-person rules applied on top: the manager stage is only ever the employee's own reporting manager (the module's queue and
 * decide both resolve it from reporting_manager_id, so nothing extra is needed); the branch-head stage is narrowed to the claim's branch
 * being the caller's OWN branch (the module's queue also unions user_assignment_scope branches, which may narrow but never widen)
 * unless the caller is org-wide; nobody sees their own claim.
 */
export const reimbursementsAdapter: ApprovalAdapter = {
  kind: "reimbursement",
  label: "Reimbursement claim",
  category: "Finance",
  async list(ctx) {
    const [mgr, bh] = await Promise.all([
      ctx.call("GET", "/api/payroll/reimbursements/manager-queue").catch(() => null),
      ctx.call("GET", "/api/payroll/reimbursements/branch-head-queue").catch(() => null),
    ]);
    const me = await callerScope(ctx);
    const out: ApprovalItem[] = [];
    for (const r of ((mgr?.data ?? []) as any[]).slice(0, 200)) {
      if (r.status === "submitted" && !isOwnEmployee(me, r.employee_id)) out.push(mapClaim(r, "manager"));
    }
    // The branch-head stage is role-designated: the queue endpoint also admits super_admin for every branch, which is "able to",
    // not "designated" - so the caller must literally hold branch_head.
    const isBranchHead = callerHolds(me, "branch_head");
    for (const r of isBranchHead ? ((bh?.data ?? []) as any[]).slice(0, 200) : []) {
      if (r.status !== "manager_approved" || isOwnEmployee(me, r.employee_id) || !branchAllowed(me, r.branch_id)) continue;
      out.push(mapClaim(r, "branch_head"));
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    const prefix = item.meta?.stage === "branch_head" ? "branch-head" : "manager";
    if (action === "approve") {
      await ctx.call("PATCH", `/api/payroll/reimbursements/${id}/${prefix}-approve`, { body: { note: remarks || undefined } });
    } else {
      await ctx.call("PATCH", `/api/payroll/reimbursements/${id}/${prefix}-reject`, { body: { reason: remarks } });
    }
  },
};
