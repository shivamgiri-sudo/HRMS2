import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoleKeys, roleMeets } from "./payroll-shared.js";

/**
 * Payroll run sign-off. Stage 1 finance-approve (finance / payroll_head / super_admin): runs in 'processing' with no finance approval.
 * Stage 2 ceo-acknowledge (ceo / super_admin): finance-approved runs whose net total is above the CEO threshold and not yet acknowledged.
 * The sign-off API has no reject, so rejecting is not offered (meta.noReject).
 */
export const payrollSignoffAdapter: ApprovalAdapter = {
  kind: "payroll_signoff",
  label: "Payroll sign-off",
  category: "Payroll",
  async list(ctx) {
    const roles = await callerRoleKeys(ctx.userId);
    const canFinance = roleMeets(roles, "finance", "payroll_head", "super_admin");
    const canCeo = roleMeets(roles, "ceo", "super_admin");
    if (!canFinance && !canCeo) return [];
    const out: ApprovalItem[] = [];

    if (canFinance) {
      const res = await ctx.call("GET", "/api/payroll/signoff/runs");
      for (const r of ((res?.data ?? []) as any[]).slice(0, 20)) {
        if (r.finance_approved_at || String(r.status ?? "").toLowerCase() !== "processing") continue;
        out.push(mapRun(r, "finance"));
      }
    }
    if (canCeo) {
      const res = await ctx.call("GET", "/api/payroll/signoff/runs", { query: { include: "pipeline" } });
      const candidates = ((res?.data ?? []) as any[]).filter((r) => r.finance_approved_at && !r.ceo_acknowledged_at).slice(0, 20);
      for (const r of candidates) {
        // ceo_required (net total above the configured threshold) is only on the status endpoint. <= 20 runs.
        let required = false;
        try {
          const st = await ctx.call("GET", `/api/payroll/signoff/runs/${encodeURIComponent(String(r.id))}/status`);
          required = st?.data?.ceo_required === true;
        } catch { /* not visible to caller */ }
        if (required) out.push(mapRun(r, "ceo"));
      }
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    if (action === "reject") throw new Error("Payroll sign-off cannot be rejected here. Open the sign-off page to raise it with Payroll.");
    const path = item.meta?.stage === "ceo" ? "ceo-acknowledge" : "finance-approve";
    await ctx.call("POST", `/api/payroll/signoff/runs/${encodeURIComponent(item.id)}/${path}`, { body: { remarks: remarks || undefined } });
  },
};

function mapRun(r: any, stage: "finance" | "ceo"): ApprovalItem {
  const finance = stage === "finance";
  const age = ageDays(r.finance_approved_at ?? null);
  return {
    uid: `payroll_signoff:${r.id}`,
    kind: "payroll_signoff",
    kindLabel: "Payroll sign-off",
    category: "Payroll",
    id: String(r.id),
    title: `Payroll run ${str(r.run_month)} — ${finance ? "finance approval" : "CEO acknowledgement"}`,
    subtitle: `${str(r.employee_count)} employees · net ₹${Number(r.total_net_salary).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
    stage: finance ? "Stage 1 of 2 — Finance approval" : "Stage 2 of 2 — CEO acknowledgement",
    fields: fields(
      f("Payroll month", r.run_month),
      badge("Run status", r.status),
      f("Employees on run", r.employee_count),
      f("Headcount on run header", r.header_employee_count),
      money("Total net salary", r.total_net_salary),
      f("Run created by", r.created_by),
      date("Finance approved on", r.finance_approved_at),
      long("Finance remarks", r.finance_remarks),
    ),
    submittedAt: iso(r.finance_approved_at),
    priority: !finance && age !== null && age >= 2 ? "high" : "normal",
    viewPath: `/payroll/sign-off?approvalId=${encodeURIComponent(String(r.id))}`,
    rejectNeedsReason: false,
    approveLabel: finance ? "Finance approve" : "Acknowledge",
    meta: { stage, noReject: true },
  };
}
