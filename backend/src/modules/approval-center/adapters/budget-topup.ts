import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoles, hasRole, rowsOf } from "./finance-shared.js";

const STAGES: Record<string, { role: string; label: string; step: number }> = {
  submitted: { role: "branch_head", label: "Branch Head", step: 1 },
  branch_head_approved: { role: "finance_head", label: "Finance Head", step: 2 },
};

/**
 * Budget top-up requests (2 stages). The list endpoint is branch-scoped but returns every status
 * and role's view; actionable = status at a stage the caller owns (or super_admin) and not raised by the caller
 * (budgetTopupService.review refuses both decisions on your own request).
 */
export const budgetTopupAdapter: ApprovalAdapter = {
  kind: "budget_topup",
  label: "Budget top-up",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    const isSuper = hasRole(roles, "super_admin");
    const allowed = Object.keys(STAGES).filter((s) => isSuper || hasRole(roles, STAGES[s].role));
    if (!allowed.length) return [];
    const res = await ctx.call("GET", "/api/finance/pnl/budget-topups");
    const out: ApprovalItem[] = [];
    for (const r of rowsOf(res)) {
      const status = str(r.status);
      if (!allowed.includes(status)) continue;
      if (str(r.requested_by) === ctx.userId) continue;
      const st = STAGES[status];
      const age = ageDays(r.pending_since ?? r.created_at);
      const newLine = Number(r.is_new_line) === 1;
      out.push({
        uid: `budget_topup:${r.id}`,
        kind: "budget_topup",
        kindLabel: "Budget top-up",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.head)}${r.sub_head ? " · " + str(r.sub_head) : ""} — ${money("", r.requested_amount).value}`,
        subtitle: `${str(r.branch_name)} · ${str(r.period_code)} · ${str(r.budget_number)}`,
        requester: { name: r.requested_by_name, branch: r.branch_name },
        stage: `Stage ${st.step} of 2 — ${st.label}`,
        fields: fields(
          f("Branch", r.branch_name),
          f("Budget", r.budget_number),
          f("Period", r.period_code),
          f("Head", r.head),
          f("Sub-head", r.sub_head),
          f("Budget line", r.item_name),
          badge("Request type", newLine ? "New budget line" : "Increase to existing line"),
          money("Requested amount", r.requested_amount),
          f("Requested quantity", r.requested_quantity),
          f("Unit", r.unit),
          money("Unit rate", r.unit_rate),
          f("Allocation driver", r.allocation_driver),
          f("Raised by", r.requested_by_name),
          date("Raised on", r.created_at),
          f("Pending with", r.pending_with),
          f("Days pending", age),
          f("Branch Head reviewed", r.branch_head_reviewed_by_name),
          date("Branch Head reviewed on", r.branch_head_reviewed_at),
          long("Branch Head note", r.branch_head_review_note),
          long("Reason", r.reason),
        ),
        submittedAt: iso(r.created_at),
        priority: age !== null && age > 3 ? "high" : "normal",
        viewPath: `/finance/branch-budget?tab=topups&branchId=${encodeURIComponent(str(r.branch_id))}&period=${encodeURIComponent(str(r.period_code))}&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: status === "branch_head_approved" ? "Approve & apply" : "Approve & forward",
        meta: { status },
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/finance/pnl/budget-topups/${encodeURIComponent(item.id)}/review`, {
      body: { decision: action === "approve" ? "approve" : "reject", remarks: remarks || undefined },
    });
  },
};
