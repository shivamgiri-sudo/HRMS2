// src/components/finance/client-billing/InvoiceDetailDialog.tsx
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getProforma } from "@/lib/clientBillingApi";
import { GstBreakdown, InvoiceStatusBadge, money } from "./shared";

interface Props {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
}

/** Read-only line-item + tax-summary view for a proforma/invoice — `GET /proformas/:id` and
 *  `GET /invoices/:id` resolve to the same route (both attach `lines`), so one fetch works for
 *  both tabs. */
export function InvoiceDetailDialog({ invoiceId, onOpenChange }: Props) {
  const detailQuery = useQuery({
    queryKey: ["client-billing", "proforma-detail", invoiceId],
    queryFn: () => getProforma(invoiceId as string),
    enabled: Boolean(invoiceId),
  });
  const invoice = detailQuery.data?.data;

  return (
    <Dialog open={Boolean(invoiceId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {invoice?.bill_no || invoice?.proforma_no || "Invoice detail"}
            {invoice && <InvoiceStatusBadge status={invoice.invoice_status} />}
          </DialogTitle>
        </DialogHeader>

        {detailQuery.isLoading || !invoice ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Category</dt>
              <dd>{invoice.category}</dd>
              <dt className="text-muted-foreground">Period</dt>
              <dd>{invoice.month_label} · {invoice.finance_year}</dd>
              <dt className="text-muted-foreground">Invoice date</dt>
              <dd>{invoice.invoice_date}</dd>
              <dt className="text-muted-foreground">GST type</dt>
              <dd>{invoice.gst_type}</dd>
              {(invoice.tally_head || invoice.client_tally_name) && (
                <>
                  <dt className="text-muted-foreground">Tally reference</dt>
                  <dd>
                    {invoice.tally_head ?? "—"}
                    {invoice.client_tally_name && invoice.client_tally_name !== invoice.tally_head && (
                      <span className="text-muted-foreground"> ({invoice.client_tally_name})</span>
                    )}
                  </dd>
                </>
              )}
              {invoice.is_migrated === 1 && (
                <>
                  <dt className="text-muted-foreground">Source</dt>
                  <dd className="text-muted-foreground">
                    Historical record{invoice.legacy_id ? ` (legacy id ${invoice.legacy_id})` : ""}
                  </dd>
                </>
              )}
              {invoice.rejected_reason && (
                <>
                  <dt className="text-muted-foreground">Rejected reason</dt>
                  <dd className="text-rose-700">{invoice.rejected_reason}</dd>
                </>
              )}
            </dl>

            <div className="max-h-[40vh] overflow-y-auto rounded-md border">
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
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        No line items
                      </TableCell>
                    </TableRow>
                  ) : (
                    invoice.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          {line.particulars}
                          {line.line_type === "deduction" && (
                            <span className="ml-1 text-xs text-rose-600">(deduction)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(line.rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(line.amount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-md border p-3">
              <GstBreakdown row={invoice} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
