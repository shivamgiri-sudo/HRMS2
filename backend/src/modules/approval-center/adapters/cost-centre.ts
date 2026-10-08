import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoles, hasRole, rowsOf } from "./finance-shared.js";
import { branchAllowed, callerScope } from "./scope-guard.js";

const yn = (v: unknown) => (v === null || v === undefined || v === "" ? "" : Number(v) === 1 || v === true ? "Yes" : "No");

/**
 * Cost-centre creation approvals. L1 (pending_l1): finance_head / accounts_head / admin / super_admin.
 * L2 (pending_l2): admin / super_admin only (approve-l2 route). The queue endpoint picks rows from the
 * caller's primary role; we additionally require the stage's role in the caller's full role set and drop
 * anything the caller raised or submitted (maker-checker at both stages).
 * The approval queue and approve/reject routes have NO branch check, and `admin` (branch-scoped) is an L1 and L2 approver, so a
 * cost centre is only shown to an admin when it belongs to the admin's OWN branch; finance_head / accounts_head / super_admin
 * (org-wide) see every branch.
 */
export const costCentreAdapter: ApprovalAdapter = {
  kind: "cost_centre",
  label: "Cost centre",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    const l1 = hasRole(roles, "finance_head", "accounts_head", "admin", "super_admin");
    const l2 = hasRole(roles, "admin", "super_admin");
    if (!l1 && !l2) return [];
    const res = await ctx.call("GET", "/api/finance/cost-centres/approval-queue");
    const me = await callerScope(ctx);
    const out: ApprovalItem[] = [];
    for (const r of rowsOf(res)) {
      const status = str(r.status);
      if (!branchAllowed(me, r.branch_id)) continue;
      if (status === "pending_l1" ? !l1 : status === "pending_l2" ? !l2 : true) continue;
      if (str(r.created_by) === ctx.userId || str(r.submitted_by) === ctx.userId) continue;
      const age = ageDays(r.submitted_at);
      const stage = status === "pending_l1" ? "Stage 1 of 2 — L1 (Finance)" : "Stage 2 of 2 — L2 (Admin / CEO)";
      out.push({
        uid: `cost_centre:${r.id}`,
        kind: "cost_centre",
        kindLabel: "Cost centre",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.cost_centre_code)} — ${str(r.cost_centre_name)}`,
        subtitle: [str(r.client_name), str(r.branch_name), str(r.process_name)].filter(Boolean).join(" · "),
        requester: { name: r.submitted_by_name, branch: r.branch_name },
        stage,
        fields: fields(
          f("Cost centre code", r.cost_centre_code),
          f("Cost centre name", r.cost_centre_name),
          f("Client / process name", r.client_name),
          f("Billing entity", r.billing_client_name),
          f("Branch", r.branch_name),
          f("Process", r.process_name),
          f("LOB", r.lob_name),
          f("Cost-centre type", r.cost_center_type),
          f("Group", r.group_cost_center),
          f("Mandated seats", r.mandated_seats_value),
          f("Shrinkage %", r.shrinkage_percentage),
          f("Attrition %", r.attrition_percentage),
          f("Shift hours", r.shift_hours),
          f("Working days / week", r.working_days_per_week),
          f("Training days", r.training_days),
          f("Incentive allowed", yn(r.incentive_allowed)),
          f("Deduction allowed", yn(r.deduction_allowed)),
          f("Revenue", yn(r.revenue_flag)),
          f("Billing", yn(r.billing_flag)),
          f("Revenue type", r.revenue_type),
          money("Fixed amount", r.fixed_amount),
          f("Variable base", r.variable_base),
          f("Payment mode", r.payment_mode),
          f("Payment terms", r.payment_terms),
          f("HSN", r.hsn_code),
          f("SAC", r.sac_code),
          f("Submitted by", r.submitted_by_name),
          date("Submitted on", r.submitted_at),
          f("Revision", r.revision_no),
          f("Days pending", age),
          long("Last rejection note", r.rejection_reason),
          badge("Stage", status === "pending_l1" ? "Pending L1" : "Pending L2"),
        ),
        submittedAt: iso(r.submitted_at),
        priority: age !== null && age > 3 ? "high" : "normal",
        viewPath: `/finance/cost-centres?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: status === "pending_l1" ? "Approve (L1)" : "Approve (L2)",
        meta: { status },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/finance/cost-centres/${encodeURIComponent(item.id)}`;
    if (action === "reject") {
      await ctx.call("POST", `${base}/reject`, { body: { reason: remarks } });
      return;
    }
    const level = item.meta?.status === "pending_l2" ? "approve-l2" : "approve-l1";
    await ctx.call("POST", `${base}/${level}`, { body: { remarks: remarks || undefined } });
  },
};
