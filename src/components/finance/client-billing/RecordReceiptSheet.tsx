// src/components/finance/client-billing/RecordReceiptSheet.tsx
/**
 * Record money received from one client against their bills. The finance user enters what
 * reached the bank and the TDS the client withheld; the sheet spreads both over the client's
 * bills oldest-first (editable per bill). The server re-checks everything under row locks
 * (client-billing-receipt.service.ts); amounts here are integer-paise maths for display only.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  createReceipt, listCompanyBankAccounts, listOutstandingBills, RECEIPT_PAYMENT_MODES, type OutstandingBill,
} from "@/lib/clientBillingApi";
import { todayLocalISO } from "./billingFieldOptions";
import { money } from "./shared";

const paise = (v: unknown) => Math.round(Number(v || 0) * 100);
const rupees = (p: number) => p / 100;
interface Alloc { received: string; tds: string; deduction: string }

/** Oldest bill first: each bill takes as much of the remaining received + TDS as it can hold. */
export function autoAllocate(bills: OutstandingBill[], receivedP: number, tdsP: number): Record<string, Alloc> {
  const out: Record<string, Alloc> = {};
  let r = receivedP, t = tdsP;
  for (const b of [...bills].sort((a, c) => String(a.invoice_date).localeCompare(String(c.invoice_date)) || String(a.bill_no).localeCompare(String(c.bill_no)))) {
    let room = paise(b.outstanding);
    const tdsTake = Math.min(t, room); room -= tdsTake; t -= tdsTake;
    const recTake = Math.min(r, room); r -= recTake;
    if (tdsTake || recTake) out[b.id] = { received: recTake ? String(rupees(recTake)) : "", tds: tdsTake ? String(rupees(tdsTake)) : "", deduction: "" };
  }
  return out;
}

