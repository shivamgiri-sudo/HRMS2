// src/components/finance/client-billing/CreditNoteDetailDialog.tsx
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCreditNote } from "@/lib/clientBillingApi";
import { CreditStatusBadge, GstBreakdown, money } from "./shared";

interface Props {
  creditNoteId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function CreditNoteDetailDialog({ creditNoteId, onOpenChange }: Props) {
  const detailQuery = useQuery({
    queryKey: ["client-billing", "credit-note-detail", creditNoteId],
    queryFn: () => getCreditNote(creditNoteId as string),
    enabled: Boolean(creditNoteId),
  });
  const creditNote = detailQuery.data?.data;

  return (
    <Dialog open={Boolean(creditNoteId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {creditNote?.credit_no || "Credit note detail"}
            {creditNote && <CreditStatusBadge status={creditNote.credit_status} />}
          </DialogTitle>
        </DialogHeader>

        {detailQuery.isLoading || !creditNote ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Category</dt>
              <dd>{creditNote.category}</dd>
              <dt className="text-muted-foreground">Period</dt>
              <dd>{creditNote.month_label} · {creditNote.finance_year}</dd>
              <dt className="text-muted-foreground">Credit date</dt>
              <dd>{creditNote.credit_date}</dd>
              <dt className="text-muted-foreground">GST type</dt>
              <dd>{creditNote.gst_type}</dd>
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
                  {creditNote.lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                        No line items
                      </TableCell>
                    </TableRow>
                  ) : (
                    creditNote.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>{line.particulars}</TableCell>
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
              <GstBreakdown row={creditNote} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
