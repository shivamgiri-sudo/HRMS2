/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useHasRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Pencil, Check, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface SubHead { capexOpex?: string | null; }
interface ExpenseHead {
  id: string; headCode: string; headName: string;
  description: string | null; displayOrder: number;
  activeStatus: boolean; subHeads: SubHead[];
}

interface EditRow { headName: string; description: string; displayOrder: string; activeStatus: boolean; }

export function ExpenseHeadsTab() {
  const qc = useQueryClient();
  const canWrite = useHasRole("finance_head", "super_admin");
  const canEdit  = useHasRole("super_admin");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<EditRow>({ headName: "", description: "", displayOrder: "0", activeStatus: true });
  const [addingNew, setAddingNew] = useState(false);
  const [newRow, setNewRow] = useState<EditRow>({ headName: "", description: "", displayOrder: "0", activeStatus: true });

  const { data, isLoading } = useQuery({
    queryKey: ["finance-expense-masters"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/finance/expense-masters?includeInactive=true");
      return ((r as any)?.data ?? r ?? []) as ExpenseHead[];
    },
  });
  const heads = data ?? [];

  const saveMutation = useMutation({
    mutationFn: (body: any) => hrmsApi.post("/api/finance/expense-heads", body),
    onSuccess: () => {
      toast.success("Expense head saved");
      qc.invalidateQueries({ queryKey: ["finance-expense-masters"] });
      setEditingId(null);
      setAddingNew(false);
      setNewRow({ headName: "", description: "", displayOrder: "0", activeStatus: true });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/finance/expense-heads/${id}`),
    onSuccess: (_, id) => {
      toast.success("Expense head retired/removed");
      qc.invalidateQueries({ queryKey: ["finance-expense-masters"] });
      if (editingId === id) setEditingId(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  function startEdit(h: ExpenseHead) {
    setEditingId(h.id);
    setEditRow({ headName: h.headName, description: h.description ?? "", displayOrder: String(h.displayOrder), activeStatus: h.activeStatus });
  }

  function saveEdit(id: string) {
    saveMutation.mutate({ id, headName: editRow.headName, description: editRow.description, displayOrder: Number(editRow.displayOrder), activeStatus: editRow.activeStatus });
  }

  function saveNew() {
    saveMutation.mutate({ headName: newRow.headName, description: newRow.description, displayOrder: Number(newRow.displayOrder), activeStatus: newRow.activeStatus });
  }

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="rounded border bg-white overflow-hidden">
      {/* Header row */}
      <div className="grid grid-cols-[80px_1fr_1fr_80px_70px_80px] gap-0 border-b bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <div className="px-3 py-2">Code</div>
        <div className="px-3 py-2">Head Name</div>
        <div className="px-3 py-2">Description</div>
        <div className="px-3 py-2">Order</div>
        <div className="px-3 py-2">Active</div>
        {canWrite && <div className="px-3 py-2">Actions</div>}
      </div>

      {/* Existing rows */}
      {heads.map(h => {
        const isCapex = h.subHeads.some(s => s.capexOpex === "capex");
        const isEditing = editingId === h.id;
        return (
          <div key={h.id} className={`grid grid-cols-[80px_1fr_1fr_80px_70px_80px] gap-0 border-b text-sm hover:bg-slate-50 transition-colors ${!h.activeStatus ? "opacity-50" : ""}`}>
            <div className="px-3 py-1.5 font-mono text-xs text-slate-500 self-center">
              {h.headCode}
              {isCapex && <Badge variant="outline" className="ml-1 text-[9px] border-amber-300 text-amber-700 bg-amber-50 px-1 py-0">CAPEX</Badge>}
            </div>
            {isEditing ? (
              <>
                <div className="px-2 py-1"><Input className="h-7 text-xs" value={editRow.headName} onChange={e => setEditRow(r => ({ ...r, headName: e.target.value }))} /></div>
                <div className="px-2 py-1"><Input className="h-7 text-xs" value={editRow.description} onChange={e => setEditRow(r => ({ ...r, description: e.target.value }))} /></div>
                <div className="px-2 py-1"><Input className="h-7 text-xs w-16" type="number" value={editRow.displayOrder} onChange={e => setEditRow(r => ({ ...r, displayOrder: e.target.value }))} /></div>
                <div className="px-2 py-1 self-center"><Switch checked={editRow.activeStatus} onCheckedChange={v => setEditRow(r => ({ ...r, activeStatus: v }))} /></div>
                <div className="px-2 py-1 flex items-center gap-1">
                  <button onClick={() => saveEdit(h.id)} className="text-emerald-600 hover:text-emerald-700"><Check className="h-4 w-4" /></button>
                  <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                </div>
              </>
            ) : (
              <>
                <div className="px-3 py-1.5 self-center font-medium text-slate-800">{h.headName}</div>
                <div className="px-3 py-1.5 self-center text-xs text-slate-500">{h.description ?? "—"}</div>
                <div className="px-3 py-1.5 self-center text-xs text-slate-500">{h.displayOrder}</div>
                <div className="px-3 py-1.5 self-center">
                  <Badge variant={h.activeStatus ? "default" : "secondary"} className="text-[10px]">{h.activeStatus ? "Yes" : "No"}</Badge>
                </div>
                {canWrite && (
                  <div className="px-2 py-1 flex items-center gap-1">
                    {canEdit && <button onClick={() => startEdit(h)} className="text-slate-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>}
                    <button onClick={() => deleteMutation.mutate(h.id)} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Inline add row */}
      {addingNew && (
        <div className="grid grid-cols-[80px_1fr_1fr_80px_70px_80px] gap-0 border-b bg-emerald-50/40 text-sm">
          <div className="px-3 py-1.5 text-xs text-slate-400 self-center italic">auto</div>
          <div className="px-2 py-1"><Input className="h-7 text-xs" placeholder="Head name *" value={newRow.headName} onChange={e => setNewRow(r => ({ ...r, headName: e.target.value }))} /></div>
          <div className="px-2 py-1"><Input className="h-7 text-xs" placeholder="Description" value={newRow.description} onChange={e => setNewRow(r => ({ ...r, description: e.target.value }))} /></div>
          <div className="px-2 py-1"><Input className="h-7 text-xs w-16" type="number" value={newRow.displayOrder} onChange={e => setNewRow(r => ({ ...r, displayOrder: e.target.value }))} /></div>
          <div className="px-2 py-1 self-center"><Switch checked={newRow.activeStatus} onCheckedChange={v => setNewRow(r => ({ ...r, activeStatus: v }))} /></div>
          <div className="px-2 py-1 flex items-center gap-1">
            <button onClick={saveNew} disabled={!newRow.headName.trim() || saveMutation.isPending} className="text-emerald-600 hover:text-emerald-700 disabled:opacity-40"><Check className="h-4 w-4" /></button>
            <button onClick={() => setAddingNew(false)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* Footer */}
      {canWrite && !addingNew && (
        <div className="px-3 py-2">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-emerald-700 hover:text-emerald-800" onClick={() => setAddingNew(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Head
          </Button>
        </div>
      )}
    </div>
  );
}
