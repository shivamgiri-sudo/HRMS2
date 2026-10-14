// src/components/finance/client-billing/PoGrnTab.tsx
/**
 * ADD PO + the PO report (governed PO master): every PO with amount, drawn, balance, utilisation
 * and period status; a row opens the PO with all its invoices, particulars, document and history.
 * Also the "ADD GRN" dialog used from Download Initial Invoice.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCheck2, FileWarning, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { addInvoiceGrn, listPoReport, type PoReportRow, type PoStatus } from "@/lib/clientBillingApi";
import { BillingScopeSelects } from "./BillingScopeSelects";
import { PoDetailSheet } from "./PoDetailSheet";
import { PoFormDialog } from "./PoFormDialog";
import { money } from "./shared";

const STATUS: Record<PoStatus, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  upcoming: { label: "Not started", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  expired: { label: "Period over", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  exhausted: { label: "Fully drawn", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
};

function exportCsv(rows: PoReportRow[]) {
  const head = ["PO No", "Cost Centre", "Client", "Branch", "Period From", "Period To", "Amount", "Drawn", "Balance", "Utilisation %", "Status", "Bills", "Document"];
  const cell = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const body = rows.map((r) => [r.poNumber, r.costCentre, r.client, r.branch, r.periodFrom, r.periodTo, r.amount.toFixed(2), r.drawn.toFixed(2), r.balance.toFixed(2), r.utilisation, STATUS[r.status].label, r.bills, r.hasDocument ? "Yes" : "No"].map(cell).join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "po-report.csv"; a.click(); URL.revokeObjectURL(a.href);
}

export function PoGrnTab() {
  const [scope, setScope] = useState({ companyName: "", branchId: "" });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PoStatus | "all">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [openPo, setOpenPo] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["client-billing", "po-master", scope, search, status],
    queryFn: () => listPoReport({ companyName: scope.companyName || undefined, branchId: scope.branchId || undefined, search: search || undefined, status: status === "all" ? undefined : status }),
  });
  const rows = q.data?.data ?? [];
  const sum = (f: (r: PoReportRow) => number) => rows.reduce((s, r) => s + Math.round(f(r) * 100), 0) / 100;
  const cols = ["Sr.", "PO No.", "Cost Center", "Branch", "Period", "Amount", "Drawn", "Balance", "Utilisation", "Status", "Bills", "Doc"];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <BillingScopeSelects compact companyName={scope.companyName} branchId={scope.branchId} onChange={setScope} />
          <Input className="h-8 w-48 text-xs" placeholder="PO number / cost centre…" aria-label="Search PO" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onValueChange={(v) => setStatus(v as PoStatus | "all")}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="PO status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(STATUS) as PoStatus[]).map((k) => <SelectItem key={k} value={k}>{STATUS[k].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8" disabled={!rows.length} onClick={() => exportCsv(rows)}><Download className="mr-1.5 h-3.5 w-3.5" />PO report CSV</Button>
          <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />ADD PO</Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-sky-600 text-left text-white">
            <tr>{cols.map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold !text-white">{h}</th>)}</tr>
          </thead>
          <tbody>
            {q.isLoading ? <tr><td colSpan={cols.length} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
              : q.isError ? <tr><td colSpan={cols.length} className="py-8 text-center text-rose-700">Could not load POs: {(q.error as Error).message}</td></tr>
              : rows.length === 0 ? <tr><td colSpan={cols.length} className="py-8 text-center text-muted-foreground">No PO found</td></tr>
              : rows.map((r, i) => (
                <tr key={r.id} className="cursor-pointer border-b odd:bg-slate-50 hover:bg-sky-50" onClick={() => setOpenPo(r.id)}>
                  <td className="px-2 py-1.5">{i + 1}</td>
                  <td className="px-2 py-1.5 font-medium text-sky-800 underline-offset-2 hover:underline">{r.poNumber}</td>
                  <td className="px-2 py-1.5">{r.costCentre}<span className="block text-xs text-muted-foreground">{r.client}</span></td>
                  <td className="px-2 py-1.5">{r.branch || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{r.periodFrom} → {r.periodTo}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(r.drawn)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{money(r.balance)}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full ${r.utilisation >= 90 ? "bg-amber-500" : "bg-sky-500"}`} style={{ width: `${Math.min(100, r.utilisation)}%` }} /></span>
                      <span className="text-xs tabular-nums">{r.utilisation}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ring-1 ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.bills}</td>
                  <td className="px-2 py-1.5">{r.hasDocument ? <FileCheck2 className="h-4 w-4 text-emerald-600" aria-label="PO document on file" /> : <FileWarning className="h-4 w-4 text-amber-600" aria-label="No PO document" />}</td>
                </tr>
              ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="sticky bottom-0 bg-slate-100 font-semibold">
              <tr><td colSpan={5} className="px-2 py-1.5 text-right">Total ({rows.length} POs)</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(sum((r) => r.amount))}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(sum((r) => r.drawn))}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money(sum((r) => r.balance))}</td>
                <td colSpan={4} /></tr>
            </tfoot>
          )}
        </table>
      </div>
      <PoFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <PoDetailSheet poId={openPo} onClose={() => setOpenPo(null)} />
    </div>
  );
}

export function AddGrnDialog({ target, onClose }: { target: { id: string; label: string; grnNo?: string | null; grnDate?: string | null } | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [grnNo, setGrnNo] = useState("");
  const [grnDate, setGrnDate] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (target && loadedFor !== target.id) { setLoadedFor(target.id); setGrnNo(target.grnNo ?? ""); setGrnDate(target.grnDate ? String(target.grnDate).slice(0, 10) : ""); }
  const save = useMutation({
    mutationFn: () => addInvoiceGrn(target!.id, grnNo.trim(), grnDate || null),
    onSuccess: () => { toast({ title: "GRN saved", description: target?.label }); void queryClient.invalidateQueries({ queryKey: ["client-billing"] }); setLoadedFor(null); onClose(); },
    onError: (e: Error) => toast({ title: "Could not save GRN", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => { if (!o) { setLoadedFor(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>ADD GRN · {target?.label}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs" htmlFor="grn-no">GRN No. *</Label><Input id="grn-no" className="mt-1 h-8" maxLength={60} value={grnNo} onChange={(e) => setGrnNo(e.target.value)} /></div>
          <div><Label className="text-xs" htmlFor="grn-date">GRN Date</Label><Input id="grn-date" type="date" className="mt-1 h-8" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!grnNo.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
