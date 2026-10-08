import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";

const parse = (v: unknown): Record<string, any> => {
  if (!v) return {};
  if (typeof v === "string") {
    try { return JSON.parse(v || "{}"); } catch { return {}; }
  }
  return v as Record<string, any>;
};

/** Same convention as the module's own audit mask (maskAccountNumber in payroll-window.routes.ts): last 4 digits only. */
const maskAccount = (v: unknown): string => (str(v) ? `****${str(v).slice(-4)}` : "");

const PENNY_LABEL: Record<string, string> = {
  success: "Verified (penny drop passed)",
  name_mismatch: "Name mismatch",
  initiated: "Penny drop in progress",
  failed: "Penny drop failed",
};

const STALE_DAYS = 3;

/**
 * Bank-detail change, Payroll HO queue (payroll / super_admin; the endpoint is branch-scoped and already limited to
 * pending requests routed to payroll). A name mismatch is only a warning in the module (approval is always permitted),
 * so it is surfaced as a field, not used to hide the item. Account numbers are masked to the last 4 digits.
 * force_override is accepted by the page contract but the route ignores it, so it is not sent.
 */
export const bankChangeAdapter: ApprovalAdapter = {
  kind: "bank_change",
  label: "Bank detail change",
  category: "Payroll",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/payroll/bank-change-requests");
    const rows: any[] = (res?.data ?? []).slice(0, 200);
    const out: ApprovalItem[] = [];
    for (const r of rows) {
      if (str(r.status) && str(r.status) !== "pending") continue;
      const next = parse(r.new_values);
      const prev = parse(r.old_values);
      const penny = str(r.penny_drop_status);
      const submitted = iso(r.requested_at);
      const ageDays = submitted ? (Date.now() - new Date(submitted).getTime()) / 86_400_000 : 0;
      out.push({
        uid: `bank_change:${r.id}`,
        kind: "bank_change",
        kindLabel: "Bank detail change",
        category: "Payroll",
        id: String(r.id),
        title: `${str(r.employee_name) || "Employee"} — bank account change`,
        subtitle: [str(next.bank_name), maskAccount(next.account_number)].filter(Boolean).join(" · ") || undefined,
        requester: { name: r.employee_name, code: r.employee_code },
        stage: "Payroll HO review",
        fields: fields(
          f("Employee", r.employee_name),
          f("Employee code", r.employee_code),
          f("Current bank", prev.bank_name),
          f("Current account", maskAccount(prev.account_number)),
          f("Current IFSC", prev.ifsc_code),
          f("New bank", next.bank_name),
          f("New branch", next.bank_branch),
          f("New account holder", next.account_holder_name),
          f("New account number", maskAccount(next.account_number)),
          f("New IFSC", next.ifsc_code),
          f("Account type", next.account_type),
          badge("Penny drop", PENNY_LABEL[penny] ?? penny),
          f("Name returned by bank", r.beneficiary_name_returned),
          f("Name on HRMS at request", r.employee_name_at_request),
          badge("Name match", r.name_match_tier),
          f("Name match score", r.name_match_score),
          date("Requested on", r.requested_at),
          long("Heads-up", penny === "name_mismatch" ? "The bank returned a different name than the employee profile. Approval is still permitted; check before approving." : ""),
        ),
        submittedAt: submitted,
        priority: ageDays > STALE_DAYS ? "high" : "normal",
        viewPath: `/payroll/ho-queues?tab=bankchg&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    await ctx.call("PATCH", `/api/payroll/bank-change-requests/${encodeURIComponent(item.id)}`, {
      body: { decision: action === "approve" ? "approved" : "rejected", note: remarks || undefined },
    });
  },
};
