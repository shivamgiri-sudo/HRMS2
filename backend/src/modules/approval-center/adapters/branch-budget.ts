import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoles, hasRole, rowsOf } from "./finance-shared.js";

const STAGE_LABEL: Record<string, { label: string; step: number }> = {
  submitted: { label: "Branch Head", step: 1 },
  branch_head_approved: { label: "Finance Head", step: 2 },
};
const MAX_DETAIL = 30;
const MAX_LINE_ROWS = 40;

/** One readable line per budget line: head > sub-head > item, qty x rate, tax, gross, cost centre. */
function lineText(l: any): string {
  const name = [str(l.head), str(l.sub_head), str(l.item_name)].filter(Boolean).join(" > ");
  const qty = Number(l.quantity);
  const rate = Number(l.unit_rate);
  const calc = Number.isFinite(qty) && Number.isFinite(rate) && rate > 0 ? ` | ${qty} ${str(l.unit)} x ${money("", rate).value}` : "";
  const tax = Number(l.tax_amount) > 0 ? ` | tax ${money("", l.tax_amount).value}` : "";
  const cc = str(l.cost_centre_name) ? ` | ${str(l.cost_centre_name)}` : "";
  return `${name}${calc}${tax} | gross ${money("", l.gross_amount).value}${cc}`;
}

/** Totals per head across all lines, e.g. "Rent ₹1,00,000; Utilities ₹20,000". */
function headTotals(lines: any[]): string {
  const m = new Map<string, number>();
  for (const l of lines) m.set(str(l.head) || "(no head)", (m.get(str(l.head) || "(no head)") ?? 0) + (Number(l.gross_amount) || 0));
  return [...m.entries()].map(([h, v]) => `${h} ${money("", v).value}`).join("; ");
}

/**
 * Branch budget, 2 stages (Branch Head -> Finance Head). The module's own inbox endpoint already
 * filters by the caller's role/stage/branch; per-budget detail adds every component and the
 * submitter id so maker-checker (non-exempt reviewers) can be honoured before the buttons show.
 */
export const branchBudgetAdapter: ApprovalAdapter = {
  kind: "branch_budget",
  label: "Branch budget",
  category: "Finance",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/finance/pnl/budgets/pending-my-review");
    const pending = rowsOf(res).filter((r) => STAGE_LABEL[str(r.status)]).slice(0, MAX_DETAIL);
    if (!pending.length) return [];
    const roles = await callerRoles(ctx);
    const exempt = hasRole(roles, "finance_head", "super_admin");

    const details = await Promise.all(
      pending.map((r) =>
        ctx.call("GET", `/api/finance/pnl/budgets/${encodeURIComponent(String(r.id))}`)
          .then((d) => d?.data ?? d)
          .catch(() => null),
      ),
    );

    const out: ApprovalItem[] = [];
    pending.forEach((r, i) => {
      const d: any = details[i];
      const status = str(r.status);
      // Detail missing and reviewer not exempt from maker-checker: cannot prove they may approve.
      if (!d && !exempt) return;
      if (d && !exempt && str(d.submitted_by) === ctx.userId) return;
      if (d && str(d.status) && str(d.status) !== status) return;
      const st = STAGE_LABEL[status];
      const lines: any[] = Array.isArray(d?.lines) ? d.lines : [];
      const age = ageDays(r.updated_at);
      const corrections: any[] = Array.isArray(d?.corrections) ? d.corrections : [];
      const exceptions = d?.exceptions;
      const exceptionCount = Array.isArray(exceptions) ? exceptions.length : Array.isArray(exceptions?.items) ? exceptions.items.length : 0;
      out.push({
        uid: `branch_budget:${r.id}`,
        kind: "branch_budget",
        kindLabel: "Branch budget",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.branch_name) || "Branch"} budget — ${str(r.period_code)}`,
        subtitle: `${str(r.budget_number)} · Gross ${money("", r.gross_budget).value}`,
        requester: { branch: r.branch_name },
        stage: `Stage ${st.step} of 2 — ${st.label}`,
        fields: fields(
          f("Budget number", r.budget_number),
          f("Branch", r.branch_name),
          f("Period", r.period_code),
          f("Financial year", d?.financial_year),
          badge("Status", status.replace(/_/g, " ")),
          f("Revision", r.revision_number),
          money("Base budget", d?.base_budget_amount),
          money("Tax budget", d?.tax_budget_amount),
          money("Gross budget", r.gross_budget),
          money("P&L budget", r.pnl_budget),
          f("Budget lines", lines.length || ""),
          long("Totals by head", headTotals(lines)),
          long(
            "Line detail",
            lines.slice(0, MAX_LINE_ROWS).map(lineText).join("\n") + (lines.length > MAX_LINE_ROWS ? `\n… and ${lines.length - MAX_LINE_ROWS} more` : ""),
          ),
          date("Submitted on", d?.submitted_at),
          date("Branch Head approved on", d?.branch_head_approved_at),
          f("Budget exceptions", exceptionCount || ""),
          long("Earlier correction notes", corrections.slice(0, 5).map((c) => `${str(c.head)}${c.sub_head ? " > " + str(c.sub_head) : ""}: ${str(c.correction_note)}`).join("\n")),
          long("Last rejection reason", d?.rejection_reason),
        ),
        submittedAt: iso(d?.submitted_at ?? r.updated_at),
        priority: age !== null && age > 3 ? "high" : "normal",
        // approvalId opens the review dialog for this exact budget (branchId/period keep the page context in step).
        viewPath: `/finance/branch-budget?tab=approval&branchId=${encodeURIComponent(str(r.branch_id))}&period=${encodeURIComponent(str(r.period_code))}&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: status === "branch_head_approved" ? "Approve (final)" : "Approve & forward",
        meta: { status },
      });
    });
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/finance/pnl/budgets/${encodeURIComponent(item.id)}/review`, {
      body: { decision: action === "approve" ? "approve" : "reject", remarks: remarks || undefined },
    });
  },
};