export function RecordReceiptSheet({ open, onOpenChange, initialClient, initialBillId }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialClient?: string;
  /** "Receive" on an outstanding bill: that bill is preselected with its full outstanding amount. */
  initialBillId?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [client, setClient] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [bankId, setBankId] = useState("");
  const [mode, setMode] = useState("NEFT");
  const [ref, setRef] = useState("");
  const [remarks, setRemarks] = useState("");
  const [amount, setAmount] = useState("");
  const [tds, setTds] = useState("");
  const [alloc, setAlloc] = useState<Record<string, Alloc>>({});

  useEffect(() => {
    if (open) { setClient(initialClient ?? ""); return; }
    setClient(""); setDate(todayLocalISO()); setBankId(""); setMode("NEFT"); setRef(""); setRemarks(""); setAmount(""); setTds(""); setAlloc({});
  }, [open, initialClient]);

  const all = useQuery({ queryKey: ["client-billing", "outstanding", "all"], queryFn: () => listOutstandingBills(), enabled: open });
  const banks = useQuery({ queryKey: ["client-billing", "bank-accounts"], queryFn: () => listCompanyBankAccounts(), enabled: open });
  const clients = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of all.data?.data ?? []) m.set(b.client_name, (m.get(b.client_name) ?? 0) + paise(b.outstanding));
    return [...m.entries()].map(([name, p]) => ({ value: name, label: name, hint: money(rupees(p)) }));
  }, [all.data]);
  const bills = useMemo(() => (all.data?.data ?? []).filter((b) => b.client_name === client), [all.data, client]);
  const [preselected, setPreselected] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !initialBillId || preselected === initialBillId) return;
    const bill = (all.data?.data ?? []).find((b) => b.id === initialBillId);
    if (!bill) return;
    const due = rupees(paise(bill.outstanding)).toFixed(2);
    setClient(bill.client_name);
    setAmount(due);
    setAlloc({ [bill.id]: { received: due, tds: "", deduction: "" } });
    setPreselected(initialBillId);
  }, [open, initialBillId, all.data, preselected]);
  useEffect(() => { if (!open) setPreselected(null); }, [open]);

  const sum = (k: keyof Alloc) => Object.values(alloc).reduce((s, a) => s + paise(a[k]), 0);
  const allocatedReceived = sum("received");
  const allocatedTds = sum("tds");
  const enteredReceived = paise(amount);
  const enteredTds = paise(tds);
  const overBills = bills.filter((b) => {
    const a = alloc[b.id];
    return a && paise(a.received) + paise(a.tds) + paise(a.deduction) > paise(b.outstanding);
  });
  const lines = Object.entries(alloc).filter(([, a]) => paise(a.received) + paise(a.tds) + paise(a.deduction) > 0);
  const balanced = enteredReceived > 0 && allocatedReceived === enteredReceived && allocatedTds === enteredTds;
  const canSave = Boolean(client && bankId && date && balanced && overBills.length === 0 && lines.length > 0);

  const save = useMutation({
    mutationFn: () => createReceipt({
      receiptDate: date, bankAccountId: bankId, paymentMode: mode, referenceNo: ref.trim() || undefined, remarks: remarks.trim() || undefined,
      amountReceived: rupees(enteredReceived),
      allocations: lines.map(([invoiceId, a]) => ({ invoiceId, received: rupees(paise(a.received)), tds: rupees(paise(a.tds)), deduction: rupees(paise(a.deduction)) })),
    }),
    onSuccess: (res) => {
      toast({ title: `Receipt ${res.data.receipt_no} recorded`, description: "Bank voucher raised; it posts to the bank ledger once approved and released." });
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      onOpenChange(false);
    },
  });
  const setLine = (id: string, patch: Partial<Alloc>) => setAlloc((cur) => ({ ...cur, [id]: { received: "", tds: "", deduction: "", ...cur[id], ...patch } }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-none lg:w-[min(90vw,1250px)]">
        <SheetHeader className="border-b px-5 py-3"><SheetTitle className="text-sm font-semibold">Record receipt</SheetTitle></SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-3">
              <Label className="text-xs">Client *</Label>
              <SearchableSelect className="mt-1" options={clients} value={client} onChange={(v) => { setClient(v); setAlloc({}); }}
                loading={all.isLoading} placeholder="Client with outstanding bills" searchPlaceholder="Search client…" emptyText="No outstanding bills" aria-label="Client" />
            </div>
            <div><Label className="text-xs" htmlFor="rc-date">Receipt date *</Label><Input id="rc-date" type="date" max={todayLocalISO()} className="mt-1 h-9" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div>
              <Label className="text-xs">Credited to bank account *</Label>
              <Select value={bankId} onValueChange={setBankId}>
                <SelectTrigger className="mt-1 h-9" aria-label="Bank account"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>{(banks.data?.data ?? []).filter((b) => b.active_status !== 0).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.account_name}{b.account_number_last4 ? ` ·· ${b.account_number_last4}` : ""}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Mode *</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger className="mt-1 h-9" aria-label="Payment mode"><SelectValue /></SelectTrigger>
                  <SelectContent>{RECEIPT_PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs" htmlFor="rc-ref">UTR / Cheque no.</Label><Input id="rc-ref" className="mt-1 h-9" maxLength={100} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
            </div>
            <div><Label className="text-xs" htmlFor="rc-amt">Amount received in bank (₹) *</Label><Input id="rc-amt" inputMode="decimal" className="mt-1 h-9 tabular-nums" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label className="text-xs" htmlFor="rc-tds">TDS deducted by client (₹)</Label><Input id="rc-tds" inputMode="decimal" className="mt-1 h-9 tabular-nums" value={tds} onChange={(e) => setTds(e.target.value)} /></div>
            <div className="flex items-end">
              <Button type="button" variant="outline" className="h-9 w-full" disabled={!client || enteredReceived <= 0}
                onClick={() => setAlloc(autoAllocate(bills, enteredReceived, enteredTds))}>
                <Wand2 className="mr-1.5 h-4 w-4" />Allocate oldest first
              </Button>
            </div>
          </div>

          <section aria-label="Allocate to bills" className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2">Bill no.</th><th className="px-3 py-2">Bill date</th><th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">TDS</th><th className="px-3 py-2 text-right">Other deduction</th><th className="px-3 py-2 text-right">Left after</th>
                </tr>
              </thead>
              <tbody>
                {!client && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Pick a client to see their outstanding bills.</td></tr>}
                {client && bills.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No outstanding bills for this client.</td></tr>}
                {bills.map((b) => {
                  const a = alloc[b.id] ?? { received: "", tds: "", deduction: "" };
                  const left = paise(b.outstanding) - paise(a.received) - paise(a.tds) - paise(a.deduction);
                  return (
                    <tr key={b.id} className={`border-t ${b.id === initialBillId ? "bg-sky-50" : ""}`}>
                      <td className="px-3 py-1.5 font-medium">{b.bill_no}<span className="block text-[11px] text-muted-foreground">{b.cost_centre_code}</span></td>
                      <td className="px-3 py-1.5">{String(b.invoice_date).slice(0, 10)}</td>
                      <td className="px-3 py-1.5">
                        {String(b.due_date).slice(0, 10)}
                        {b.days_past_due > 0 && <span className="ml-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">{b.days_past_due}d overdue</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(b.outstanding)}</td>
                      {(["received", "tds", "deduction"] as const).map((k) => (
                        <td key={k} className="px-2 py-1">
                          <Input aria-label={`${k} for ${b.bill_no}`} inputMode="decimal" className="h-8 text-right tabular-nums" value={a[k]} onChange={(e) => setLine(b.id, { [k]: e.target.value })} />
                        </td>
                      ))}
                      <td className={`px-3 py-1.5 text-right tabular-nums ${left < 0 ? "font-semibold text-rose-700" : ""}`}>{money(rupees(left))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className={`flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border px-4 py-2.5 text-sm ${balanced && overBills.length === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`} role="status" aria-live="polite">
            {balanced && overBills.length === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <span>Received allocated <b className="tabular-nums">{money(rupees(allocatedReceived))}</b> of <b className="tabular-nums">{money(rupees(enteredReceived))}</b></span>
            <span>TDS allocated <b className="tabular-nums">{money(rupees(allocatedTds))}</b> of <b className="tabular-nums">{money(rupees(enteredTds))}</b></span>
            {overBills.length > 0 && <span className="font-semibold">More than outstanding on {overBills.map((b) => b.bill_no).join(", ")}</span>}
          </div>

          <div><Label className="text-xs" htmlFor="rc-remarks">Remarks</Label><Textarea id="rc-remarks" className="mt-1 min-h-[56px]" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>

          {save.isError && <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">Could not record the receipt: {(save.error as Error).message}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save receipt
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
