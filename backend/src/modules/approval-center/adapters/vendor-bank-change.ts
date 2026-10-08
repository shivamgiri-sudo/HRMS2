import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, str } from "../format.js";
import { ageDays, callerRoles, hasRole, rowsOf } from "./finance-shared.js";

/**
 * Vendor payee bank-account change (Finance Head / Accounts Head). The route admits only those two
 * roles (super_admin deliberately excluded) and the service refuses the requester, so we mirror both.
 * Only masked account numbers ever leave the module.
 */
export const vendorBankChangeAdapter: ApprovalAdapter = {
  kind: "vendor_bank_change",
  label: "Vendor bank change",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    if (!hasRole(roles, "finance_head", "accounts_head")) return [];
    const res = await ctx.call("GET", "/api/finance/vendor-bank/requests");
    const out: ApprovalItem[] = [];
    for (const r of rowsOf(res?.data ?? res)) {
      if (str(r.requested_by) === ctx.userId) continue;
      const age = ageDays(r.requested_at);
      out.push({
        uid: `vendor_bank_change:${r.id}`,
        kind: "vendor_bank_change",
        kindLabel: "Vendor bank change",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.vendor_name)} — new bank account`,
        subtitle: `${str(r.vendor_code)} · ${str(r.bank_name)} ${str(r.account_number_masked)}`,
        requester: { name: null },
        stage: "Maker-checker approval",
        fields: fields(
          f("Vendor", r.vendor_name),
          f("Vendor code", r.vendor_code),
          badge("Action", r.action),
          f("Current account", r.previous_account_masked),
          f("Current IFSC", r.previous_ifsc),
          f("New account", r.account_number_masked),
          f("New IFSC", r.ifsc),
          f("Account holder", r.account_holder_name),
          f("Bank", r.bank_name),
          f("Bank branch", r.branch_name),
          f("Requested by role", r.requested_by_role),
          date("Requested on", r.requested_at),
          f("Days pending", age),
          long("Reason", r.reason),
        ),
        submittedAt: iso(r.requested_at),
        priority: age !== null && age > 2 ? "high" : "normal",
        viewPath: `/finance/vendor-bank-details?approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
      });
    }
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/finance/vendor-bank/requests/${encodeURIComponent(item.id)}`;
    await ctx.call("POST", `${base}/${action === "approve" ? "approve" : "reject"}`, { body: { reason: remarks || undefined } });
  },
};
