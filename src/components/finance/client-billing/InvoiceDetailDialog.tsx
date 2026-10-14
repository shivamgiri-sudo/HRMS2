// src/components/finance/client-billing/InvoiceDetailDialog.tsx
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, Download, Eye, Loader2, Pencil, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  downloadInvoicePdf, getAuditLog, getProforma, listInvoiceChangeRequests, listSubmissions,
  type InvoiceDetail,
} from "@/lib/clientBillingApi";
import { ApprovalTimeline, AuditSection, ChangeRequestsSection, SubmissionsSection } from "./InvoiceDetailSections";
import {
  DRAWER_60VW_CLASS, GstBreakdown, InvoiceStatusBadge, SECTION_LABEL_CLASS,
  formatDateOnly, formatDateTime, money, whoBy,
} from "./shared";

/** Entry points the drawer offers; each is optional so a caller can hide what it cannot handle. */
export interface InvoiceDetailActions {
  onPreview?: (invoice: InvoiceDetail) => void;
  /** mode "proforma" = step 1 (View & Approve Proforma), "invoice" = step 2 (bill number). */
  onApprove?: (invoice: InvoiceDetail, mode: "proforma" | "invoice") => void;
  onReject?: (invoice: InvoiceDetail) => void;
  onEditNarration?: (invoice: InvoiceDetail) => void;
  onSendToClient?: (invoice: InvoiceDetail) => void;
  onClone?: (invoice: InvoiceDetail) => void;
}

