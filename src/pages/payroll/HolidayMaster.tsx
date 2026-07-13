import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { Search } from "lucide-react";

const TYPE_BADGE: Record<string, string> = {
  national: "bg-blue-100 text-blue-800",
  regional: "bg-purple-100 text-purple-800",
  restricted: "bg-gray-100 text-gray-800",
  process_specific: "bg-orange-100 text-orange-800",
};

const HOLIDAY_TYPES = ["national", "regional", "restricted", "process_specific"];

interface Holiday {
  id: string;
  holiday_name: string;
  holiday_date: string;
  holiday_type: string;
  branch_id: string | null;
  active_status: number;
  cost_centre_ids: string[] | null;
  designation_ids: string[] | null;
}

interface Branch { id: string; branch_name: string; }
interface CostCentre { id: string; cost_centre_name: string; cost_centre_code: string; branch_id: string; }
interface Designation { id: string; designation_name: string; }

const emptyForm = { holiday_name: "", holiday_date: "", holiday_type: "national", branch_id: "", active_status: 1 };

export default function HolidayMaster() {
  const { roleKeys } = useWorkforceAccess();
  const qc = useQueryClient();

  const [showInactive, setShowInactive] = useState(false);
  const [yearFilter, setYearFilter] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Holiday | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const [ccRow, setCcRow] = useState<Holiday | null>(null);
  const [ccSelected, setCcSelected] = useState<Set<string>>(new Set());
  const [ccSearch, setCcSearch] = useState("");

  const [desRow, setDesRow] = useState<Holiday | null>(null);
  const [desSelected, setDesSelected] = useState<Set<string>>(new Set());
  const [desSearch, setDesSearch] = useState("");

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holiday-master", showInactive, yearFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (showInactive) params.set("includeInactive", "1");
      if (yearFilter) params.set("year", yearFilter);
      return hrmsApi.get<any>(`/api/payroll/holiday-master?${params}`).then((d: any) => Array.isArray(d) ? d : d.data ?? []);
    },
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ["org-branches-active"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?active_status=1").then((d: any) => d.data ?? d ?? []),
  });

  const { data: costCentres = [] } = useQuery<CostCentre[]>({
    queryKey: ["org-cost-centres-active"],
    queryFn: () => hrmsApi.get<any>("/api/org/cost-centres?active_status=1").then((d: any) => d.data ?? d ?? []),
  });

  const { data: designations = [] } = useQuery<Designation[]>({
    queryKey: ["org-designations-active"],
    queryFn: () => hrmsApi.get<any>("/api/org/designations?active_status=1").then((d: any) => d.data ?? d ?? []),
  });

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.branch_name])), [branches]);

  const filteredCostCentres = useMemo(() =>
    costCentres.filter((cc) =>
      !ccSearch || cc.cost_centre_name.toLowerCase().includes(ccSearch.toLowerCase()) || cc.cost_centre_code.toLowerCase().includes(ccSearch.toLowerCase())
    ), [costCentres, ccSearch]);

  const ccByBranch = useMemo(() => {
    const map = new Map<string, CostCentre[]>();
    for (const cc of filteredCostCentres) {
      const key = cc.branch_id ?? "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(cc);
    }
    return map;
  }, [filteredCostCentres]);

  const filteredDesignations = useMemo(() =>
    designations.filter((d) =>
      !desSearch || d.designation_name.toLowerCase().includes(desSearch.toLowerCase())
    ), [designations, desSearch]);

  const createMutation = useMutation({
    mutationFn: (body: object) => hrmsApi.post("/api/payroll/holiday-master", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["holiday-master"] }); setEditOpen(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => hrmsApi.put(`/api/payroll/holiday-master/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["holiday-master"] }); setEditOpen(false); },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.patch(`/api/payroll/holiday-master/${id}/toggle`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holiday-master"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/payroll/holiday-master/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holiday-master"] }),
  });

  const ccMutation = useMutation({
    mutationFn: (body: object) => hrmsApi.post("/api/payroll/holiday-master/cc-mapping", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["holiday-master"] }); setCcRow(null); },
  });

  const desMutation = useMutation({
    mutationFn: (body: object) => hrmsApi.post("/api/payroll/holiday-master/designation-mapping", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["holiday-master"] }); setDesRow(null); },
  });

  const ALLOWED_ROLES = ["super_admin", "admin", "payroll_head", "payroll_branch"];
  if (!roleKeys.some(r => ALLOWED_ROLES.includes(r))) {
    return <DashboardLayout><div className="p-8 text-red-600">Access denied.</div></DashboardLayout>;
  }

  const openCreate = () => {
    setEditTarget(null);
    setForm({ ...emptyForm });
    setEditOpen(true);
  };

  const openEdit = (h: Holiday) => {
    setEditTarget(h);
    setForm({
      holiday_name: h.holiday_name,
      holiday_date: h.holiday_date?.slice(0, 10) ?? "",
      holiday_type: h.holiday_type,
      branch_id: h.branch_id ?? "",
      active_status: h.active_status,
    });
    setEditOpen(true);
  };

  const submitForm = () => {
    const body = {
      holiday_name: form.holiday_name,
      holiday_date: form.holiday_date,
      holiday_type: form.holiday_type,
      branch_id: form.branch_id || null,
      active_status: form.active_status,
    };
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const openCcDialog = (h: Holiday) => {
    setCcRow(h);
    setCcSelected(new Set(Array.isArray(h.cost_centre_ids) ? h.cost_centre_ids.filter(Boolean) : []));
    setCcSearch("");
  };

  const openDesDialog = (h: Holiday) => {
    setDesRow(h);
    setDesSelected(new Set(Array.isArray(h.designation_ids) ? h.designation_ids.filter(Boolean) : []));
    setDesSearch("");
  };

  const handleDelete = (h: Holiday) => {
    if (!window.confirm(`Delete holiday "${h.holiday_name}" on ${h.holiday_date?.slice(0, 10)}? This cannot be undone.`)) return;
    deleteMutation.mutate(h.id);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Holiday Master</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Manage the company holiday calendar and scope rules for payroll eligibility.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Input
              type="number"
              className="w-24 h-8 text-sm"
              placeholder="Year"
              value={yearFilter}
              onChange={e => setYearFilter(e.target.value)}
            />
            <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
            <Button onClick={openCreate} size="sm">+ Add Holiday</Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Date", "Name", "Type", "Branch", "Status", "CC Mappings", "Designations", "Actions"].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
                  )}
                  {!isLoading && (holidays as Holiday[]).map((h) => (
                    <tr key={h.id} className={`border-b hover:bg-muted/20 ${!h.active_status ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2 whitespace-nowrap">{h.holiday_date?.slice(0, 10)}</td>
                      <td className="px-4 py-2 font-medium">{h.holiday_name}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE[h.holiday_type] ?? "bg-gray-100 text-gray-600"}`}>
                          {h.holiday_type?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {h.branch_id ? (branchMap.get(h.branch_id) ?? h.branch_id) : "All"}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => toggleMutation.mutate(h.id)}
                          disabled={toggleMutation.isPending}
                          className="focus:outline-none"
                          title={h.active_status ? "Click to deactivate" : "Click to activate"}
                        >
                          <Badge variant={h.active_status ? "default" : "secondary"}>
                            {h.active_status ? "Active" : "Inactive"}
                          </Badge>
                        </button>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {Array.isArray(h.cost_centre_ids) && h.cost_centre_ids.filter(Boolean).length > 0
                          ? <span className="font-medium text-blue-700">{h.cost_centre_ids.filter(Boolean).length} mapped</span>
                          : <span className="text-muted-foreground/60">All</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {Array.isArray(h.designation_ids) && h.designation_ids.filter(Boolean).length > 0
                          ? <span className="font-medium text-blue-700">{h.designation_ids.filter(Boolean).length} mapped</span>
                          : <span className="text-muted-foreground/60">All</span>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => openEdit(h)}>Edit</Button>
                          <Button size="sm" variant="outline" onClick={() => openCcDialog(h)}>CC Scope</Button>
                          <Button size="sm" variant="outline" onClick={() => openDesDialog(h)}>Designations</Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 border-red-300 hover:bg-red-50"
                            disabled={deleteMutation.isPending}
                            onClick={() => handleDelete(h)}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!isLoading && (holidays as Holiday[]).length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No holidays found. Click "Add Holiday" to create one.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Create / Edit Dialog */}
        <Dialog open={editOpen} onOpenChange={open => !open && setEditOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editTarget ? "Edit Holiday" : "Add Holiday"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Holiday Name <span className="text-red-500">*</span></label>
                <Input
                  placeholder="e.g. Republic Day"
                  value={form.holiday_name}
                  onChange={e => setForm(p => ({ ...p, holiday_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Holiday Date <span className="text-red-500">*</span></label>
                <Input
                  type="date"
                  value={form.holiday_date}
                  onChange={e => setForm(p => ({ ...p, holiday_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Type <span className="text-red-500">*</span></label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={form.holiday_type}
                  onChange={e => setForm(p => ({ ...p, holiday_type: e.target.value }))}
                >
                  {HOLIDAY_TYPES.map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Branch <span className="text-xs text-muted-foreground">(leave blank for all branches)</span></label>
                <Select value={form.branch_id || "__all__"} onValueChange={v => setForm(p => ({ ...p, branch_id: v === "__all__" ? "" : v }))}>
                  <SelectTrigger className="w-full text-sm">
                    <SelectValue placeholder="All branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All branches</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.active_status}
                  onChange={e => setForm(p => ({ ...p, active_status: e.target.checked ? 1 : 0 }))}
                />
                Active
              </label>
              {(createMutation.isError || updateMutation.isError) && (
                <p className="text-xs text-red-600">{(createMutation.error as any)?.message ?? (updateMutation.error as any)?.message ?? "Save failed"}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                disabled={isSaving || !form.holiday_name || !form.holiday_date || !form.holiday_type}
                onClick={submitForm}
              >
                {isSaving ? "Saving…" : editTarget ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CC Scope Mapping Dialog */}
        <Dialog open={ccRow !== null} onOpenChange={open => !open && setCcRow(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Cost Centre Scope — {ccRow?.holiday_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground">
                Select cost centres this holiday applies to. Leave all unchecked to apply to everyone.
              </p>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 h-8 text-sm"
                  placeholder="Search cost centres…"
                  value={ccSearch}
                  onChange={e => setCcSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm" variant="outline" className="text-xs h-7"
                  onClick={() => setCcSelected(new Set(costCentres.map(c => c.id)))}
                >Select all</Button>
                <Button
                  size="sm" variant="outline" className="text-xs h-7"
                  onClick={() => setCcSelected(new Set())}
                >Clear all</Button>
                <span className="ml-auto text-xs text-muted-foreground self-center">{ccSelected.size} selected</span>
              </div>
              <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                {Array.from(ccByBranch.entries()).map(([branchId, ccs]) => (
                  <div key={branchId}>
                    <div className="px-3 py-1.5 bg-muted/50 text-xs font-semibold text-muted-foreground sticky top-0">
                      {branchId === "__none__" ? "No branch" : (branchMap.get(branchId) ?? branchId)}
                    </div>
                    {ccs.map(cc => (
                      <label key={cc.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={ccSelected.has(cc.id)}
                          onChange={e => {
                            const next = new Set(ccSelected);
                            e.target.checked ? next.add(cc.id) : next.delete(cc.id);
                            setCcSelected(next);
                          }}
                        />
                        <span>{cc.cost_centre_name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{cc.cost_centre_code}</span>
                      </label>
                    ))}
                  </div>
                ))}
                {filteredCostCentres.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">No cost centres found</div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCcRow(null)}>Cancel</Button>
              <Button
                disabled={ccMutation.isPending}
                onClick={() => ccMutation.mutate({ holiday_id: ccRow!.id, cost_centre_ids: Array.from(ccSelected) })}
              >
                {ccMutation.isPending ? "Saving…" : "Save Mapping"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Designation Mapping Dialog */}
        <Dialog open={desRow !== null} onOpenChange={open => !open && setDesRow(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Designation Scope — {desRow?.holiday_name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground">
                Select designations this holiday applies to. Leave all unchecked to apply to all designations.
              </p>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 h-8 text-sm"
                  placeholder="Search designations…"
                  value={desSearch}
                  onChange={e => setDesSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm" variant="outline" className="text-xs h-7"
                  onClick={() => setDesSelected(new Set(designations.map(d => d.id)))}
                >Select all</Button>
                <Button
                  size="sm" variant="outline" className="text-xs h-7"
                  onClick={() => setDesSelected(new Set())}
                >Clear all</Button>
                <span className="ml-auto text-xs text-muted-foreground self-center">{desSelected.size} selected</span>
              </div>
              <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                {filteredDesignations.map(d => (
                  <label key={d.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={desSelected.has(d.id)}
                      onChange={e => {
                        const next = new Set(desSelected);
                        e.target.checked ? next.add(d.id) : next.delete(d.id);
                        setDesSelected(next);
                      }}
                    />
                    <span>{d.designation_name}</span>
                  </label>
                ))}
                {filteredDesignations.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">No designations found</div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDesRow(null)}>Cancel</Button>
              <Button
                disabled={desMutation.isPending}
                onClick={() => desMutation.mutate({ holiday_id: desRow!.id, designation_ids: Array.from(desSelected) })}
              >
                {desMutation.isPending ? "Saving…" : "Save Designations"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
