// src/components/finance/client-billing/PoGrnTab.tsx
/**
 * Legacy "ADD PO" (PO master: branch, cost centre, period from/to, PO number, amount; balance
 * drawn down at Invoice Approval) and the "ADD GRN" dialog used from Download Initial Invoice.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { addInvoiceGrn, createPoMaster, listPoMaster } from "@/lib/clientBillingApi";
import { BillingScopeSelects, costCentreSearchOptions, narrowCostCentres, useBillingFilterOptions } from "./BillingScopeSelects";
import { money } from "./shared";

export function PoGrnTab() {
  const [scope, setScope] = useState({ companyName: "", branchId: "" });
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const q = useQuery({
    queryKey: ["client-billing", "po-master", scope, search],
    queryFn: () => listPoMaster({ companyName: scope.companyName || undefined, branchId: scope.branchId || undefined, search: search || undefined }),
  });
  const rows = q.data?.data ?? [];
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <BillingScopeSelects compact companyName={scope.companyName} branchId={scope.branchId} onChange={setScope} />
          <Input className="h-8 w-48 text-xs" placeholder="PO number…" aria-label="Search PO number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />ADD PO</Button>
      </div>
      <div className="flex-1 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-sky-600 text-left text-white">
            <tr>{["Sr. No.", "Branch", "Cost Center", "PO No.", "Period From", "Period To", "Amount", "Balance"].map((h) => <th key={h} className="px-2 py-2 font-semibold !text-white">{h}</th>)}</tr>
          </thead>
          <tbody>
            {q.isLoading ? <tr><td colSpan={8} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No PO found</td></tr>
              : rows.map((r, i) => (
                <tr key={r.id} className="border-b odd:bg-slate-50">
                  <td className="px-2 py-1.5">{i + 1}</td><td className="px-2 py-1.5">{r.branch_name ?? "—"}</td>
                  <td className="px-2 py-1.5">{r.cost_centre_code}<span className="block text-xs text-muted-foreground">{r.client_name}</span></td>
                  <td className="px-2 py-1.5 font-medium">{r.po_number}</td>
                  <td className="px-2 py-1.5">{String(r.period_from).slice(0, 10)}</td><td className="px-2 py-1.5">{String(r.period_to).slice(0, 10)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{money(r.total_amount)}</td><td className="px-2 py-1.5 tabular-nums font-semibold">{money(r.balance_amount)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <AddPoDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function AddPoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const options = useBillingFilterOptions().data?.data;
  const [scope, setScope] = useState({ companyName: "", branchId: "" });
  const [form, setForm] = useState({ costCentreId: "", poNumber: "", periodFrom: "", periodTo: "", amount: "" });
  const reset = () => { setScope({ companyName: "", branchId: "" }); setForm({ costCentreId: "", poNumber: "", periodFrom: "", periodTo: "", amount: "" }); };
  const save = useMutation({
    mutationFn: () => createPoMaster({ ...form, poNumber: form.poNumber.trim(), amount: Number(form.amount) }),
    onSuccess: () => { toast({ title: "PO added" }); void queryClient.invalidateQueries({ queryKey: ["client-billing"] }); reset(); onOpenChange(false); },
    onError: (e: Error) => toast({ title: "Could not add PO", description: e.message, variant: "destructive" }),
  });
  const ok = form.costCentreId && form.poNumber.trim() && form.periodFrom && form.periodTo && Number(form.amount) > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>ADD PO</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <BillingScopeSelects labelled companyName={scope.companyName} branchId={scope.branchId} onChange={(s) => { setScope(s); setForm({ ...form, costCentreId: "" }); }} />
          <div className="col-span-2">
            <Label className="text-xs">Cost Center *</Label>
            <SearchableSelect className="mt-1" options={costCentreSearchOptions(narrowCostCentres(options?.costCentres ?? [], scope.companyName, scope.branchId))}
              value={form.costCentreId} onChange={(v) => setForm({ ...form, costCentreId: v })} placeholder="Select cost centre" aria-label="Cost centre" />
          </div>
          <div className="col-span-2"><Label className="text-xs" htmlFor="po-no">PO Number *</Label><Input id="po-no" className="mt-1 h-8" value={form.poNumber} maxLength={60} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} /></div>
          <div><Label className="text-xs" htmlFor="po-from">Period From *</Label><Input id="po-from" type="date" className="mt-1 h-8" value={form.periodFrom} onChange={(e) => setForm({ ...form, periodFrom: e.target.value })} /></div>
          <div><Label className="text-xs" htmlFor="po-to">Period To *</Label><Input id="po-to" type="date" className="mt-1 h-8" value={form.periodTo} onChange={(e) => setForm({ ...form, periodTo: e.target.value })} /></div>
          <div className="col-span-2"><Label className="text-xs" htmlFor="po-amt">PO Amount (₹) *</Label><Input id="po-amt" type="number" min="0" step="0.01" className="mt-1 h-8" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={!ok || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