interface Props extends InvoiceDetailActions {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

const btn = "h-7 cursor-pointer text-xs";

/**
 * Row drill-down (CLAUDE.md Drill-Down Mandate): a right-side slide-over drawer at 60vw that
 * fetches the full record from `GET /proformas/:id` — header, approval history, PO/GRN/JCC,
 * lines, tax, the "Submit to Client" log, change requests and the audit trail — plus the
 * actions that apply to the record's stage. Opened from every bill / proforma number link.
 */
export function InvoiceDetailDialog({ invoiceId, onOpenChange, ...actions }: Props) {
  const enabled = Boolean(invoiceId);
  const detailQuery = useQuery({ queryKey: ["client-billing", "proforma-detail", invoiceId], queryFn: () => getProforma(invoiceId as string), enabled });
  const submissionsQuery = useQuery({ queryKey: ["client-billing", "submissions", invoiceId], queryFn: () => listSubmissions(invoiceId as string), enabled });
  const requestsQuery = useQuery({ queryKey: ["client-billing", "invoice-change-requests", invoiceId], queryFn: () => listInvoiceChangeRequests(invoiceId as string), enabled });
  const auditQuery = useQuery({ queryKey: ["client-billing", "audit-log", invoiceId], queryFn: () => getAuditLog(invoiceId as string), enabled });

  const invoice = detailQuery.data?.data;
  const audit = auditQuery.data?.data ?? [];
  const number = invoice?.bill_no || invoice?.proforma_no || "";
  const live = Boolean(invoice && !Number(invoice.is_migrated));
  const isProforma = invoice?.invoice_status === "proforma";

  return (
    <Sheet open={enabled} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={DRAWER_60VW_CLASS}>
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2 pr-6 text-sm">
            {number || "Invoice detail"}
            {invoice && <InvoiceStatusBadge status={invoice.invoice_status} />}
          </SheetTitle>
          {invoice && (
            <p className="text-xs text-muted-foreground">
              Created {formatDateTime(invoice.created_at)}
              {invoice.last_sent_at ? ` · last sent to client ${formatDateTime(invoice.last_sent_at)}` : ""}
            </p>
          )}
          {invoice && (
            <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Invoice actions">
              {actions.onPreview && (
                <Button size="sm" variant="outline" className={btn} onClick={() => actions.onPreview!(invoice)}>
                  <Eye className="mr-1 h-3.5 w-3.5" />Preview PDF
                </Button>
              )}
              <Button
                size="sm" variant="outline" className={btn}
                onClick={() => void downloadInvoicePdf(isProforma ? "proforma" : "invoice", invoice.id, `${number || invoice.id}.pdf`, true)}
              >
                <Download className="mr-1 h-3.5 w-3.5" />PDF
              </Button>
              {live && isProforma && actions.onApprove && (
                <Button size="sm" className={btn} onClick={() => actions.onApprove!(invoice, invoice.proforma_approved_at ? "invoice" : "proforma")}>
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />{invoice.proforma_approved_at ? "Approve invoice" : "Approve proforma"}
                </Button>
              )}
              {live && isProforma && actions.onReject && (
                <Button size="sm" variant="outline" className={`${btn} text-rose-700`} onClick={() => actions.onReject!(invoice)}>
                  <XCircle className="mr-1 h-3.5 w-3.5" />Reject
                </Button>
              )}
              {live && invoice.invoice_status !== "rejected" && actions.onEditNarration && (
                <Button size="sm" variant="outline" className={btn} onClick={() => actions.onEditNarration!(invoice)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />Edit narration
                </Button>
              )}
              {invoice.invoice_status === "approved" && actions.onSendToClient && (
                <Button size="sm" variant="outline" className={btn} onClick={() => actions.onSendToClient!(invoice)}>
                  <Send className="mr-1 h-3.5 w-3.5" />Submit to client
                </Button>
              )}
              {invoice.invoice_status === "rejected" && actions.onClone && (
                <Button size="sm" variant="outline" className={btn} onClick={() => actions.onClone!(invoice)}>
                  <Copy className="mr-1 h-3.5 w-3.5" />Clone as new proforma
                </Button>
              )}
            </div>
          )}
        </SheetHeader>

        {detailQuery.isError ? (
          <div role="alert" className="m-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            Could not load this invoice: {(detailQuery.error as Error).message}{" "}
            <button type="button" className="cursor-pointer underline" onClick={() => void detailQuery.refetch()}>Retry</button>
          </div>
        ) : detailQuery.isLoading || !invoice ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-5 px-4 py-4">
            {invoice.invoice_status === "rejected" && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
                <p className="font-semibold">{invoice.bill_no ? "Voided" : "Rejected"} {formatDateTime(invoice.rejected_at)} by {whoBy(invoice.rejected_by_name, invoice.rejected_by)}</p>
                <p>{invoice.rejected_reason || "No reason recorded."}</p>
              </div>
            )}

            <ApprovalTimeline invoice={invoice} audit={audit} />

            <section>
              <p className={SECTION_LABEL_CLASS}>Invoice</p>
              <dl className="mt-1">
                <Row label="Proforma no.">{invoice.proforma_no ?? "—"}</Row>
                <Row label="Bill no.">{invoice.bill_no ?? "—"}</Row>
                <Row label="Category">{invoice.category}</Row>
                <Row label="Period">{invoice.month_label} · {invoice.finance_year}</Row>
                <Row label="Invoice date">{formatDateOnly(invoice.invoice_date)}</Row>
                <Row label="GST type">{invoice.gst_type}</Row>
                <Row label="Description">{invoice.description ?? "—"}</Row>
                {(invoice.tally_head || invoice.client_tally_name) && (
                  <Row label="Tally reference">
                    {invoice.tally_head ?? "—"}
                    {invoice.client_tally_name && invoice.client_tally_name !== invoice.tally_head && (
                      <span className="text-muted-foreground"> ({invoice.client_tally_name})</span>
                    )}
                  </Row>
                )}
                {invoice.is_migrated === 1 && (
                  <Row label="Source">Historical record{invoice.legacy_id ? ` (legacy id ${invoice.legacy_id})` : ""}</Row>
                )}
              </dl>
            </section>

            <section>
              <p className={SECTION_LABEL_CLASS}>PO · GRN · JCC</p>
              <dl className="mt-1">
                <Row label="PO numbers">{invoice.po_numbers || "—"}{invoice.po_numbers && invoice.po_approved ? " (approved)" : ""}</Row>
                <Row label="GRN">{invoice.grn_no ? `${invoice.grn_no} (${formatDateOnly(invoice.grn_date)})` : "—"}</Row>
                <Row label="JCC">{invoice.jcc_no ? `${invoice.jcc_no} (${formatDateOnly(invoice.jcc_date)})` : "—"}</Row>
                <Row label="Tax payable under RCM">{invoice.rcm_applicable ? "Yes" : "No"}</Row>
              </dl>
            </section>

            <section>
              <p className={SECTION_LABEL_CLASS}>Line items</p>
              <div className="mt-1 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Particulars</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.lines.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">None</TableCell></TableRow>
                    ) : invoice.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          {line.particulars}
                          {line.line_type === "deduction" && <span className="ml-1 text-xs text-rose-600">(deduction)</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(line.rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(line.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-2 rounded-md border p-3"><GstBreakdown row={invoice} /></div>
            </section>

            <SubmissionsSection rows={submissionsQuery.data?.data ?? []} error={submissionsQuery.error} onRetry={() => void submissionsQuery.refetch()} />
            <ChangeRequestsSection rows={requestsQuery.data?.data ?? []} error={requestsQuery.error} onRetry={() => void requestsQuery.refetch()} />
            <AuditSection rows={audit} error={auditQuery.error} onRetry={() => void auditQuery.refetch()} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
