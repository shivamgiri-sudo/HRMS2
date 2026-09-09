// src/pages/finance/BankLedgerReportPage.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

type LedgerRow = {
  entry_date: string;
  voucher_number: string | null;
  type: string;
  ledger_head: string | null;
  party: string | null;
  debit: number;
  credit: number;
  running_balance: number;
  instrument_ref: string | null;
  narration: string;
  raised_by: string | null;
  ceo_approved_by: string | null;
  released_by: string | null;
};

function money(value: unknown) {
  const n = Number(value ?? 0);
  if (n === 0) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
}

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

/** Authenticated CSV download — the repo-wide idiom (GstTallyExportPanel, VendorPaymentDispatchPage)
 *  since a plain <a href> cannot carry the JWT auth header. */
async function downloadCsv(path: string, filename: string, toast: (opts: any) => void) {
  try {
    const blob = await hrmsApi.getBlob(path);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast({ title: "Export failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
  }
}

export default function BankLedgerReportPage() {
  const { toast } = useToast();
  const [bankAccountId, setBankAccountId] = useState("");
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const accountsQuery = useQuery({
    queryKey: ["bank-ledger-accounts"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: any[] }>("/api/finance/bank-accounts")).data ?? [],
  });

  const reportQuery = useQuery({
    queryKey: ["bank-ledger-report", bankAccountId, from, to],
    queryFn: async () => {
      const qs = new URLSearchParams({ from, to }).toString();
      const res = await hrmsApi.get<{ success: boolean; data: LedgerRow[] }>(`/api/finance/bank-accounts/${bankAccountId}/ledger?${qs}`);
      return res.data ?? [];
    },
    enabled: !!bankAccountId,
  });

  const rows = reportQuery.data ?? [];
  const totals = rows.reduce((acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }), { debit: 0, credit: 0 });
  const selectedAccount = (accountsQuery.data ?? []).find((a: any) => a.id === bankAccountId);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="overflow-hidden rounded-3xl border border-white/60 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm">
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Landmark className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-bold">Bank Account Ledger</h1>
              <p className="text-sm text-blue-100">Credit/Debit report — filterable by account and date range, exportable for Tally.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="cursor-pointer border-white/40 bg-white/10 text-white hover:bg-white/20"
              disabled={!bankAccountId}
              onClick={() => downloadCsv(
                `/api/finance/bank-accounts/${bankAccountId}/tally-export?from=${from}&to=${to}`,
                `tally-export-${selectedAccount?.account_name ?? bankAccountId}-${from}-to-${to}.xml`,
                toast,
              )}
            >
              <Download className="mr-1.5 h-4 w-4" /> Tally XML
            </Button>
            <Button
              className="cursor-pointer bg-white text-blue-700 hover:bg-blue-50"
              disabled={!bankAccountId}
              onClick={() => downloadCsv(
                `/api/finance/bank-accounts/${bankAccountId}/ledger/export?from=${from}&to=${to}`,
                `bank-ledger-${selectedAccount?.account_name ?? bankAccountId}-${from}-to-${to}.csv`,
                toast,
              )}
            >
              <Download className="mr-1.5 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/60 bg-white/95 p-4 shadow-sm backdrop-blur-sm">
        <div className="min-w-[220px]">
          <Label>Bank Account</Label>
          <Select value={bankAccountId} onValueChange={setBankAccountId}>
            <SelectTrigger className="cursor-pointer"><SelectValue placeholder="Select bank account" /></SelectTrigger>
            <SelectContent>
              {(accountsQuery.data ?? []).map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.account_name} — {a.account_number_masked}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {bankAccountId && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
          An export here is "final" only for date ranges fully covered by a closed period in Bank Reconciliation — otherwise it's provisional. Use Bank Reconciliation to close a period before treating its Tally export as the final posting.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
              <tr>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Voucher No.</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Ledger Head</th>
                <th className="px-3 py-2.5">Party/Vendor</th>
                <th className="px-3 py-2.5 text-right">Debit</th>
                <th className="px-3 py-2.5 text-right">Credit</th>
                <th className="px-3 py-2.5 text-right">Running Balance</th>
                <th className="px-3 py-2.5">Instrument/UTR</th>
                <th className="px-3 py-2.5">Narration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-100">
              {!bankAccountId && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Select a bank account</td></tr>}
              {bankAccountId && reportQuery.isLoading && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>}
              {bankAccountId && !reportQuery.isLoading && rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">No entries in this range</td></tr>}
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-blue-50/40">
                  <td className="px-3 py-2 text-gray-600">{r.entry_date}</td>
                  <td className="px-3 py-2 font-mono text-gray-800">{r.voucher_number ?? "—"}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{r.type}</Badge></td>
                  <td className="px-3 py-2 text-gray-600">{r.ledger_head ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{r.party ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold text-rose-600">{money(r.debit)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-emerald-600">{money(r.credit)}</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-800">{money(r.running_balance)}</td>
                  <td className="px-3 py-2 font-mono text-gray-500">{r.instrument_ref ?? "—"}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-gray-500" title={r.narration}>{r.narration}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-blue-100 bg-blue-50/40 font-bold text-gray-800">
                  <td colSpan={5} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right text-rose-700">{money(totals.debit)}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{money(totals.credit)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
