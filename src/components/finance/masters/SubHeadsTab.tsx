/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useHasRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Check, X, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

const TAX_TREATMENTS = ["inclusive", "exclusive", "exempt", "reverse_charge", "non_gst"] as const;
const GST_TYPES = ["cgst_sgst", "igst", "none"] as const;
const PNL_TREATMENTS = ["operating_expense", "direct_cost", "non_operating", "excluded"] as const;
const ALLOCATION_DRIVERS = ["headcount", "revenue", "seat_cost", "equal", "manual", ""] as const;

interface ExpenseHead {
  id: string; headCode: string; headName: string; subHeads: SubHead[];
}
interface SubHead {
  id: string; subHeadCode: string; subHeadName: string;
  defaultUnit: string; defaultTaxTreatment: string; defaultGstRate: number;
  defaultGstType: string; defaultRecoverableTaxPct: number;
  defaultAllocationDriver?: string | null; pnlTreatment: string;
  capexOpex?: string | null; displayOrder: number; activeStatus: boolean;
}
type NewSub = {
  subHeadName: string; defaultUnit: string; defaultTaxTreatment: string;
  defaultGstRate: string; defaultGstType: string; defaultRecoverableTaxPct: string;
  pnlTreatment: string; defaultAllocationDriver: string; displayOrder: string; activeStatus: boolean;
};

const emptyNew = (): NewSub => ({
  subHeadName: "", defaultUnit: "Lump Sum", defaultTaxTreatment: "exclusive",
  defaultGstRate: "18", defaultGstType: "cgst_sgst", defaultRecoverableTaxPct: "100",
  pnlTreatment: "operating_expense", defaultAllocationDriver: "", displayOrder: "0", activeStatus: true,
});

