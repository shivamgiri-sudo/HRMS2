// src/components/finance/client-billing/ReceiptsTab.tsx
/**
 * Client Billing step 6 — money received. Two views: what clients still owe (bill by bill,
 * with overdue days) and the receipt register (each receipt's bank status through its voucher).
 * The only place client money is recorded in HRMS.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, Loader2, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { listOutstandingBills, listReceipts, voidReceipt, type ReceiptRow, type ReceiptState } from "@/lib/clientBillingApi";
import { BillingScopeSelects } from "./BillingScopeSelects";
import { downloadCsv } from "./csv";
import { RecordReceiptSheet } from "./RecordReceiptSheet";
import { money } from "./shared";

const STATE: Record<ReceiptState, { label: string; cls: string }> = {
  awaiting_bank: { label: "Awaiting bank posting", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  in_bank: { label: "In bank", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  voucher_rejected: { label: "Voucher rejected", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
  void: { label: "Void", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
};
const head = "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold !text-slate-600";
const REGISTER_PAGE = 50;
const linkCls = "cursor-pointer text-sky-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded-sm";

function LoadError({ error, onRetry, colSpan }: { error: unknown; onRetry: () => void; colSpan: number }) {
  return (
    <tr><td colSpan={colSpan} className="py-8 text-center">
      <p role="alert" className="text-sm text-rose-700">Could not load: {error instanceof Error ? error.message : "unknown error"}</p>
      <Button size="sm" variant="outline" className="mt-2 cursor-pointer" onClick={onRetry}><RotateCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>
    </td></tr>
  );
}

/** `onOpenInvoice`: bill number click opens the invoice detail drawer (owned by the page). */
export function ReceiptsTab({ onOpenInvoice }: { onOpenInvoice?: (invoiceId: string) => void } = {}) {
  const [view, setView] = useState<"outstanding" | "register">("outstanding");
  const [scope, setScope] = useState({ companyName: "", branchId: "" });
  const [search, setSearch] = useState("");
  const [recordFor, setRecordFor] = useState<{ open: boolean; client?: string; billId?: string }>({ open: false });
  const [dates, setDates] = useState({ fromDate: "", toDate: "" });
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();
  const [voidRow, setVoidRow] = useState<ReceiptRow | null>(null);
  const [status, setStatus] = useState("_all");

  const outstanding = useQuery({
    queryKey: ["client-billing", "outstanding", scope, search],
    queryFn: () => listOutstandingBills({ ...scope, search: search || undefined }),
    enabled: view === "outstanding",
  });
  const register = useQuery({
    queryKey: ["client-billing", "receipts", scope, search, status, dates, page],
    queryFn: () => listReceipts(registerFilters(page, REGISTER_PAGE)),
    enabled: view === "register",
  });
  function registerFilters(p: number, limit: number) {
    return {
      ...scope, search: search || undefined, status: status === "_all" ? undefined : status,
      fromDate: dates.fromDate || undefined, toDate: dates.toDate || undefined, page: p, limit,
    };
  }
  const registerTotal = register.data?.total ?? 0;
  const registerPages = Math.max(1, Math.ceil(registerTotal / REGISTER_PAGE));

  /** No server export route for receipts: page through the register (200 a call) and build the CSV here. */
  async function exportCsv() {
    setExporting(true);
    try {
      if (view === "outstanding") {
        downloadCsv("outstanding-bills.csv",
          ["Client", "Bill no.", "Branch", "Bill date", "Due", "Days past due", "Grand total", "Received", "TDS", "Deduction", "Credit notes", "Outstanding"],
          rows.map((r) => [r.client_name, r.bill_no, r.branch_name, String(r.invoice_date).slice(0, 10), String(r.due_date).slice(0, 10), r.days_past_due,
            r.grand_total, r.received, r.tds, r.deduction, r.credited, r.outstanding]));
        return;
      }
      const all: ReceiptRow[] = [];
      for (let p = 1; p <= 50; p += 1) {
        const res = await listReceipts(registerFilters(p, 200));
        all.push(...res.data);
        if (all.length >= res.total || res.data.length === 0) break;
      }
      downloadCsv("receipt-register.csv",
        ["Receipt no.", "Date", "Client", "Company", "Branch", "Bills", "Received", "TDS", "Deduction", "Mode", "Reference", "Bank", "Voucher", "Status", "Void reason"],
        all.map((r) => [r.receipt_no, String(r.receipt_date).slice(0, 10), r.client_name, r.company_name, r.branch_name, r.bill_nos, r.amount_received, r.tds_amount,
          r.other_deduction, r.payment_mode, r.reference_no, r.bank_account_name, r.voucher_number, STATE[r.state]?.label ?? r.state, r.void_reason]));
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "Unable to export", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const rows = outstanding.data?.data ?? [];
  const totals = useMemo(() => {
    let o = 0, overdue = 0;
    for (const r of rows) { const p = Math.round(Number(r.outstanding) * 100); o += p; if (r.days_past_due > 0) overdue += p; }
    return { outstanding: o / 100, overdue: overdue / 100, bills: rows.length, clients: new Set(rows.map((r) => r.client_name)).size };
  }, [rows]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-slate-50 p-0.5" role="tablist" aria-label="Receipts view">
            {(["outstanding", "register"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
                {v === "outstanding" ? "Outstanding bills" : "Receipt register"}
              </button>
            ))}
          </div>
          <BillingScopeSelects compact companyName={scope.companyName} branchId={scope.branchId} onChange={(s) => { setScope(s); setPage(1); }} />
          <Input className="h-8 w-52 text-xs" placeholder={view === "outstanding" ? "Bill no, client…" : "Receipt no, client, UTR…"} aria-label="Search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          {view === "register" && (
            <div className="flex shrink-0 items-center gap-1.5 rounded-md border bg-slate-50/60 px-2 py-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">From</span>
              <Input type="date" aria-label="Receipts from date" className="h-6 w-32 border-0 bg-transparent px-1 text-xs shadow-none"
                value={dates.fromDate} onChange={(e) => { setDates({ ...dates, fromDate: e.target.value }); setPage(1); }} />
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">To</span>
              <Input type="date" aria-label="Receipts to date" className="h-6 w-32 border-0 bg-transparent px-1 text-xs shadow-none"
                value={dates.toDate} onChange={(e) => { setDates({ ...dates, toDate: e.target.value }); setPage(1); }} />
            </div>
          )}
          {view === "register" && (
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-48 text-xs" aria-label="Receipt status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All receipts</SelectItem>
                {(Object.keys(STATE) as ReceiptState[]).map((k) => <SelectItem key={k} value={k}>{STATE[k].label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 cursor-pointer" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}Export CSV
          </Button>
          <Button size="sm" className="h-8 cursor-pointer" onClick={() => setRecordFor({ open: true })}><Plus className="mr-1.5 h-3.5 w-3.5" />Record receipt</Button>
        </div>
      </div>

      {view === "outstanding" ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[["Outstanding", money(totals.outstanding)], ["Overdue", money(totals.overdue)], ["Bills", String(totals.bills)], ["Clients", String(totals.clients)]].map(([k, v]) => (
              <div key={k} className="rounded-xl border bg-white px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{k}</p>
                <p className={`mt-0.5 text-base font-bold tabular-nums ${k === "Overdue" && totals.overdue > 0 ? "text-rose-700" : "text-slate-900"}`}>{v}</p>
              </div>
            ))}
          </div>
          <div className="flex-1 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50"><tr>
                {["Client", "Bill no.", "Branch", "Bill date", "Due", "Grand total", "Received", "TDS", "Deduction", "Credit notes", "Outstanding", ""].map((h, i) => <th key={i} className={`${head} ${i >= 5 && i <= 10 ? "!text-right" : ""}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {outstanding.isLoading ? <tr><td colSpan={12} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
                  : outstanding.isError ? <LoadError colSpan={12} error={outstanding.error} onRetry={() => void outstanding.refetch()} />
                  : rows.length === 0 ? <tr><td colSpan={12} className="py-8 text-center text-muted-foreground">No outstanding bills</td></tr>
                  : rows.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50/60">
                      <td className="max-w-[220px] px-3 py-1.5 font-medium">{r.client_name}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {onOpenInvoice ? <button type="button" className={linkCls} onClick={() => onOpenInvoice(r.id)} aria-label={`Details of ${r.bill_no}`}>{r.bill_no}</button> : r.bill_no}
                      </td>
                      <td className="px-3 py-1.5 text-xs">{r.branch_name ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">{String(r.invoice_date).slice(0, 10)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {String(r.due_date).slice(0, 10)}
                        {r.days_past_due > 0 && <span className="ml-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">{r.days_past_due}d</span>}
                      </td>
                      {[r.grand_total, r.received, r.tds, r.deduction, r.credited].map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(v)}</td>)}
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{money(r.outstanding)}</td>
                      <td className="px-3 py-1.5"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRecordFor({ open: true, client: r.client_name, billId: r.id })} aria-label={`Record receipt for ${r.bill_no}`}>Receive</Button></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50"><tr>
              {["Receipt no.", "Date", "Client", "Bills", "Received", "TDS", "Deduction", "Mode / ref", "Bank", "Voucher", "Status", ""].map((h, i) => <th key={i} className={`${head} ${i >= 4 && i <= 6 ? "!text-right" : ""}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {register.isLoading ? <tr><td colSpan={12} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
                : register.isError ? <LoadError colSpan={12} error={register.error} onRetry={() => void register.refetch()} />
                : (register.data?.data ?? []).length === 0 ? <tr><td colSpan={12} className="py-8 text-center text-muted-foreground">No receipts</td></tr>
                : (register.data?.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium">{r.receipt_no}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{String(r.receipt_date).slice(0, 10)}</td>
                    <td className="px-3 py-1.5">{r.client_name}</td>
                    <td className="max-w-[220px] truncate px-3 py-1.5 text-xs" title={r.bill_nos ?? ""}>{r.bill_nos}</td>
                    {[r.amount_received, r.tds_amount, r.other_deduction].map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{money(v)}</td>)}
                    <td className="px-3 py-1.5 text-xs">{r.payment_mode}{r.reference_no ? ` · ${r.reference_no}` : ""}</td>
                    <td className="max-w-[160px] truncate px-3 py-1.5 text-xs" title={r.bank_account_name ?? ""}>{r.bank_account_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">{r.voucher_number ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${STATE[r.state].cls}`} title={r.void_reason ?? ""}>{STATE[r.state].label}</span></td>
                    <td className="px-3 py-1.5">
                      {r.state === "awaiting_bank" && !r.is_migrated && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600" aria-label={`Void ${r.receipt_no}`} title="Void receipt" onClick={() => setVoidRow(r)}><Ban className="h-3.5 w-3.5" /></Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {view === "register" && (
        <div className="flex items-center justify-between border-t px-1 py-2 text-xs">
          <span className="text-slate-500">{registerTotal} receipt(s)</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="cursor-pointer" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
            <span className="font-semibold">{page} / {registerPages}</span>
            <Button variant="outline" size="sm" className="cursor-pointer" disabled={page >= registerPages} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}

      <RecordReceiptSheet open={recordFor.open} initialClient={recordFor.client} initialBillId={recordFor.billId} onOpenChange={(o) => setRecordFor({ open: o })} />
      <VoidReceiptDialog row={voidRow} onClose={() => setVoidRow(null)} />
    </div>
  );
}

function VoidReceiptDialog({ row, onClose }: { row: ReceiptRow | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => voidReceipt(row!.id, reason.trim()),
    onSuccess: () => { toast({ title: `Receipt ${row?.receipt_no} voided`, description: "Its bank voucher was withdrawn; the bills are outstanding again." }); setReason(""); void queryClient.invalidateQueries({ queryKey: ["client-billing"] }); onClose(); },
  });
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Void receipt {row?.receipt_no}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Possible only before the money is posted to the bank ledger. Its voucher is withdrawn and the bills become outstanding again.</p>
        <Textarea aria-label="Reason" placeholder="Reason (at least 5 characters)" className="min-h-[72px]" value={reason} onChange={(e) => setReason(e.target.value)} />
        {m.isError && <p role="alert" className="text-sm text-rose-700">{(m.error as Error).message}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={reason.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>{m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Void</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
