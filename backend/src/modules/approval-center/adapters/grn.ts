import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerBranchScope, callerRoles, hasRole, inBranchScope, rowsOf } from "./finance-shared.js";
import { branchAllowed, callerScope } from "./scope-guard.js";

/** GRN chain (owner ruling 2026-09-12): Branch Head -> Accounts Head -> Finance Head. Mirrors resolveFinanceStageRole("grn"). */
const STAGES: Record<string, { role: string; label: string; step: number }> = {
  submitted: { role: "branch_head", label: "Branch Head", step: 1 },
  branch_head_approved: { role: "accounts_head", label: "Accounts Head", step: 2 },
  accounts_head_approved: { role: "finance_head", label: "Finance Head / CFO", step: 3 },
};

/** Same maker-checker rules as grnService.reviewGrn (approve only). */
function makerCheckerBlocked(row: any, status: string, userId: string): boolean {
  const me = userId;
  if (str(row.submitted_by) === me) return true;
  if (status === "branch_head_approved" || status === "accounts_head_approved") {
    if (str(row.branch_head_reviewed_by) === me) return true;
  }
  if (status === "accounts_head_approved" && str(row.accounts_head_reviewed_by) === me) return true;
  return false;
}

export const grnAdapter: ApprovalAdapter = {
  kind: "grn",
  label: "GRN / vendor bill",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    // Stage-role designated: the module also lets super_admin review any stage (a bypass), but the popup is "pending ON ME", so the
    // caller must literally hold the stage's role. super_admin alone sees nothing here.
    const statuses = Object.keys(STAGES).filter((s) => hasRole(roles, STAGES[s].role));
    if (!statuses.length) return [];
    const scope = await callerBranchScope(ctx, roles);
    if (!scope) return [];
    const me = await callerScope(ctx);

    const out: ApprovalItem[] = [];
    for (const status of statuses) {
      const res = await ctx.call("GET", "/api/finance/grns", { query: { status, limit: 100 } });
      for (const r of rowsOf(res)) {
        if (str(r.status) !== status) continue;
        // Migrated GRNs carry legacy_raised_by_name (g.* in the list) and no live raiser: history, never listed.
        if (str(r.legacy_raised_by_name)) continue;
        // Reads include Head Office bills shared onto a branch; the review route only admits the record's own branch.
        if (!inBranchScope(scope, r.branch_id)) continue;
        // Owner branch policy: the finance scope resolver treats `admin` as all-branch and unions assignment-granted branches, so a
        // Branch Head who also holds such a role would see other branches' bills. A branch-bound stage needs the caller's OWN branch
        // (Accounts Head / Finance Head / other org-wide roles: every branch).
        if (!branchAllowed(me, r.branch_id)) continue;
        if (makerCheckerBlocked(r, status, ctx.userId)) continue;
        const st = STAGES[status];
        const age = ageDays(r.pending_since ?? r.submitted_at ?? r.created_at);
        const overdue = r.due_date ? ageDays(r.due_date) !== null && new Date(String(r.due_date)).getTime() < Date.now() : false;
        const total = r.amount_with_tax ?? r.amount;
        const number = str(r.grn_number) || "Draft number pending";
        out.push({
          uid: `grn:${r.id}`,
          kind: "grn",
          kindLabel: "GRN / vendor bill",
          category: "Finance",
          id: String(r.id),
          title: `${str(r.vendor_name) || (str(r.grn_type) === "imprest" ? "Imprest voucher" : "GRN")} — ${money("", total).value}`,
          subtitle: [number, str(r.head), str(r.sub_head), str(r.branch_name)].filter(Boolean).join(" · "),
          requester: { name: r.created_by_name, branch: r.branch_name },
          stage: `Stage ${st.step} of 3 — ${st.label}`,
          fields: fields(
            badge("GRN type", r.grn_type),
            f("GRN number", r.grn_number),
            f("Vendor", r.vendor_name),
            f("Vendor GSTIN", r.vendor_gstin),
            f("Invoice number", r.invoice_number),
            f("Branch", r.branch_name),
            f("Process", r.process_name),
            f("Cost centre", r.cost_centre_name),
            f("Cost class", r.cost_class),
            f("Head", r.head),
            f("Sub-head", r.sub_head),
            f("Budget", r.budget_number),
            f("Budget item", r.budget_item_name),
            r.quantity !== null && r.quantity !== undefined && Number(r.quantity) !== 0
              ? f("Quantity", `${r.quantity}${r.unit ? ` ${r.unit}` : ""}`)
              : null,
            money("Unit rate", r.unit_rate),
            money("Amount (excl. tax)", r.amount_without_tax),
            f("GST rate", r.gst_rate ? `${r.gst_rate}%` : ""),
            f("GST type", r.gst_type),
            money("Tax", r.tax_amount),
            money("Other charges", r.other_charges),
            money("Total (incl. tax)", total),
            money("P&L cost", r.pnl_cost_amount),
            date("Bill date", r.bill_date),
            date("Due date", r.due_date),
            f("Payment terms", r.payment_terms_days ? `${r.payment_terms_days} days` : ""),
            f("Accounting period", r.accounting_period),
            f("Split allocation", str(r.allocation_mode) === "split" ? "Yes — split across cost centres / heads" : ""),
            f("Multi-month", Number(r.is_multi_month) === 1 ? "Yes" : ""),
            f("Unbudgeted", Number(r.is_unbudgeted) === 1 ? "Yes — no budget line linked" : ""),
            f("Late invoice", Number(r.is_late_invoice) === 1 ? "Yes" : ""),
            long("Late invoice reason", r.late_invoice_reason),
            f("Document match", r.document_match_status),
            f("Validation score", r.validation_score),
            f("Raised by", r.created_by_name),
            date("Submitted on", r.submitted_at),
            f("Pending with", r.pending_with),
            f("Days pending", age),
            f("Branch Head reviewed", r.branch_head_reviewed_by_name),
            long("Branch Head note", r.branch_head_review_note),
            f("Accounts Head reviewed", r.accounts_head_reviewed_by_name),
            long("Accounts Head note", r.accounts_head_review_note),
            long("Description", r.description),
            long("Remarks", r.remarks),
          ),
          submittedAt: iso(r.pending_since ?? r.submitted_at ?? r.created_at),
          priority: (age !== null && age > 7) || overdue ? "high" : "normal",
          // approvalStatus makes the Approval Queue open on the stage tab that holds this GRN.
          viewPath: `/finance/grn?approvalId=${encodeURIComponent(String(r.id))}&approvalStatus=${status}`,
          rejectNeedsReason: true,
          approveLabel: status === "accounts_head_approved" ? "Approve (final)" : "Approve & forward",
          meta: { status, stageRole: st.role },
        });
      }
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/finance/grns/${encodeURIComponent(item.id)}/review`, {
      body: { decision: action === "approve" ? "approved" : "rejected", reviewNote: remarks || undefined },
    });
  },
};
