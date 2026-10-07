import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoles, hasRole } from "./finance-shared.js";

const MAX_DETAIL = 30;
const LINE_LABEL: Record<string, string> = { seat: "Seat", metric: "Metric", fixed: "Fixed", reward: "Reward", penalty: "Penalty" };

/** YYYY-MM for the month `offset` months from `base` (IST-agnostic; the server only needs a window). */
export function periodWindow(base = new Date(), offsets = [-1, 0, 1, 2]): string[] {
  return offsets.map((o) => {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + o, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function lineText(l: any): string {
  const kind = LINE_LABEL[str(l.line_type)] ?? str(l.line_type);
  const calc = l.quantity !== null && l.quantity !== undefined && Number(l.rate) > 0 ? ` | ${Number(l.quantity)} x ${money("", l.rate).value}` : "";
  return `${kind}: ${str(l.description)}${calc} = ${money("", l.amount).value}`;
}

/**
 * Revenue forecast (Finance Head only; super_admin may act too). The list endpoint is per-period and
 * returns every cost centre, so we scan a month window and keep rows submitted + finance-head pending,
 * then read each forecast to get its lines and the submitter (a forecast cannot be approved by its submitter).
 */
export const revenueForecastAdapter: ApprovalAdapter = {
  kind: "revenue_forecast",
  label: "Revenue forecast",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    if (!hasRole(roles, "super_admin", "finance_head")) return [];
    const lists = await Promise.all(
      periodWindow().map((period) =>
        ctx.call("GET", "/api/finance/revenue-forecasts", { query: { period } }).then((r) => ({ period, rows: r?.data?.rows ?? [] })),
      ),
    );
    const due: Array<{ period: string; row: any }> = [];
    for (const l of lists) {
      for (const r of l.rows) if (str(r.status) === "submitted" && str(r.financeHeadStatus) === "pending" && r.forecastId) due.push({ period: l.period, row: r });
    }
    const picked = due.slice(0, MAX_DETAIL);
    const details = await Promise.all(
      picked.map((d) => ctx.call("GET", `/api/finance/revenue-forecasts/${encodeURIComponent(String(d.row.forecastId))}`).then((x) => x?.data ?? x).catch(() => null)),
    );

    const out: ApprovalItem[] = [];
    picked.forEach(({ period, row }, i) => {
      const d: any = details[i];
      if (!d) return; // cannot prove it is not the caller's own submission
      if (str(d.submitted_by) === ctx.userId) return;
      if (str(d.status) !== "submitted" || str(d.finance_head_status) !== "pending") return;
      const lines: any[] = Array.isArray(d.lines) ? d.lines : [];
      const age = ageDays(d.submitted_at);
      out.push({
        uid: `revenue_forecast:${row.forecastId}`,
        kind: "revenue_forecast",
        kindLabel: "Revenue forecast",
        category: "Finance",
        id: String(row.forecastId),
        title: `${str(d.cost_centre_code) || str(row.costCentreCode)} — ${period} forecast ${money("", d.forecast_amount ?? row.forecastAmount).value}`,
        subtitle: [str(d.branch_name ?? row.branchName), str(row.processName)].filter(Boolean).join(" · "),
        requester: { branch: d.branch_name ?? row.branchName },
        stage: "Finance Head approval",
        fields: fields(
          f("Branch", d.branch_name ?? row.branchName),
          f("Cost centre", `${str(d.cost_centre_code)} ${str(d.cost_centre_name)}`.trim()),
          f("Process", row.processName),
          f("Forecast month", period),
          money("Forecast amount", d.forecast_amount ?? row.forecastAmount),
          f("Forecast lines", lines.length || ""),
          long("Line detail", lines.map(lineText).join("\n")),
          badge("Finance Head", "Pending"),
          badge("Payroll Head (view only)", str(d.payroll_head_status)),
          date("Submitted on", d.submitted_at),
          f("Days pending", age),
          long("Notes", d.notes),
        ),
        submittedAt: iso(d.submitted_at),
        priority: age !== null && age > 3 ? "high" : "normal",
        viewPath: `/finance/revenue-forecast?period=${period}&approvalId=${encodeURIComponent(String(row.forecastId))}`,
        rejectNeedsReason: true,
      });
    });
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("POST", `/api/finance/revenue-forecasts/${encodeURIComponent(item.id)}/review`, {
      body: { decision: action === "approve" ? "approved" : "rejected", note: remarks || null },
    });
  },
};
