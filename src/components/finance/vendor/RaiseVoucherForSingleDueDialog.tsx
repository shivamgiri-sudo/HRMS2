// src/components/finance/vendor/RaiseVoucherForSingleDueDialog.tsx
//
// Raises a Payment Voucher for one already-chosen vendor due, from the Vendor Payment Dispatch
// page.
//
// This is deliberately NOT the multi-GRN raise form on /finance/payment-vouchers. There, the
// Finance Head starts from a vendor and picks which of its outstanding GRNs to cover. Here the
// due has already been clicked, so vendor and GRN are settled and re-presenting a picker would
// only be friction. What still has to be asked is the two ledger coordinates the voucher cannot
// infer: which bank account pays, and which payable ledger it books against.
//
// It posts to the same POST /api/finance/payment-vouchers endpoint the other page uses. There
// is exactly one voucher workflow and one payment_voucher table behind both entry points, which
// is what makes the two pages' statuses agree by construction rather than by synchronisation.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { money } from "@/lib/finance/paymentVoucherStatus";

/** Only the fields this dialog reads — the host page's row type is a superset. */
export interface RaisableDue {
  id: string;
  grn_number?: string | null;
  invoice_number?: string | null;
  vendor_name?: string | null;
  head?: string | null;
  sub_head?: string | null;
  due_amount: number;
  paid_amount: number;
  tds_deducted_amount?: number | null;
}

/**
 * What the voucher is actually for. Deliberately not balance_amount: that is due − paid and
 * ignores TDS already withheld, so on a due carrying TDS it overstates what leaves the bank.
 * This is the same figure payment-voucher.service.ts's raise() validates the allocation
 * against, so computing it any other way would just produce a server-side rejection.
 */
export function netPayableOf(due: RaisableDue) {
  const net = Number(due.due_amount ?? 0) - Number(due.tds_deducted_amount ?? 0) - Number(due.paid_amount ?? 0);
  return Math.round(net * 100) / 100;
}

interface Props {
  payment: RaisableDue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRaised?: () => void;
}

export function RaiseVoucherForSingleDueDialog({ payment, open, onOpenChange, onRaised }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [bankAccountId, setBankAccountId] = useState("");
  const [payableAccountId, setPayableAccountId] = useState("");
  const [remarks, setRemarks] = useState("");

  // A fresh due gets a fresh form — otherwise the previous due's bank account silently carries
  // over and someone raises a voucher against an account they never chose for this payment.
  useEffect(() => {
    if (open) { setBankAccountId(""); setPayableAccountId(""); setRemarks(""); }
  }, [open, payment?.id]);

  const bankAccountsQuery = useQuery({
    queryKey: ["payment-voucher-bank-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/bank-accounts")).data ?? [],
    enabled: open,
  });
  const payableAccountsQuery = useQuery({
    queryKey: ["payment-voucher-payable-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/payable-accounts")).data ?? [],
    enabled: open,
  });

  const netPayable = payment ? netPayableOf(payment) : 0;

  const raiseMutation = useMutation({
    mutationFn: async () => (await hrmsApi.post("/api/finance/payment-vouchers", {
      sourceType: "vendor_grn",
      bankAccountId,
      payableAccountId,
      grnAllocations: [{ vendorPaymentTrackingId: payment!.id, amount: netPayable }],
      amount: netPayable,
      remarks: remarks.trim() || undefined,
    })).data,
    onSuccess: () => {
      toast({ title: "Voucher raised", description: "Awaiting CEO approval." });
      queryClient.invalidateQueries({ queryKey: ["vendor-payments"] });
      queryClient.invalidateQueries({ queryKey: ["payment-vouchers"] });
      onOpenChange(false);
      onRaised?.();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSubmit = !!payment && !!bankAccountId && !!payableAccountId && netPayable > 0 && !raiseMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Raise Payment Voucher for CEO Approval</DialogTitle>
        </DialogHeader>

        {payment && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-y-1.5 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
              <dt className="text-slate-500">Vendor</dt>
              <dd className="font-semibold text-gray-800">{payment.vendor_name ?? "—"}</dd>
              <dt className="text-slate-500">GRN</dt>
              <dd className="text-gray-700">{payment.grn_number ?? "—"}</dd>
              <dt className="text-slate-500">Invoice</dt>
              <dd className="text-gray-700">{payment.invoice_number ?? "—"}</dd>
              {/* Budget classification carried on the GRN — not the payable ledger picked below. */}
              <dt className="text-slate-500">Head / Sub-head</dt>
              <dd className="text-gray-700">{payment.head ?? "—"} / {payment.sub_head ?? "—"}</dd>
              <dt className="text-slate-500">Net payable</dt>
              <dd className="font-semibold tabular-nums text-gray-900">{money(netPayable)}</dd>
            </dl>
            <p className="text-xs text-slate-500">
              The voucher covers this due in full, net of TDS already withheld. To pay several
              GRNs of this vendor on one voucher, raise it from the Payment Vouchers page instead.
            </p>

            <div>
              <Label>Bank Account</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Which account pays this" /></SelectTrigger>
                <SelectContent>
                  {(bankAccountsQuery.data ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name} — {a.account_number_masked}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Payable Account (bank ledger — Vendor Payables, TDS Payable, etc.)</Label>
              <Select value={payableAccountId} onValueChange={setPayableAccountId}>
                <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select ledger account" /></SelectTrigger>
                <SelectContent>
                  {(payableAccountsQuery.data ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Remarks (optional)</Label>
              <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="cursor-pointer" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="cursor-pointer bg-blue-600 hover:bg-blue-700"
            disabled={!canSubmit}
            onClick={() => raiseMutation.mutate()}
          >
            Raise for CEO Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
