import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoles, hasRole, rowsOf } from "./finance-shared.js";

/**
 * Imprest float allocation raised as 'submitted'; Finance Head / super_admin disburse (approve) or reject.
 * The review endpoint has no maker-checker rule and the list endpoint is already branch-scoped, so neither is
 * re-implemented here. Approving credits the float and writes the bank ledger — all inside the module.
 */
export const imprestAllocationAdapter: ApprovalAdapter = {
  kind: "imprest_allocation",
  label: "Imprest allocation",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    if (!hasRole(roles, "finance_head", "super_admin")) return [];
    const out: ApprovalItem[] = [];
    for (const status of ["submitted", "branch_head_approved"]) {
      const res = await ctx.call("GET", "/api/finance/imprest/allocations", { query: { status } });
      for (const r of rowsOf(res)) {
        if (str(r.status) !== status) continue;
        const age = ageDays(r.submitted_at ?? r.created_at);
        const holder = str(r.manager_name) || str(r.tally_name);
        out.push({
          uid: `imprest_allocation:${r.id}`,
          kind: "imprest_allocation",
          kindLabel: "Imprest allocation",
          category: "Finance",
          id: String(r.id),
          title: `${str(r.allocation_no) || "Imprest allocation"} — ${money("", r.amount).value}`,
          subtitle: [holder, str(r.branch_name)].filter(Boolean).join(" · "),
          requester: { branch: r.branch_name },
          stage: "Finance Head approval (disburses the float)",
          fields: fields(
            f("Allocation number", r.allocation_no),
            f("Imprest holder", holder),
            f("Branch", r.branch_name),
            money("Amount", r.amount),
            date("Allocation date", r.allocation_date),
            badge("Payment mode", r.payment_mode),
            f("Bank", r.bank_name),
            f("Reference", r.reference_no),
            date("Transaction date", r.transaction_date),
            f("P&L period override", r.period_code),
            date("Submitted on", r.submitted_at ?? r.created_at),
            f("Days pending", age),
            long("Remarks", r.remarks),
          ),
          submittedAt: iso(r.submitted_at ?? r.created_at),
          priority: age !== null && age > 3 ? "high" : "normal",
          viewPath: `/finance/grn?tab=imprest&pane=allocation&approvalId=${encodeURIComponent(String(r.id))}`,
          rejectNeedsReason: true,
          approveLabel: "Approve & disburse",
        });
      }
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/finance/imprest/allocations/${encodeURIComponent(item.id)}/review`, {
      body: { decision: action === "approve" ? "approve" : "reject", remarks: remarks || undefined },
    });
  },
};
