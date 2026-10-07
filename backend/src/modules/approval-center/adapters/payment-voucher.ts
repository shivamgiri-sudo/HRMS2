import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, callerRoles, hasRole, rowsOf } from "./finance-shared.js";

const MAX_DETAIL = 30;
const SOURCE_LABEL: Record<string, string> = {
  vendor_grn: "Vendor payment (GRN)",
  imprest_allocation: "Imprest allocation",
  sales_receipt: "Sales receipt",
  vendor_advance: "Vendor advance",
  vendor_advance_application: "Vendor advance application",
};

/**
 * Payment voucher: the CEO gate (status 'raised'). Release (Finance Head) and the Accounts Head's
 * post-release sign-off are not approve/decline decisions and stay on the page. Maker-checker: raised_by != caller.
 * "Decline" maps to the CEO's reject (the endpoint's own default reason applies when none is typed).
 */
export const paymentVoucherAdapter: ApprovalAdapter = {
  kind: "payment_voucher",
  label: "Payment voucher",
  category: "Finance",
  async list(ctx) {
    const roles = await callerRoles(ctx);
    if (!hasRole(roles, "ceo", "super_admin")) return [];
    const res = await ctx.call("GET", "/api/finance/payment-vouchers", { query: { status: "raised", limit: 200 } });
    const rows = rowsOf(res).filter((r) => str(r.status) === "raised" && str(r.raised_by) !== ctx.userId);
    const picked = rows.slice(0, MAX_DETAIL);
    const details = await Promise.all(
      picked.map((r) => ctx.call("GET", `/api/finance/payment-vouchers/${encodeURIComponent(String(r.id))}`).then((d) => d?.data ?? d).catch(() => null)),
    );
    const out: ApprovalItem[] = [];
    picked.forEach((r, i) => {
      const d: any = details[i] ?? {};
      const m = { ...r, ...d };
      const allocations: any[] = Array.isArray(d.grn_allocations) ? d.grn_allocations : [];
      const age = ageDays(m.raised_at);
      const payee = str(m.vendor_name) || str(m.linked_vendor_name) || str(m.imprest_manager_name);
      const source = SOURCE_LABEL[str(m.source_type)] ?? str(m.source_type);
      const bal = m.current_bank_balance;
      out.push({
        uid: `payment_voucher:${r.id}`,
        kind: "payment_voucher",
        kindLabel: "Payment voucher",
        category: "Finance",
        id: String(r.id),
        title: `${str(m.voucher_number) || "Payment voucher"} — ${money("", m.amount).value}`,
        subtitle: [payee, source].filter(Boolean).join(" · "),
        requester: { name: m.raised_by_name },
        stage: "CEO approval (before release)",
        fields: fields(
          f("Voucher number", m.voucher_number),
          badge("Voucher type", m.voucher_type),
          badge("Source", source),
          f("Payee", payee),
          money("Net amount", m.amount),
          money("Vendor due", m.vendor_due_amount),
          money("TDS deducted", m.tds_deducted_amount),
          f("GRN", m.grn_number),
          f("Head", m.head),
          f("Sub-head", m.sub_head),
          date("Bill due date", m.due_date),
          f("GRNs in this voucher", allocations.length > 1 ? allocations.length : ""),
          long(
            "GRN allocations",
            allocations.length > 1
              ? allocations.map((a) => `${str(a.grn_number)} — ${str(a.vendor_name)} — pays ${money("", a.allocated_amount).value} of ${money("", a.due_amount).value}`).join("\n")
              : "",
          ),
          f("Bank account", m.bank_account_name),
          money("Bank balance now", bal),
          f("Payable account", m.payable_account_name),
          f("Raised by", m.raised_by_name),
          date("Raised on", m.raised_at),
          f("Days pending", age),
          long("Reason", m.reason),
          long("Remarks", m.remarks),
        ),
        submittedAt: iso(m.raised_at ?? m.created_at),
        priority: age !== null && age > 2 ? "high" : "normal",
        viewPath: `/finance/ledger?tab=payments&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
      });
    });
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/finance/payment-vouchers/${encodeURIComponent(item.id)}`;
    await ctx.call("POST", action === "approve" ? `${base}/ceo-approve` : `${base}/reject`, { body: { note: remarks || null } });
  },
};
