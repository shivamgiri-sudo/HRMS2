import { LoopbackError, type ApprovalAdapter, type ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { ageDays, rowsOf } from "./finance-shared.js";
import { branchAllowed, callerScope, io, type CallerScope } from "./scope-guard.js";
import { holdsLiteralRole } from "./_scope.js";

/**
 * The client-billing routes have no branch scoping at all and admit `admin` (branch-scoped by owner ruling) alongside the finance roles,
 * so rows are narrowed here: an invoice / credit note belongs to its cost centre's branch, which must be the caller's own unless the
 * caller is org-wide (finance, finance_head, accounts_head ...). The maker (created_by) never sees their own document as a task.
 */
async function decidableBillingRows(ctx: { userId: string }, me: CallerScope, rows: any[]): Promise<any[]> {
  const notMine = rows.filter((r) => !(r.created_by && String(r.created_by) === String(ctx.userId)));
  if (me.orgWide) return notMine;
  const branches = await io.costCentreBranches(notMine.map((r) => r.cost_centre_id));
  return notMine.filter((r) => branchAllowed(me, branches.get(String(r.cost_centre_id))));
}

/** Roles the client-billing decide routes name (admin is branch-scoped by the branch rule below). */
const BILLING_ROLES = ["admin", "finance", "finance_head", "accounts_head", "super_admin"];
const MAX_DETAIL = 30;
const lineText = (l: any) => {
  const sign = str(l.line_type) === "deduction" ? "(deduction) " : "";
  return `${sign}${str(l.particulars)} — ${Number(l.qty)} x ${money("", l.rate).value} = ${money("", l.amount).value}`;
};

/**
 * Client-billing proforma awaiting approval — two steps, same as legacy I-Spark:
 * "Approve Proforma" (proforma_approved_at IS NULL) then "Invoice Approval" (mints the bill number). Endpoint roles (admin/finance/finance_head/accounts_head, super_admin)
 * are enforced by the module itself (403 -> empty). Migrated historical rows are never listed: the approve
 * route refuses them. Approving sends no PO numbers, exactly like the page's own Approve button.
 */
export const clientInvoiceAdapter: ApprovalAdapter = {
  kind: "client_invoice",
  label: "Client invoice (proforma)",
  category: "Finance",
  async list(ctx) {
    if (!(await holdsLiteralRole(ctx.userId, ...BILLING_ROLES))) return [];
    const res = await ctx.call("GET", "/api/client-billing/proformas", { query: { status: "proforma", limit: 200 } });
    const rows = await decidableBillingRows(ctx, await callerScope(ctx), rowsOf(res).filter((r) => str(r.invoice_status) === "proforma" && Number(r.is_migrated ?? 0) !== 1));
    const picked = rows.slice(0, MAX_DETAIL);
    const details = await Promise.all(
      picked.map((r) => ctx.call("GET", `/api/client-billing/proformas/${encodeURIComponent(String(r.id))}`).then((d) => d?.data ?? d).catch(() => null)),
    );
    const out: ApprovalItem[] = [];
    picked.forEach((r, i) => {
      const lines: any[] = Array.isArray((details[i] as any)?.lines) ? (details[i] as any).lines : [];
      const age = ageDays(r.created_at);
      const client = str(r.cost_centre_display_name) || str(r.cost_centre_code);
      const invoiceStep = Boolean(r.proforma_approved_at);
      out.push({
        uid: `client_invoice:${r.id}`,
        kind: "client_invoice",
        kindLabel: "Client invoice (proforma)",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.proforma_no) || "Proforma"} — ${money("", r.grand_total).value}`,
        subtitle: [client, `${str(r.month_label)} ${str(r.finance_year)}`.trim()].filter(Boolean).join(" · "),
        stage: invoiceStep ? "Invoice approval (mints the bill number)" : "Proforma approval",
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
        viewPath: `/finance/client-billing?tab=${invoiceStep ? "invoice-approval" : "proformas"}&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: invoiceStep ? "Approve & generate bill" : "Approve proforma",
        meta: { stage: invoiceStep ? "invoice" : "proforma" },
      });
    });
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const id = encodeURIComponent(item.id);
    const base = `/api/client-billing/invoices/${id}`;
    if (action !== "approve") {
      await ctx.call("POST", `${base}/reject`, { body: { reason: remarks } });
      return;
    }
    // The card may be stale (approved as a proforma in another tab), so the row decides the step.
    let stage = str(item.meta?.stage);
    if (!stage) {
      const detail: any = await ctx.call("GET", `/api/client-billing/proformas/${id}`).then((d) => d?.data ?? d).catch(() => null);
      stage = detail?.proforma_approved_at ? "invoice" : "proforma";
    }
    if (stage === "invoice") await ctx.call("POST", `${base}/approve`, { body: {} });
    else await ctx.call("POST", `/api/client-billing/proformas/${id}/approve`, { body: {} });
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
    if (!(await holdsLiteralRole(ctx.userId, ...BILLING_ROLES))) return [];
    const res = await ctx.call("GET", "/api/client-billing/credit-notes", { query: { status: "draft", limit: 200 } });
    const rows = await decidableBillingRows(ctx, await callerScope(ctx), rowsOf(res).filter((r) => str(r.credit_status) === "draft" && Number(r.is_migrated ?? 0) !== 1));
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

/**
 * Client provision (legacy "Provision Approve"). Pending provisions only; the maker never sees
 * their own. An approved provision is what a proforma for that cost centre + month draws down.
 */
export const clientProvisionAdapter: ApprovalAdapter = {
  kind: "client_provision",
  label: "Client provision",
  category: "Finance",
  async list(ctx) {
    if (!(await holdsLiteralRole(ctx.userId, ...BILLING_ROLES))) return [];
    const res = await ctx.call("GET", "/api/client-billing/provisions", { query: { status: "pending", limit: 200 } });
    const rows = await decidableBillingRows(ctx, await callerScope(ctx), rowsOf(res).filter((r) => str(r.provision_status) === "pending"));
    return rows.slice(0, MAX_DETAIL).map((r): ApprovalItem => {
      const age = ageDays(r.created_at);
      const client = str(r.client_name) || str(r.cost_centre_code);
      return {
        uid: `client_provision:${r.id}`,
        kind: "client_provision",
        kindLabel: "Client provision",
        category: "Finance",
        id: String(r.id),
        title: `Provision ${str(r.cost_centre_code)} ${str(r.month_label)} — ${money("", r.provision_amount).value}`,
        subtitle: [client, str(r.branch_name)].filter(Boolean).join(" · "),
        stage: "Provision approval",
        fields: fields(
          f("Company", r.company_name),
          f("Branch", r.branch_name),
          f("Cost centre", r.cost_centre_code),
          f("Client", client),
          f("Finance year", r.finance_year),
          f("Month", r.month_label),
          money("Provision amount", r.provision_amount),
          date("Raised on", r.created_at),
          f("Days pending", age),
          long("Remarks", r.remarks),
        ),
        submittedAt: iso(r.created_at),
        priority: age !== null && age > 3 ? "high" : "normal",
        viewPath: `/finance/client-billing?tab=provisions&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: "Approve provision",
      };
    });
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/client-billing/provisions/${encodeURIComponent(item.id)}`;
    if (action === "approve") await ctx.call("POST", `${base}/approve`, { body: {} });
    else await ctx.call("POST", `${base}/reject`, { body: { reason: remarks } });
  },
};
