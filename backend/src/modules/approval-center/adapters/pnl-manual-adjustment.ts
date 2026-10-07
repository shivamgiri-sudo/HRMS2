import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoles, hasRole, rowsOf } from "./finance-shared.js";

const LABEL: Record<string, string> = { projected_revenue: "Projected revenue", penalty: "Penalty", reward: "Reward" };

/** Manual P&L adjustment (single stage; super_admin / finance_head / accounts_head, never the creator). */
export const pnlManualAdjustmentAdapter: ApprovalAdapter = {
  kind: "pnl_adjustment",
  label: "P&L manual adjustment",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    if (!hasRole(roles, "super_admin", "finance_head", "accounts_head")) return [];
    const res = await ctx.call("GET", "/api/finance/pnl/manual-adjustments", { query: { status: "pending" } });
    const out: ApprovalItem[] = [];
    for (const r of rowsOf(res)) {
      if (str(r.status) !== "pending") continue;
      if (str(r.created_by) === ctx.userId) continue;
      const age = ageDays(r.created_at);
      const type = LABEL[str(r.adjustment_type)] ?? str(r.adjustment_type);
      out.push({
        uid: `pnl_adjustment:${r.id}`,
        kind: "pnl_adjustment",
        kindLabel: "P&L manual adjustment",
        category: "Finance",
        id: String(r.id),
        title: `${type} — ${money("", r.amount).value}`,
        subtitle: `${str(r.process_name)} · ${str(r.period_code)}`,
        requester: { name: str(r.created_by_name) || null, branch: r.branch_name },
        stage: "Finance approval",
        fields: fields(
          badge("Adjustment type", type),
          money("Amount", r.amount),
          f("Process", r.process_name),
          f("Branch", r.branch_name),
          f("Period", r.period_code),
          f("Raised by", r.created_by_name),
          date("Raised on", r.created_at),
          f("Days pending", age),
          long("Reason", r.reason),
        ),
        submittedAt: iso(r.created_at),
        priority: age !== null && age > 7 ? "high" : "normal",
        viewPath: `/finance/process-pnl/${encodeURIComponent(str(r.process_id))}?period=${encodeURIComponent(str(r.period_code))}&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/finance/pnl/manual-adjustments/${encodeURIComponent(item.id)}`;
    if (action === "approve") await ctx.call("PUT", `${base}/approve`);
    else await ctx.call("PUT", `${base}/reject`, { body: { reason: remarks } });
  },
};
