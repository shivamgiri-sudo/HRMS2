// src/components/finance/client-billing/InvoiceDetailDialog.tsx
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  downloadInvoicePdf,
  getAuditLog,
  getProforma,
  listInvoiceChangeRequests,
  listSubmissions,
} from "@/lib/clientBillingApi";
import {
  DRAWER_60VW_CLASS,
  GstBreakdown,
  InvoiceStatusBadge,
  SECTION_LABEL_CLASS,
  formatDateOnly,
  formatDateTime,
  money,
} from "./shared";

interface Props {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

const None = () => <p className="mt-1 text-xs text-muted-foreground">None</p>;

/**
 * Row drill-down (CLAUDE.md Drill-Down Mandate): a right-side slide-over drawer at 60vw that
 * fetches the full record from `GET /proformas/:id` — header, PO/GRN/JCC, lines, tax, the
 * "Submit to Client" log, change requests and the audit trail. Kept under its original file
 * and component name so existing imports keep working; it used to be a centred dialog.
 */
export function InvoiceDetailDialog({ invoiceId, onOpenChange }: Props) {
  const enabled = Boolean(invoiceId);
  const detailQuery = useQuery({
    queryKey: ["client-billing", "proforma-detail", invoiceId],
    queryFn: () => getProforma(invoiceId as string),
    enabled,
  });
  const submissionsQuery = useQuery({
    queryKey: ["client-billing", "submissions", invoiceId],
    queryFn: () => listSubmissions(invoiceId as string),
    enabled,
  });
  const requestsQuery = useQuery({
    queryKey: ["client-billing", "invoice-change-requests", invoiceId],
    queryFn: () => listInvoiceChangeRequests(invoiceId as string),
    enabled,
  });
  const auditQuery = useQuery({
    queryKey: ["client-billing", "audit-log", invoiceId],
    queryFn: () => getAuditLog(invoiceId as string),
    enabled,
  });

  const invoice = detailQuery.data?.data;
  const submissions = submissionsQuery.data?.data ?? [];
  const requests = requestsQuery.data?.data ?? [];
  const audit = auditQuery.data?.data ?? [];
  const number = invoice?.bill_no || invoice?.proforma_no || "";

  return (
    <Sheet open={enabled} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={DRAWER_60VW_CLASS}>
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2 pr-6 text-sm">
            {number || "Invoice detail"}
            {invoice && <InvoiceStatusBadge status={invoice.invoice_status} />}
            {invoice && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 text-xs"
                onClick={() =>
                  void downloadInvoicePdf(
                    invoice.invoice_status === "proforma"
                      ? "proforma"
                      : "invoice",
                    invoice.id,
                    `${number || invoice.id}.pdf`,
                    true,
                  )
                }
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                PDF
              </Button>
            )}
          </SheetTitle>
          {invoice && (
            <p className="text-xs text-muted-foreground">
              Created {formatDateTime(invoice.created_at)}
              {invoice.last_sent_at
                ? ` · last sent to client ${formatDateTime(invoice.last_sent_at)}`
                : ""}
            </p>
          )}
        </SheetHeader>

        {detailQuery.isLoading || !invoice ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-5 px-4 py-4">
            <section>
              <p className={SECTION_LABEL_CLASS}>Invoice</p>
              <dl className="mt-1">
                <Row label="Proforma no.">{invoice.proforma_no ?? "—"}</Row>
                <Row label="Bill no.">{invoice.bill_no ?? "—"}</Row>
                <Row label="Category">{invoice.category}</Row>
                <Row label="Period">
                  {invoice.month_label} · {invoice.finance_year}
                </Row>
                <Row label="Invoice date">
                  {formatDateOnly(invoice.invoice_date)}
                </Row>
                <Row label="GST type">{invoice.gst_type}</Row>
                <Row label="Description">{invoice.description ?? "—"}</Row>
                {(invoice.tally_head || invoice.client_tally_name) && (
                  <Row label="Tally reference">
                    {invoice.tally_head ?? "—"}
                    {invoice.client_tally_name &&
                      invoice.client_tally_name !== invoice.tally_head && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({invoice.client_tally_name})
                        </span>
                      )}
                  </Row>
                )}
                {invoice.is_migrated === 1 && (
                  <Row label="Source">
                    Historical record
                    {invoice.legacy_id
                      ? ` (legacy id ${invoice.legacy_id})`
                      : ""}
                  </Row>
                )}
                {invoice.rejected_reason && (
                  <Row label="Rejected / void reason">
                    <span className="text-rose-700">
                      {invoice.rejected_reason}
                    </span>
                  </Row>
                )}
              </dl>
            </section>

            <section>
              <p className={SECTION_LABEL_CLASS}>PO · GRN · JCC</p>
              <dl className="mt-1">
                <Row label="PO numbers">{invoice.po_numbers || "—"}</Row>
                <Row label="GRN">
                  {invoice.grn_no
                    ? `${invoice.grn_no} (${formatDateOnly(invoice.grn_date)})`
                    : "—"}
                </Row>
                <Row label="JCC">
                  {invoice.jcc_no
                    ? `${invoice.jcc_no} (${formatDateOnly(invoice.jcc_date)})`
                    : "—"}
                </Row>
                <Row label="Tax payable under RCM">
                  {invoice.rcm_applicable ? "Yes" : "No"}
                </Row>
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
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-6 text-center text-muted-foreground"
                        >
                          None
                        </TableCell>
                      </TableRow>
                    ) : (
                      invoice.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>
                            {line.particulars}
                            {line.line_type === "deduction" && (
                              <span className="ml-1 text-xs text-rose-600">
                                (deduction)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {line.qty}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(line.rate)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(line.amount)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-2 rounded-md border p-3">
                <GstBreakdown row={invoice} />
              </div>
            </section>

            <section>
              <p className={SECTION_LABEL_CLASS}>Submitted to client</p>
              {submissions.length === 0 ? (
                <None />
              ) : (
                <ul className="mt-1 space-y-1">
                  {submissions.map((s) => (
                    <li key={s.id} className="rounded border px-2 py-1 text-xs">
                      <span
                        className={
                          s.send_status === "sent"
                            ? "font-medium text-emerald-700"
                            : "font-medium text-rose-700"
                        }
                      >
                        {s.send_status === "sent" ? "Sent" : "Failed"}
                      </span>{" "}
                      {formatDateTime(s.sent_at)} by {s.sent_by} to{" "}
                      {s.to_emails}
                      {s.error_message && (
                        <span className="text-rose-700">
                          {" "}
                          — {s.error_message}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <p className={SECTION_LABEL_CLASS}>Change requests</p>
              {requests.length === 0 ? (
                <None />
              ) : (
                <ul className="mt-1 space-y-1">
                  {requests.map((r) => (
                    <li key={r.id} className="rounded border px-2 py-1 text-xs">
                      <span className="font-medium">
                        {r.request_type === "void"
                          ? "Void"
                          : `Type → ${r.requested_value}`}
                      </span>{" "}
                      ({r.request_status}) · {formatDateTime(r.requested_at)} ·{" "}
                      {r.reason}
                      {r.decision_note && (
                        <span className="text-muted-foreground">
                          {" "}
                          · decision: {r.decision_note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <p className={SECTION_LABEL_CLASS}>Audit trail</p>
              {audit.length === 0 ? (
                <None />
              ) : (
                <ul className="mt-1 space-y-1">
                  {audit.map((a) => (
                    <li key={a.id} className="rounded border px-2 py-1 text-xs">
                      <span className="font-medium">{a.action}</span> ·{" "}
                      {formatDateTime(a.created_at)} · {a.actor_id}
                      {a.reason && (
                        <p className="mt-0.5 text-muted-foreground">
                          {a.reason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
