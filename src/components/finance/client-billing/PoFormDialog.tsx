// src/components/finance/client-billing/PoFormDialog.tsx
/**
 * ADD PO / Edit PO. A PO is its particulars (qty x rate; the amount is their sum), a period, a
 * free-text PO number (digits, letters or both) and the client's PO document (PDF / Word,
 * required when the PO is created). The server enforces the same rules plus the edit guards
 * (not below what bills drew, period must keep those bills, number fixed once used).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { savePo, type PoDetail } from "@/lib/clientBillingApi";
import { BillingScopeSelects, costCentreSearchOptions, narrowCostCentres, useBillingFilterOptions } from "./BillingScopeSelects";
import { money } from "./shared";

interface Line { particulars: string; qty: string; rate: string }
const blank = (): Line => ({ particulars: "", qty: "", rate: "" });
const paise = (l: Line) => Math.round(Number(l.qty || 0) * Number(l.rate || 0) * 100);
const ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_RE = /\.(pdf|docx?)$/i;

export function PoFormDialog({ open, onOpenChange, editing }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit mode when given. */
  editing?: PoDetail | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const options = useBillingFilterOptions().data?.data;
  const [scope, setScope] = useState({ companyName: "", branchId: "" });
  const [costCentreId, setCostCentreId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); setFile(null);
    if (editing) {
      setCostCentreId(editing.po.costCentreId); setPoNumber(editing.po.poNumber);
      setPeriodFrom(editing.po.periodFrom); setPeriodTo(editing.po.periodTo); setRemarks(editing.po.remarks ?? "");
      // A PO from before particulars existed opens as one line carrying its amount.
      setLines(editing.lines.length
        ? editing.lines.map((l) => ({ particulars: l.particulars, qty: String(l.qty), rate: String(l.rate) }))
        : [{ particulars: "PO amount", qty: "1", rate: String(editing.po.amount) }]);
    } else {
      setScope({ companyName: "", branchId: "" }); setCostCentreId(""); setPoNumber(""); setPeriodFrom(""); setPeriodTo("");
      setLines([blank()]); setRemarks("");
    }
  }, [open, editing]);

  const totalPaise = useMemo(() => lines.reduce((s, l) => s + paise(l), 0), [lines]);
  const drawnPaise = Math.round((editing?.po.drawn ?? 0) * 100);
  const linesOk = lines.length > 0 && lines.every((l) => l.particulars.trim() && Number(l.qty) > 0 && l.rate !== "" && Number(l.rate) >= 0);
  const fileOk = file ? DOC_RE.test(file.name) && file.size <= 20 * 1024 * 1024 : Boolean(editing);
  const problems = [
    !editing && !costCentreId && "Pick the cost centre.",
    !poNumber.trim() && "Enter the PO number.",
    poNumber.includes(",") && "A PO number cannot contain a comma.",
    (!periodFrom || !periodTo) && "Enter the PO period.",
    periodFrom && periodTo && periodFrom > periodTo && "Period from must be on or before period to.",
    !linesOk && "Every particular needs a description, qty above 0 and a rate.",
    totalPaise <= 0 && "PO amount must be above zero.",
    editing && totalPaise < drawnPaise && `Amount cannot go below ${money(drawnPaise / 100)} already drawn by bills.`,
    !fileOk && (file ? "The PO document must be a PDF or Word file up to 20 MB." : "Attach the PO document (PDF or Word)."),
  ].filter(Boolean) as string[];

  const save = useMutation({
    mutationFn: () => savePo({
      costCentreId: editing ? undefined : costCentreId,
      poNumber: poNumber.trim(), periodFrom, periodTo, remarks: remarks.trim() || null,
      lines: lines.map((l) => ({ particulars: l.particulars.trim(), qty: Number(l.qty), rate: Number(l.rate) })),
    }, file, editing?.po.id),
    onMutate: () => setError(null),
    onSuccess: () => {
      toast({ title: editing ? "PO updated" : "PO added", description: poNumber.trim() });
      void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
      onOpenChange(false);
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>{editing ? `Edit PO · ${editing.po.poNumber}` : "ADD PO"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {editing ? (
            <p className="col-span-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {editing.po.costCentre} · {editing.po.client} · {editing.po.branch}
              <span className="block text-xs text-slate-500">Drawn by bills: {money(editing.po.drawn)} · balance {money(editing.po.balance)}</span>
            </p>
          ) : (
            <>
              <BillingScopeSelects labelled companyName={scope.companyName} branchId={scope.branchId} onChange={(s) => { setScope(s); setCostCentreId(""); }} />
              <div className="col-span-2">
                <Label className="text-xs">Cost Center *</Label>
                <SearchableSelect className="mt-1" options={costCentreSearchOptions(narrowCostCentres(options?.costCentres ?? [], scope.companyName, scope.branchId))}
                  value={costCentreId} onChange={setCostCentreId} placeholder="Select cost centre" aria-label="Cost centre" />
              </div>
            </>
          )}
          <div className="col-span-2">
            <Label className="text-xs" htmlFor="po-no">PO Number * <span className="text-slate-500">(any format — digits, letters or both)</span></Label>
            <Input id="po-no" type="text" inputMode="text" autoComplete="off" className="mt-1 h-8" value={poNumber} maxLength={60} onChange={(e) => setPoNumber(e.target.value)} />
          </div>
          <div><Label className="text-xs" htmlFor="po-from">Period From *</Label><Input id="po-from" type="date" className="mt-1 h-8" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} /></div>
          <div><Label className="text-xs" htmlFor="po-to">Period To *</Label><Input id="po-to" type="date" className="mt-1 h-8" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} /></div>
        </div>

        <section className="rounded-md border" aria-label="PO particulars">
          <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-1.5">
            <h3 className="text-sm font-medium text-slate-800">Particulars</h3>
            <Button type="button" size="sm" variant="outline" className="h-7 cursor-pointer" onClick={() => setLines([...lines, blank()])}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-600">
              <th className="w-10 px-2 py-1">#</th><th className="px-2 py-1">Particulars</th><th className="w-24 px-2 py-1">Qty</th><th className="w-32 px-2 py-1">Rate (₹)</th><th className="w-36 px-2 py-1 text-right">Amount</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1 text-xs text-slate-500">{i + 1}</td>
                  <td className="px-2 py-1"><Input aria-label={`PO particulars ${i + 1}`} className="h-8" value={l.particulars} maxLength={255} onChange={(e) => set(i, { particulars: e.target.value })} /></td>
                  <td className="px-2 py-1"><Input aria-label={`PO qty ${i + 1}`} className="h-8" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} /></td>
                  <td className="px-2 py-1"><Input aria-label={`PO rate ${i + 1}`} className="h-8" inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} /></td>
                  <td className="px-2 py-1 text-right tabular-nums">{money(paise(l) / 100)}</td>
                  <td className="px-1 py-1">
                    {lines.length > 1 && (
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 cursor-pointer text-rose-600" aria-label={`Remove PO line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t bg-slate-50 font-semibold"><td colSpan={4} className="px-2 py-1.5 text-right">PO amount</td><td className="px-2 py-1.5 text-right tabular-nums">{money(totalPaise / 100)}</td><td /></tr></tfoot>
          </table>
        </section>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs" htmlFor="po-file">PO document {editing ? "(replace)" : "*"} <span className="text-slate-500">PDF / Word, max 20 MB</span></Label>
            <label htmlFor="po-file" className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <Upload className="h-4 w-4 shrink-0" />
              <span className="truncate">{file ? file.name : editing?.po.document ? `On file: ${editing.po.document.name}` : "Choose file…"}</span>
            </label>
            <input id="po-file" type="file" accept={ACCEPT} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <p className="mt-1 flex items-center gap-1 text-xs text-slate-600"><FileText className="h-3 w-3" />{(file.size / 1024).toFixed(0)} KB</p>}
          </div>
          <div>
            <Label className="text-xs" htmlFor="po-remarks">Remarks</Label>
            <Textarea id="po-remarks" className="mt-1 min-h-[60px]" maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
        ) : problems.length > 0 && <p className="text-xs text-slate-600">{problems[0]}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" disabled={problems.length > 0 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{editing ? "Save changes" : "Save PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
