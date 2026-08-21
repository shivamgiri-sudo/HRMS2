/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useHasRole } from "@/hooks/useUserRole";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

interface VendorSummary { id: string; vendor_code: string; vendor_name: string; vendor_type: string; is_active: number; mapping_count: number; }
interface ExpenseHead { id: string; headCode: string; headName: string; subHeads: SubHead[]; }
interface SubHead { id: string; subHeadCode: string; subHeadName: string; capexOpex?: string | null; }
interface MappingRow { head_code: string; sub_head_code: string; }

export function VendorHeadMappingTab() {
  const qc = useQueryClient();
  const canWrite = useHasRole("finance_head", "super_admin");

  const [search, setSearch] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [localMappings, setLocalMappings] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const { data: vendorData, isLoading: loadingV, refetch: refV } = useQuery({
    queryKey: ["vendor-mapping-summary-master"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/finance/vendors/mapping-summary");
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as VendorSummary[];
    },
  });
  const vendors = vendorData ?? [];
  const filtered = vendors.filter(v => !search || v.vendor_name.toLowerCase().includes(search.toLowerCase()) || v.vendor_code.toLowerCase().includes(search.toLowerCase()));

  const { data: headsData } = useQuery({
    queryKey: ["finance-expense-masters"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/finance/expense-masters");
      return ((r as any)?.data ?? r ?? []) as ExpenseHead[];
    },
  });
  const heads = headsData ?? [];

  const { isLoading: loadingMappings } = useQuery({
    queryKey: ["vendor-expense-mappings-master", selectedVendorId],
    queryFn: async () => {
      if (!selectedVendorId) return [];
      const r = await hrmsApi.get<any>(`/api/finance/vendors/${selectedVendorId}/expense-mappings`);
      const rows = ((r as any)?.data?.data ?? (r as any)?.data ?? []) as MappingRow[];
      const keys = new Set(rows.map(m => `${m.head_code}::${m.sub_head_code ?? "*"}`));
      setLocalMappings(keys);
      setDirty(false);
      return rows;
    },
    enabled: !!selectedVendorId,
  });

  const saveMutation = useMutation({
    mutationFn: (mappings: MappingRow[]) =>
      hrmsApi.put(`/api/finance/vendors/${selectedVendorId}/expense-mappings`, { mappings }),
    onSuccess: () => {
      toast.success("Mappings saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["vendor-mapping-summary-master"] });
      qc.invalidateQueries({ queryKey: ["vendor-expense-mappings-master", selectedVendorId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  function toggleSubHead(headCode: string, subHeadCode: string) {
    const key = `${headCode}::${subHeadCode}`;
    setLocalMappings(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setDirty(true);
  }

  function saveAll() {
    const mappings: MappingRow[] = Array.from(localMappings).map(key => {
      const [head_code, sub_head_code] = key.split("::");
      return { head_code, sub_head_code: sub_head_code === "*" ? "" : sub_head_code };
    });
    saveMutation.mutate(mappings);
  }

  function selectVendor(id: string) {
    if (dirty && !confirm("You have unsaved changes. Discard?")) return;
    setSelectedVendorId(id);
    setDirty(false);
  }

  return (
    <div className="flex gap-3 h-full min-h-0" style={{ maxHeight: "calc(100vh - 200px)" }}>
      {/* Left: vendor list */}
      <div className="w-72 shrink-0 flex flex-col border rounded bg-white overflow-hidden">
        <div className="p-2 border-b flex items-center gap-2">
          <Input className="h-7 text-xs flex-1" placeholder="Search vendor…" value={search} onChange={e => setSearch(e.target.value)} />
          <button onClick={() => void refV()} className="text-slate-400 hover:text-slate-600"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingV ? (
            <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
          ) : (
            filtered.map(v => (
              <button
                key={v.id}
                onClick={() => selectVendor(v.id)}
                className={`w-full text-left px-3 py-2 border-b text-xs hover:bg-slate-50 transition-colors ${selectedVendorId === v.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""}`}
              >
                <p className="font-medium text-slate-800 truncate">{v.vendor_name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-slate-400 font-mono">{v.vendor_code}</span>
                  {v.mapping_count === 0
                    ? <Badge variant="outline" className="text-[9px] border-amber-200 text-amber-600 px-1 py-0">Unmapped</Badge>
                    : <Badge variant="outline" className="text-[9px] border-emerald-200 text-emerald-600 px-1 py-0">{v.mapping_count} mapped</Badge>
                  }
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right: head/subhead tree */}
      <div className="flex-1 flex flex-col border rounded bg-white overflow-hidden">
        {!selectedVendorId ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs">
            <p>Select a vendor on the left to configure its allowed expense heads.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50">
              <span className="text-xs font-medium text-slate-700">
                {vendors.find(v => v.id === selectedVendorId)?.vendor_name ?? "Vendor"}
                {" — "}
                <span className="text-slate-400 font-normal">{localMappings.size} sub-head{localMappings.size !== 1 ? "s" : ""} mapped</span>
              </span>
              {canWrite && dirty && (
                <Button size="sm" className="h-7 text-xs gap-1" onClick={saveAll} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </Button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {loadingMappings ? (
                <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
              ) : (
                <div className="space-y-3">
                  {heads.map(h => (
                    <div key={h.id}>
                      <p className="text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wide">{h.headName}</p>
                      <div className="grid grid-cols-2 gap-1">
                        {h.subHeads.map(s => {
                          const key = `${h.headCode}::${s.subHeadCode}`;
                          const checked = localMappings.has(key);
                          const isCapex = s.capexOpex === "capex";
                          return (
                            <label key={s.id} className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer select-none hover:bg-slate-50 ${!canWrite ? "cursor-default" : ""}`}>
                              <input
                                type="checkbox"
                                className="rounded"
                                checked={checked}
                                disabled={!canWrite}
                                onChange={() => canWrite && toggleSubHead(h.headCode, s.subHeadCode)}
                              />
                              <span className={`${checked ? "text-slate-800 font-medium" : "text-slate-500"}`}>{s.subHeadName}</span>
                              {isCapex && <Badge variant="outline" className="text-[9px] border-amber-200 text-amber-600 px-1 py-0 ml-auto">CAPEX</Badge>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
