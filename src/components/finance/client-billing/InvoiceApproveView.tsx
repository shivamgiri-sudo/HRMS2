// src/components/finance/client-billing/InvoiceApproveView.tsx
/**
 * Legacy "Approve Proforma Invoice" page (used by both View & Approve Proforma and Invoice
 * Approval in I-Spark): Branch / Cost Center / Financial Year / Month for strip, Bill To |
 * Ship To | Details (Bill Date, Proforma No., JCC No., PO No., GRN), Bill Details (S.No,
 * Service, Particulars, Rate, Qty, Amount), Total / tax / Grand Total, then Approved / Back.
 *   mode "proforma": Approved = step 1 (no bill number).
 *   mode "invoice":  Approved = step 2, generates the bill number.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { approveInvoice, approveProforma, getBillingHeader, getProforma } from "@/lib/clientBillingApi";
import { money } from "./shared";

const ROW_TONES = ["bg-sky-500/80", "bg-emerald-500/70", "bg-cyan-500/60"];

export function InvoiceApproveView({ invoiceId, mode, onClose, onApproved }: {
  invoiceId: string | null;
  mode: "proforma" | "invoice" | "view";
  onClose: () => void;
  /** Invoice mode: called with the generated bill number and the row, for the legacy banner. */
  onApproved?: (result: { billNo?: string; branch?: string | null; amount: number; month: string }) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["client-billing", "approve-view", invoiceId], queryFn: () => getProforma(invoiceId as string), enabled: Boolean(invoiceId) });
  const inv = detail.data?.data;
  const header = useQuery({ queryKey: ["client-billing", "billing-header", inv?.cost_centre_id], queryFn: () => getBillingHeader(inv!.cost_centre_id), enabled: Boolean(inv?.cost_centre_id) });
  const h = header.data?.data;

  const approve = useMutation({
    mutationFn: async (): Promise<{ billNo?: string }> => {
      if (mode === "invoice") return { billNo: (await approveInvoice(invoiceId!)).data.billNo };
      await approveProforma(invoiceId!);
      return {};
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      const billNo = res.billNo;
      if (mode === "invoice") {
        onApproved?.({ billNo, branch: h?.branch_name, amount: Number(inv?.total_amount ?? 0), month: inv?.month_label ?? "" });
      } else {
        toast({ title: "Proforma approved", description: "Moved to Invoice Approval." });
      }
      onClose();
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const lines = inv?.lines ?? [];
  const charges = lines.filter((l) => l.line_type !== "deduction");
  const deductions = lines.filter((l) => l.line_type === "deduction");
  const billTo = [h?.bill_to_address1, h?.bill_to_address2, h?.bill_to_address3, h?.bill_to_address4, h?.bill_to_address5];
  const shipTo = (h?.ship_to_address1 ? [h?.ship_to_address1, h?.ship_to_address2, h?.ship_to_address3, h?.ship_to_address4, h?.ship_to_address5] : [h?.bill_to_address1, h?.bill_to_address2, h?.bill_to_address3, h?.bill_to_address4, h?.bill_to_address5]);
  const party = (title: string, a: Array<string | null | undefined>) => (
    <section className="rounded-md border text-sm" aria-label={title}>
      <h3 className="border-b bg-slate-50 px-2 py-1 text-xs text-slate-600">{title}</h3>
      <p className="border-b px-2 py-1 font-semibold">{h?.client_name ?? "—"}</p>
      {[0, 1, 2, 3, 4].map((i) => <p key={i} className="min-h-[26px] border-b px-2 py-1 font-medium last:border-b-0">{a[i] ?? ""}</p>)}
    </section>
  );
  const kv: Array<[string, string]> = [
    ["Bill Date", inv ? String(inv.invoice_date).slice(0, 10) : ""],
    [inv?.bill_no ? "Bill No." : "Proforma No.", inv?.bill_no ?? inv?.proforma_no ?? ""],
    ["JCC No.", inv?.jcc_no ?? ""], ["PO No.", inv?.po_numbers ?? ""], ["GRN", inv?.grn_no ?? ""],
  ];
  const taxRows: Array<[string, unknown]> = [
    ["Total:", inv?.total_amount],
    ...(Number(inv?.igst_amount) > 0 ? [["IGST @ 18.00%", inv?.igst_amount] as [string, unknown]] : []),
    ...(Number(inv?.cgst_amount) > 0 ? [["CGST @ 9.00%", inv?.cgst_amount] as [string, unknown], ["SGST @ 9.00%", inv?.sgst_amount] as [string, unknown]] : []),
    ["Grand Total:", inv?.grand_total],
  ];

  return (
    <Dialog open={Boolean(invoiceId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-[min(96vw,1400px)] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-base font-medium">{mode === "view" ? "Invoice" : "Approve Proforma Invoice"}</DialogTitle></DialogHeader>
        {detail.isLoading || !inv ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-center text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="p-2">Branch</th><th className="p-2">Cost Center</th><th className="p-2">Financial Year</th><th className="p-2">Month for</th></tr></thead>
                <tbody><tr className="font-medium text-white">
                  <td className="bg-sky-500/80 p-2">{h?.branch_name ?? "—"}</td><td className="bg-rose-500/80 p-2">{h?.cost_centre_code ?? "—"}</td>
                  <td className="bg-sky-500/80 p-2">{inv.finance_year}</td><td className="bg-rose-500/80 p-2">{inv.month_label}</td>
                </tr></tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {party("Bill To", billTo)}
              {party("Ship To", shipTo)}
              <section className="rounded-md border text-sm" aria-label="Details">
                <h3 className="border-b bg-slate-50 px-2 py-1 text-xs text-slate-600">Details</h3>
                {kv.map(([k, v]) => <div key={k} className="grid grid-cols-2 border-b last:border-b-0"><span className="px-2 py-1 font-semibold">{k}</span><span className="px-2 py-1">{v}</span></div>)}
              </section>
            </div>
            <section className="overflow-x-auto rounded-md border" aria-label="Bill Details">
              <h3 className="border-b bg-slate-50 px-2 py-1 text-xs text-slate-600">Bill Details</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs"><tr><th className="px-2 py-1">S.No.</th><th className="px-2 py-1">Service</th><th className="px-2 py-1">Particulars</th><th className="px-2 py-1">Rate</th><th className="px-2 py-1">Qty.</th><th className="px-2 py-1">Amount</th></tr></thead>
                <tbody>
                  {charges.map((l, i) => (
                    <tr key={l.id} className={`${ROW_TONES[i % 3]} text-white`}>
                      <td className="px-2 py-1">{i + 1}</td><td className="px-2 py-1" /><td className="px-2 py-1">{l.particulars}</td>
                      <td className="px-2 py-1 tabular-nums">{Number(l.rate)}</td><td className="px-2 py-1 tabular-nums">{Number(l.qty)}</td><td className="px-2 py-1 tabular-nums">{Number(l.amount)}</td>
                    </tr>
                  ))}
                  {deductions.map((l, i) => (
                    <tr key={l.id} className="bg-rose-100 text-rose-900">
                      <td className="px-2 py-1">{charges.length + i + 1}</td><td className="px-2 py-1">Deduction</td><td className="px-2 py-1">{l.particulars}</td>
                      <td className="px-2 py-1 tabular-nums">{Number(l.rate)}</td><td className="px-2 py-1 tabular-nums">{Number(l.qty)}</td><td className="px-2 py-1 tabular-nums">-{Number(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="rounded-md border text-sm" aria-label="Totals">
              {taxRows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[2fr_1fr] border-b last:border-b-0">
                  <span className="px-2 py-1 font-semibold">{k}</span><span className={`px-2 py-1 tabular-nums ${k === "Grand Total:" ? "font-semibold" : ""}`}>{money(Number(v))}</span>
                </div>
              ))}
            </section>
            <div className="flex justify-center gap-3 pb-2">
              {mode !== "view" && (
                <Button disabled={approve.isPending} onClick={() => approve.mutate()} className="bg-sky-600 px-6 hover:bg-sky-700">
                  {approve.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Approved
                </Button>
              )}
              <Button variant="outline" onClick={onClose} className="px-6">Back</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
