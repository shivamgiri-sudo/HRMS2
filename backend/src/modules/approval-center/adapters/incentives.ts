import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoleKeys, roleMeets } from "./payroll-shared.js";

function mapBatch(r: any, mode: "batch" | "chain"): ApprovalItem {
  const age = ageDays(r.created_at);
  const chain = mode === "chain";
  return {
    uid: `incentive_batch:${r.id}`,
    kind: "incentive_batch",
    kindLabel: "Incentive batch",
    category: "Payroll",
    id: String(r.id),
    title: `${str(r.incentive_name) || "Incentive"} — ${str(r.pay_month)}`,
    subtitle: `${str(r.total_employees)} employee(s) · ₹${Number(r.total_amount ?? 0).toLocaleString("en-IN")}`,
    stage: chain ? `Approval chain step ${str(r.pending_step)} — ${str(r.required_role).replace(/_/g, " ")}` : "Finance / Admin approval",
    fields: fields(
      f("Incentive", r.incentive_name),
      f("Incentive code", r.incentive_code),
      f("Pay month", r.pay_month),
      f("Employees", r.total_employees),
      money("Total amount", r.total_amount),
      badge("Batch status", str(r.status).replace(/_/g, " ")),
      f("Batch ref", r.batch_ref),
      f("Source file", r.upload_filename),
      long("Uploader remarks", r.remarks),
      f("Created", r.created_at ? String(r.created_at).slice(0, 10) : ""),
    ),
    submittedAt: iso(r.created_at),
    priority: age !== null && age >= 5 ? "high" : "normal",
    viewPath: `/payroll/incentives?approvalId=${encodeURIComponent(String(r.id))}`,
    // /batches/:id/approve|reject take optional remarks; step-reject demands a reason.
    rejectNeedsReason: chain,
    meta: { mode },
  };
}

/**
 * Incentive batches. Two server flows exist:
 *  - batch (what the Incentives page's Approval Queue uses): status 'pending_approval', POST /batches/:id/approve|reject, admin / finance only.
 *  - chain (branch_head -> operations_head -> finance_head, GET /approvals/pending, POST /batches/:id/step-approve|step-reject): that list already
 *    filters to the caller's first role = the pending step's required role and to visible batches, so every row is actionable.
 * No frontend currently starts the chain; its items are listed in case /approval-chain/init was called directly.
 */
export const incentivesAdapter: ApprovalAdapter = {
  kind: "incentive_batch",
  label: "Incentive batch",
  category: "Payroll",
  async list(ctx) {
    const roles = await callerRoleKeys(ctx.userId);
    const out: ApprovalItem[] = [];
    const seen = new Set<string>();
    if (roleMeets(roles, "admin", "finance")) {
      const res = await ctx.call("GET", "/api/incentives/batches").catch(() => null);
      for (const r of ((res?.data ?? []) as any[]).filter((b) => b.status === "pending_approval").slice(0, 200)) {
        seen.add(String(r.id));
        out.push(mapBatch(r, "batch"));
      }
    }
    const chain = await ctx.call("GET", "/api/incentives/approvals/pending").catch(() => null);
    for (const r of ((chain?.data ?? []) as any[]).slice(0, 200)) {
      if (seen.has(String(r.id))) continue;
      out.push(mapBatch(r, "chain"));
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    if (item.meta?.mode === "chain") {
      if (action === "approve") await ctx.call("POST", `/api/incentives/batches/${id}/step-approve`, { body: { remarks: remarks || undefined } });
      else await ctx.call("POST", `/api/incentives/batches/${id}/step-reject`, { body: { reason: remarks } });
      return;
    }
    await ctx.call("POST", `/api/incentives/batches/${id}/${action === "approve" ? "approve" : "reject"}`, { body: { remarks: remarks || undefined } });
  },
};