export function SubHeadsTab() {
  const qc = useQueryClient();
  const canWrite = useHasRole("finance_head", "super_admin");
  const canEdit  = useHasRole("super_admin");

  const [selectedHeadId, setSelectedHeadId] = useState<string>("");
  const [addingNew, setAddingNew] = useState(false);
  const [newSub, setNewSub] = useState<NewSub>(emptyNew());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSub, setEditSub] = useState<NewSub>(emptyNew());

  const { data: headsData, isLoading } = useQuery({
    queryKey: ["finance-expense-masters"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/finance/expense-masters?includeInactive=true");
      return ((r as any)?.data ?? r ?? []) as ExpenseHead[];
    },
  });
  const heads = headsData ?? [];
  const selectedHead = heads.find(h => h.id === selectedHeadId);
  const subHeads = selectedHead?.subHeads ?? [];

  const saveMutation = useMutation({
    mutationFn: (body: any) => hrmsApi.post("/api/finance/expense-sub-heads", body),
    onSuccess: () => {
      toast.success("Sub-head saved");
      qc.invalidateQueries({ queryKey: ["finance-expense-masters"] });
      setAddingNew(false);
      setNewSub(emptyNew());
      setEditingId(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/finance/expense-sub-heads/${id}`),
    onSuccess: () => {
      toast.success("Sub-head retired/removed");
      qc.invalidateQueries({ queryKey: ["finance-expense-masters"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  function submitNew() {
    saveMutation.mutate({ headId: selectedHeadId, ...newSub, defaultGstRate: Number(newSub.defaultGstRate), defaultRecoverableTaxPct: Number(newSub.defaultRecoverableTaxPct), displayOrder: Number(newSub.displayOrder) });
  }
  function submitEdit(id: string) {
    saveMutation.mutate({ id, headId: selectedHeadId, ...editSub, defaultGstRate: Number(editSub.defaultGstRate), defaultRecoverableTaxPct: Number(editSub.defaultRecoverableTaxPct), displayOrder: Number(editSub.displayOrder) });
  }
  function startEdit(s: SubHead) {
    setEditingId(s.id);
    setEditSub({ subHeadName: s.subHeadName, defaultUnit: s.defaultUnit, defaultTaxTreatment: s.defaultTaxTreatment, defaultGstRate: String(s.defaultGstRate), defaultGstType: s.defaultGstType, defaultRecoverableTaxPct: String(s.defaultRecoverableTaxPct), pnlTreatment: s.pnlTreatment, defaultAllocationDriver: s.defaultAllocationDriver ?? "", displayOrder: String(s.displayOrder), activeStatus: s.activeStatus });
  }

  return (
    <div className="space-y-3">
      {/* Head selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-slate-600 shrink-0">Expense Head:</span>
        <Select value={selectedHeadId} onValueChange={v => { setSelectedHeadId(v); setAddingNew(false); setEditingId(null); }}>
          <SelectTrigger className="h-8 w-72 text-sm">
            <SelectValue placeholder="Select a head to manage sub-heads…" />
          </SelectTrigger>
          <SelectContent>
            {heads.map(h => (
              <SelectItem key={h.id} value={h.id}>{h.headName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>

      {!selectedHeadId ? (
        <p className="text-xs text-slate-400 py-6 text-center">Select an expense head above to view and manage its sub-heads.</p>
      ) : (
        <div className="rounded border bg-white overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[80px_1fr_80px_90px_60px_70px_90px_90px_60px_70px_70px] gap-0 border-b bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {["Code","Name","Unit","Tax Treat.","GST%","GST Type","Rcv%","P&L","Order","Active","Actions"].map(col => (
              <div key={col} className="px-2 py-2">{col}</div>
            ))}
          </div>

          {subHeads.length === 0 && !addingNew && (
            <div className="py-8 text-center text-xs text-slate-400">No sub-heads yet. Add one below.</div>
          )}

          {subHeads.map(s => {
            const isCapex = s.capexOpex === "capex";
            const isEditing = editingId === s.id;
            return (
              <div key={s.id} className={`grid grid-cols-[80px_1fr_80px_90px_60px_70px_90px_90px_60px_70px_70px] gap-0 border-b text-xs hover:bg-slate-50 transition-colors ${!s.activeStatus ? "opacity-50" : ""}`}>
                <div className="px-2 py-1.5 font-mono text-slate-400 self-center">
                  {s.subHeadCode}
                  {isCapex && <Badge variant="outline" className="ml-1 text-[9px] border-amber-300 text-amber-700 bg-amber-50 px-1 py-0" title="Excluded from P&L">CAPEX</Badge>}
                </div>
                {isEditing ? (
                  <>
                    <div className="px-1 py-1"><Input className="h-6 text-xs" value={editSub.subHeadName} onChange={e => setEditSub(r => ({ ...r, subHeadName: e.target.value }))} /></div>
                    <div className="px-1 py-1"><Input className="h-6 text-xs" value={editSub.defaultUnit} onChange={e => setEditSub(r => ({ ...r, defaultUnit: e.target.value }))} /></div>
                    <div className="px-1 py-1">
                      <Select value={editSub.defaultTaxTreatment} onValueChange={v => setEditSub(r => ({ ...r, defaultTaxTreatment: v }))}>
                        <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{TAX_TREATMENTS.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="px-1 py-1"><Input className="h-6 text-xs" type="number" value={editSub.defaultGstRate} onChange={e => setEditSub(r => ({ ...r, defaultGstRate: e.target.value }))} /></div>
                    <div className="px-1 py-1">
                      <Select value={editSub.defaultGstType} onValueChange={v => setEditSub(r => ({ ...r, defaultGstType: v }))}>
                        <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{GST_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="px-1 py-1"><Input className="h-6 text-xs" type="number" value={editSub.defaultRecoverableTaxPct} onChange={e => setEditSub(r => ({ ...r, defaultRecoverableTaxPct: e.target.value }))} /></div>
                    <div className="px-1 py-1">
                      <Select value={editSub.pnlTreatment} onValueChange={v => setEditSub(r => ({ ...r, pnlTreatment: v }))}>
                        <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent>{PNL_TREATMENTS.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="px-1 py-1"><Input className="h-6 text-xs w-12" type="number" value={editSub.displayOrder} onChange={e => setEditSub(r => ({ ...r, displayOrder: e.target.value }))} /></div>
                    <div className="px-1 py-1 self-center"><Switch checked={editSub.activeStatus} onCheckedChange={v => setEditSub(r => ({ ...r, activeStatus: v }))} className="scale-75 origin-left" /></div>
                    <div className="px-1 py-1 flex items-center gap-1">
                      <button onClick={() => submitEdit(s.id)} className="text-emerald-600"><Check className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setEditingId(null)} className="text-slate-400"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="px-2 py-1.5 self-center font-medium text-slate-700">{s.subHeadName}</div>
                    <div className="px-2 py-1.5 self-center text-slate-500">{s.defaultUnit}</div>
                    <div className="px-2 py-1.5 self-center text-slate-500">{s.defaultTaxTreatment}</div>
                    <div className="px-2 py-1.5 self-center text-slate-500">{s.defaultGstRate}%</div>
                    <div className="px-2 py-1.5 self-center text-slate-500">{s.defaultGstType}</div>
                    <div className="px-2 py-1.5 self-center text-slate-500">{s.defaultRecoverableTaxPct}%</div>
                    <div className="px-2 py-1.5 self-center">
                      {isCapex
                        ? <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700 bg-amber-50">excluded</Badge>
                        : <span className="text-slate-500">{s.pnlTreatment}</span>
                      }
                    </div>
                    <div className="px-2 py-1.5 self-center text-slate-400">{s.displayOrder}</div>
                    <div className="px-2 py-1.5 self-center"><Badge variant={s.activeStatus ? "default" : "secondary"} className="text-[9px]">{s.activeStatus ? "Y" : "N"}</Badge></div>
                    {canWrite && (
                      <div className="px-1 py-1 flex items-center gap-1">
                        {canEdit && <button onClick={() => startEdit(s)} className="text-slate-300 hover:text-blue-500"><Pencil className="h-3 w-3" /></button>}
                        <button onClick={() => deleteMutation.mutate(s.id)} className="text-slate-200 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Inline add row */}
          {addingNew && (
            <div className="grid grid-cols-[80px_1fr_80px_90px_60px_70px_90px_90px_60px_70px_70px] gap-0 border-b bg-emerald-50/40 text-xs">
              <div className="px-2 py-1.5 text-slate-300 self-center italic">auto</div>
              <div className="px-1 py-1"><Input className="h-6 text-xs" placeholder="Sub-head name *" value={newSub.subHeadName} onChange={e => setNewSub(r => ({ ...r, subHeadName: e.target.value }))} /></div>
              <div className="px-1 py-1"><Input className="h-6 text-xs" placeholder="Unit" value={newSub.defaultUnit} onChange={e => setNewSub(r => ({ ...r, defaultUnit: e.target.value }))} /></div>
              <div className="px-1 py-1">
                <Select value={newSub.defaultTaxTreatment} onValueChange={v => setNewSub(r => ({ ...r, defaultTaxTreatment: v }))}>
                  <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{TAX_TREATMENTS.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="px-1 py-1"><Input className="h-6 text-xs" type="number" value={newSub.defaultGstRate} onChange={e => setNewSub(r => ({ ...r, defaultGstRate: e.target.value }))} /></div>
              <div className="px-1 py-1">
                <Select value={newSub.defaultGstType} onValueChange={v => setNewSub(r => ({ ...r, defaultGstType: v }))}>
                  <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{GST_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="px-1 py-1"><Input className="h-6 text-xs" type="number" value={newSub.defaultRecoverableTaxPct} onChange={e => setNewSub(r => ({ ...r, defaultRecoverableTaxPct: e.target.value }))} /></div>
              <div className="px-1 py-1">
                <Select value={newSub.pnlTreatment} onValueChange={v => setNewSub(r => ({ ...r, pnlTreatment: v }))}>
                  <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{PNL_TREATMENTS.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="px-1 py-1"><Input className="h-6 text-xs w-12" type="number" value={newSub.displayOrder} onChange={e => setNewSub(r => ({ ...r, displayOrder: e.target.value }))} /></div>
              <div className="px-1 py-1 self-center"><Switch checked={newSub.activeStatus} onCheckedChange={v => setNewSub(r => ({ ...r, activeStatus: v }))} className="scale-75 origin-left" /></div>
              <div className="px-1 py-1 flex items-center gap-1">
                <button onClick={submitNew} disabled={!newSub.subHeadName.trim() || saveMutation.isPending} className="text-emerald-600 disabled:opacity-40"><Check className="h-4 w-4" /></button>
                <button onClick={() => setAddingNew(false)} className="text-slate-400"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {canWrite && !addingNew && (
            <div className="px-3 py-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-emerald-700" onClick={() => setAddingNew(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Sub-Head
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
