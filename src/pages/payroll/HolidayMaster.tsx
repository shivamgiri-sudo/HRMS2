import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useWorkforceAccess } from "@/hooks/useUserRole";

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

const emptyForm = { holiday_name: "", holiday_date: "", holiday_type: "national", branch_id: "", active_status: 1 };

export default function HolidayMaster() {
  const { roleKeys } = useWorkforceAccess();
  const qc = useQueryClient();

  const [showInactive, setShowInactive] = useState(false);
  const [yearFilter, setYearFilter] = useState("");

  // Create/Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Holiday | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  // CC Mapping dialog
  const [ccRow, setCcRow] = useState<string | null>(null);
  const [ccIds, setCcIds] = useState("");
  const [ccBranch, setCcBranch] = useState("");
  const [ccProcess, setCcProcess] = useState("");
  const [ccDept, setCcDept] = useState("");

  // Designation Mapping dialog
  const [desRow, setDesRow] = useState<string | null>(null);
  const [desInput, setDesInput] = useState("");
  const [desIds, setDesIds] = useState<string[]>([]);

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holiday-master", showInactive, yearFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (showInactive) params.set("includeInactive", "1");
      if (yearFilter) params.set("year", yearFilter);
      return hrmsApi.get<any>(`/api/payroll/holiday-master?${params}`).then((d: any) => Array.isArray(d) ? d : d.data ?? []);
    },
  });

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
    return (
      <DashboardLayout>
        <div className="p-8 text-red-600">Access denied.</div>
      </DashboardLayout>
    );
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
    setCcRow(h.id);
    setCcIds(Array.isArray(h.cost_centre_ids) ? h.cost_centre_ids.join(", ") : "");
    setCcBranch(h.branch_id ?? "");
    setCcProcess("");
    setCcDept("");
  };

  const submitCcMapping = () => {
    const ids = ccIds.split(",").map(s => s.trim()).filter(Boolean);
    ccMutation.mutate({ holiday_id: ccRow, cost_centre_ids: ids, branch_id: ccBranch || null, process_id: ccProcess || null, department_id: ccDept || null });
  };

  const openDesDialog = (h: Holiday) => {
    setDesRow(h.id);
    setDesIds(Array.isArray(h.designation_ids) ? h.designation_ids : []);
    setDesInput("");
  };

  const addDesId = () => {
    const v = desInput.trim();
    if (v && !desIds.includes(v)) setDesIds(p => [...p, v]);
    setDesInput("");
  };

  const submitDesMapping = () => {
    desMutation.mutate({ holiday_id: desRow, designation_ids: desIds });
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
                      <td className="px-4 py-2 text-xs text-muted-foreground">{h.branch_id ?? "All"}</td>
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
                          ? h.cost_centre_ids.filter(Boolean).length + " mapped"
                          : <span className="text-muted-foreground/60">None</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {Array.isArray(h.designation_ids) && h.designation_ids.filter(Boolean).length > 0
                          ? h.designation_ids.filter(Boolean).length + " mapped"
                          : <span className="text-muted-foreground/60">None</span>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => openEdit(h)}>Edit</Button>
                          <Button size="sm" variant="outline" onClick={() => openCcDialog(h)}>CC Scope</Button>
                          <Button size="sm" variant="outline" onClick={() => openDesDialog(h)}>Designations</Button>
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
                <label className="text-sm font-medium">Branch ID <span className="text-xs text-muted-foreground">(leave blank for all branches)</span></label>
                <Input
                  placeholder="Optional branch UUID"
                  value={form.branch_id}
                  onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))}
                />
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
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cost Centre Scope Mapping</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p className="text-muted-foreground text-xs">Define which cost centres this holiday applies to for payroll eligibility. Leave blank to apply to all.</p>
              <div className="space-y-1">
                <label className="font-medium">Cost Centre IDs <span className="text-xs text-muted-foreground">(comma-separated)</span></label>
                <Input
                  placeholder="e.g. cc-uuid-1, cc-uuid-2"
                  value={ccIds}
                  onChange={e => setCcIds(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium">Branch ID <span className="text-xs text-muted-foreground">(optional)</span></label>
                <Input placeholder="Branch UUID" value={ccBranch} onChange={e => setCcBranch(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="font-medium">Process ID <span className="text-xs text-muted-foreground">(optional)</span></label>
                <Input placeholder="Process UUID" value={ccProcess} onChange={e => setCcProcess(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="font-medium">Department ID <span className="text-xs text-muted-foreground">(optional)</span></label>
                <Input placeholder="Department UUID" value={ccDept} onChange={e => setCcDept(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCcRow(null)}>Cancel</Button>
              <Button disabled={ccMutation.isPending} onClick={submitCcMapping}>
                {ccMutation.isPending ? "Saving…" : "Save Mapping"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Designation Mapping Dialog */}
        <Dialog open={desRow !== null} onOpenChange={open => !open && setDesRow(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Designation Mapping</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">Map specific designations that are eligible for this holiday in payroll.</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter designation ID"
                  value={desInput}
                  onChange={e => setDesInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addDesId())}
                />
                <Button type="button" variant="outline" onClick={addDesId}>Add</Button>
              </div>
              {desIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {desIds.map(d => (
                    <Badge key={d} variant="secondary" className="cursor-pointer text-xs" onClick={() => setDesIds(p => p.filter(x => x !== d))}>
                      {d} ×
                    </Badge>
                  ))}
                </div>
              )}
              {desIds.length === 0 && (
                <p className="text-xs text-muted-foreground">No designations added — holiday will apply to all designations.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDesRow(null)}>Cancel</Button>
              <Button disabled={desMutation.isPending} onClick={submitDesMapping}>
                {desMutation.isPending ? "Saving…" : "Save Designations"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
