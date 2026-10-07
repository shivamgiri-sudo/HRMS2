import { LoopbackError, type ApprovalAdapter, type ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, rowsOf } from "./finance-shared.js";

const MAX_DETAIL = 30;
const lineText = (l: any) => {
  const sign = str(l.line_type) === "deduction" ? "(deduction) " : "";
  return `${sign}${str(l.particulars)} — ${Number(l.qty)} x ${money("", l.rate).value} = ${money("", l.amount).value}`;
};

/**
 * Client-billing proforma awaiting approval. Endpoint roles (admin/finance/finance_head/accounts_head, super_admin)
 * are enforced by the module itself (403 -> empty). Migrated historical rows are never listed: the approve
 * route refuses them. Approving sends no PO numbers, exactly like the page's own Approve button.
 */
export const clientInvoiceAdapter: ApprovalAdapter = {
  kind: "client_invoice",
  label: "Client invoice (proforma)",
  category: "Finance",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/client-billing/proformas", { query: { status: "proforma", limit: 200 } });
    const rows = rowsOf(res).filter((r) => str(r.invoice_status) === "proforma" && Number(r.is_migrated ?? 0) !== 1);
    const picked = rows.slice(0, MAX_DETAIL);
    const details = await Promise.all(
      picked.map((r) => ctx.call("GET", `/api/client-billing/proformas/${encodeURIComponent(String(r.id))}`).then((d) => d?.data ?? d).catch(() => null)),
    );
    const out: ApprovalItem[] = [];
    picked.forEach((r, i) => {
      const lines: any[] = Array.isArray((details[i] as any)?.lines) ? (details[i] as any).lines : [];
      const age = ageDays(r.created_at);
      const client = str(r.cost_centre_display_name) || str(r.cost_centre_code);
      out.push({
        uid: `client_invoice:${r.id}`,
        kind: "client_invoice",
        kindLabel: "Client invoice (proforma)",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.proforma_no) || "Proforma"} — ${money("", r.grand_total).value}`,
        subtitle: [client, `${str(r.month_label)} ${str(r.finance_year)}`.trim()].filter(Boolean).join(" · "),
        stage: "Finance approval (mints the bill number)",
        fields: fields(
          f("Proforma number", r.proforma_no),
          f("Client / cost centre", client),
          f("Cost centre code", r.cost_centre_code),
          badge("Category", r.category),
          f("Billing month", r.month_label),
          f("Finance year", r.finance_year),
          date("Invoice date", r.invoice_date),
          f("GST type", r.apply_gst === 0 ? "No GST" : r.gst_type),
          money("Taxable value", r.total_amount),
          money("IGST", r.igst_amount),
          money("CGST", r.cgst_amount),
          money("SGST", r.sgst_amount),
          money("Grand total", r.grand_total),
          f("Line items", lines.length || ""),
          long("Line detail", lines.map(lineText).join("\n")),
          date("Raised on", r.created_at),
          f("Days pending", age),
          long("Description", r.description),
        ),
        submittedAt: iso(r.created_at),
        priority: age !== null && age > 5 ? "high" : "normal",
        viewPath: `/finance/client-billing?tab=proformas&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: "Approve & issue",
      });
    });
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/client-billing/invoices/${encodeURIComponent(item.id)}`;
    if (action === "approve") await ctx.call("POST", `${base}/approve`, { body: {} });
    else await ctx.call("POST", `${base}/reject`, { body: { reason: remarks } });
  },
};

/**
 * Client credit note in draft. The module has an approve endpoint only (no reject), so Decline is refused
 * with a clear message; meta.approveOnly lets the popup hide Decline if the lead adds support.
 */
export const clientCreditNoteAdapter: ApprovalAdapter = {
  kind: "client_credit_note",
  label: "Client credit note",
  category: "Finance",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/client-billing/credit-notes", { query: { status: "draft", limit: 200 } });
    const rows = rowsOf(res).filter((r) => str(r.credit_status) === "draft" && Number(r.is_migrated ?? 0) !== 1);
    const picked = rows.slice(0, MAX_DETAIL);
    const details = await Promise.all(
      picked.map((r) => ctx.call("GET", `/api/client-billing/credit-notes/${encodeURIComponent(String(r.id))}`).then((d) => d?.data ?? d).catch(() => null)),
    );
    const out: ApprovalItem[] = [];
    picked.forEach((r, i) => {
      const lines: any[] = Array.isArray((details[i] as any)?.lines) ? (details[i] as any).lines : [];
      const age = ageDays(r.created_at);
      const client = str(r.cost_centre_display_name);
      out.push({
        uid: `client_credit_note:${r.id}`,
        kind: "client_credit_note",
        kindLabel: "Client credit note",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.credit_no) || "Credit note"} — ${money("", r.grand_total).value}`,
        subtitle: [client, str(r.against_invoice_number) ? `against ${str(r.against_invoice_number)}` : ""].filter(Boolean).join(" · "),
        stage: "Finance approval",
        fields: fields(
          f("Credit note number", r.credit_no),
          f("Against invoice", r.against_invoice_number),
          f("Client / cost centre", client),
          badge("Category", r.category),
          f("Billing month", r.month_label),
          f("Finance year", r.finance_year),
          date("Credit date", r.credit_date),
          f("GST type", r.apply_gst === 0 ? "No GST" : r.gst_type),
          money("Taxable value", r.total_amount),
          money("IGST", r.igst_amount),
          money("CGST", r.cgst_amount),
          money("SGST", r.sgst_amount),
          money("Grand total", r.grand_total),
          f("Line items", lines.length || ""),
          long("Line detail", lines.map(lineText).join("\n")),
          date("Raised on", r.created_at),
          f("Days pending", age),
          long("Description", r.description),
        ),
        submittedAt: iso(r.created_at),
        priority: age !== null && age > 5 ? "high" : "normal",
        viewPath: `/finance/client-billing?tab=credit-notes&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: false,
        approveLabel: "Approve credit note",
        meta: { approveOnly: true },
      });
    });
    return out;
  },
  async decide(ctx, item, action) {
    if (action === "reject") {
      throw new LoopbackError(400, "Credit notes can only be approved here — the billing module has no decline step. Open it with View.");
    }
    await ctx.call("POST", `/api/client-billing/credit-notes/${encodeURIComponent(item.id)}/approve`, { body: {} });
  },
};
