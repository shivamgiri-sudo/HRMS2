// src/pages/wfm/attendance-integrity/BillingRulesPanel.tsx
// Finance Head + Super Admin UI for attendance billing config.
// Controls whether extra billing (beyond calendar month days) is allowed,
// with scope granularity: global > process > branch > designation > employee.
// Most-specific-wins precedence. All changes require a reason and are audited.
//
// Panel, not a page: extracted from NativeAttendanceBillingConfig.tsx for the merged
// attendance-integrity console (Task 3). Fix 3c: the source page never imported
// useWorkforceAccess, so New Rule / Edit rendered for hr, wfm and admin and Deactivate
// rendered for finance_head — all wider than what the API (billing-config.routes.ts)
// actually accepts (POST/PATCH: finance_head, super_admin; DELETE: super_admin only).
//
// Review fix (2026-08-27): role_page_access grants `admin` can_edit=1 on this page code,
// so `canEditPage("ATTENDANCE_BILLING_CONFIG")` alone still said yes for admin — a role
// the API refuses on every write route. canEditPage is a straight read of that grant row
// and correcting it is a separate migration, out of scope here. Instead the page-level
// grant is intersected with the API's real per-route role lists, read directly off the
// `requireRole(...)` calls in billing-config.routes.ts:
//   - POST / and PATCH /:id (create/update): finance_head, super_admin
//   - DELETE /:id (deactivate): super_admin only
// `hasAnyRole` (not `primaryRole`) is used for the role check because a user can hold
// multiple roles at once; `primaryRole` collapses that to a single highest-priority role
// and would wrongly deny a user whose primary role isn't the granting one (e.g. someone
// whose primaryRole resolves to `hr` but who also holds `finance_head`).

import React, { useState, useEffect, useCallback } from "react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, RefreshCw, Info, AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

type ScopeType = "global" | "process" | "branch" | "designation" | "employee";

type BillingConfigEntry = {
  id: string;
  scope_type: ScopeType;
  process_id: string | null;
  branch_id: string | null;
  designation_id: string | null;
  employee_id: string | null;
  extra_day_salary_allowed: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  change_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Joined
  process_name?: string;
  branch_name?: string;
  designation_name?: string;
  employee_name?: string;
  employee_code?: string;
};

type OrgMaster = {
  designations?: { id: string; designation_name: string }[];
  branches?: { id: string; branch_name: string }[];
};

type Process = { id: string; process_name: string };
type Employee = { id: string; first_name: string; last_name?: string; employee_code: string };

const SCOPE_LABELS: Record<ScopeType, string> = {
  global: "Global Default",
  process: "Process",
  branch: "Branch",
  designation: "Designation",
  employee: "Individual Employee",
};

const SCOPE_ORDER: ScopeType[] = ["employee", "designation", "branch", "process", "global"];

function scopeBadge(scope: ScopeType) {
  const colors: Record<ScopeType, string> = {
    global:      "bg-slate-100 text-slate-700",
    process:     "bg-blue-50 text-blue-700",
    branch:      "bg-teal-50 text-teal-700",
    designation: "bg-violet-50 text-violet-700",
    employee:    "bg-amber-50 text-amber-800",
  };
  return <Badge className={colors[scope]}>{SCOPE_LABELS[scope]}</Badge>;
}

function targetLabel(entry: BillingConfigEntry): string {
  if (entry.scope_type === "employee")    return `${entry.employee_name ?? "—"} (${entry.employee_code ?? ""})`;
  if (entry.scope_type === "designation") return entry.designation_name ?? "—";
  if (entry.scope_type === "branch")      return entry.branch_name ?? "—";
  if (entry.scope_type === "process")     return entry.process_name ?? "—";
  return "All";
}

const EMPTY_FORM = {
  scope_type: "" as ScopeType | "",
  process_id: "",
  branch_id: "",
  designation_id: "",
  employee_search: "",
  employee_id: "",
  extra_day_salary_allowed: true,
  effective_from: new Date().toISOString().slice(0, 10),
  effective_to: "",
  change_reason: "",
};

export default function BillingRulesPanel() {
  const { toast } = useToast();
  const { isResolved, canEditPage, hasAnyRole } = useWorkforceAccess();
  // 3c: the write surface (Add Rule / Edit / Deactivate) is narrower than view access.
  // `canEditPage` returns false for every code until `isResolved` is true, so gating on
  // `isResolved && canEditPage(...)` avoids flickering the controls on for a frame before
  // the role data lands, matching the same caveat ExceptionsPanel/MismatchesPanel don't
  // need but this panel's write controls do.
  //
  // canEditPage alone is not enough: the page grant (role_page_access) is stale for
  // `admin`, so it must be intersected with the API's real per-route roles (see the
  // file-header comment). Two capabilities because the API itself distinguishes them.
  const canWrite = isResolved && canEditPage("ATTENDANCE_BILLING_CONFIG");
  const canCreateOrEdit = canWrite && hasAnyRole("finance_head", "super_admin");
  const canDeactivate = canWrite && hasAnyRole("super_admin");

  const [entries, setEntries] = useState<BillingConfigEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null);

  const [processes, setProcesses] = useState<Process[]>([]);
  const [org, setOrg] = useState<OrgMaster>({});
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: BillingConfigEntry[] }>("/api/attendance/billing-config");
      if (res.success) setEntries(res.data ?? []);
    } catch (err) {
      // Constraint 4/8: distinguish 403 (role can open the tab but the API refuses the
      // data) from any other failure — the source page's bare catch collapsed both into
      // the same toast with no on-page state change.
      setError({
        status: getHrmsApiErrorStatus(err),
        message: err instanceof Error ? err.message : "Failed to load billing config",
      });
      setEntries([]);
      toast({ title: "Failed to load billing config", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const isForbidden = error?.status === 403;

  const loadMasters = useCallback(async () => {
    try {
      const [orgRes, procRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: OrgMaster }>("/api/org"),
        hrmsApi.get<{ success: boolean; data: Process[] }>("/api/processes"),
      ]);
      if (orgRes.success) setOrg(orgRes.data ?? {});
      if (procRes.success) setProcesses(procRes.data ?? []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { load(); loadMasters(); }, [load, loadMasters]);

  async function searchEmployees(q: string) {
    if (!q || q.length < 2) { setEmployees([]); return; }
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Employee[] }>(`/api/employees?search=${encodeURIComponent(q)}&limit=20`);
      if (res.success) setEmployees(res.data ?? []);
    } catch { /* no-op */ }
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, effective_from: new Date().toISOString().slice(0, 10) });
    setDialogOpen(true);
  }

  function openEdit(entry: BillingConfigEntry) {
    setEditingId(entry.id);
    setForm({
      scope_type: entry.scope_type,
      process_id: entry.process_id ?? "",
      branch_id: entry.branch_id ?? "",
      designation_id: entry.designation_id ?? "",
      employee_search: entry.employee_name ?? "",
      employee_id: entry.employee_id ?? "",
      extra_day_salary_allowed: Boolean(entry.extra_day_salary_allowed),
      effective_from: entry.effective_from?.slice(0, 10) ?? "",
      effective_to: entry.effective_to?.slice(0, 10) ?? "",
      change_reason: "",
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!form.scope_type) return toast({ title: "Scope type is required", variant: "destructive" });
    if (!form.change_reason.trim()) return toast({ title: "Change reason is required", variant: "destructive" });
    if (!form.effective_from) return toast({ title: "Effective from date is required", variant: "destructive" });

    const payload = {
      scope_type: form.scope_type,
      process_id: form.scope_type === "process" ? form.process_id || undefined : undefined,
      branch_id: form.scope_type === "branch" ? form.branch_id || undefined : undefined,
      designation_id: form.scope_type === "designation" ? form.designation_id || undefined : undefined,
      employee_id: form.scope_type === "employee" ? form.employee_id || undefined : undefined,
      extra_day_salary_allowed: form.extra_day_salary_allowed ? 1 : 0,
      effective_from: form.effective_from,
      effective_to: form.effective_to || undefined,
      change_reason: form.change_reason,
    };

    setSubmitting(true);
    try {
      if (editingId) {
        const res = await hrmsApi.patch<{ success: boolean; message?: string }>(`/api/attendance/billing-config/${editingId}`, payload);
        if (!res.success) throw new Error(res.message ?? "Update failed");
        toast({ title: "Billing config updated" });
      } else {
        const res = await hrmsApi.post<{ success: boolean; message?: string }>("/api/attendance/billing-config", payload);
        if (!res.success) throw new Error(res.message ?? "Create failed");
        toast({ title: "Billing config created" });
      }
      setDialogOpen(false);
      load();
    } catch (e: any) {
      toast({ title: e?.message ?? "Error saving config", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate() {
    if (!deactivateId || !deactivateReason.trim()) return;
    try {
      const res = await hrmsApi.patch<{ success: boolean; message?: string }>(
        `/api/attendance/billing-config/${deactivateId}`,
        { active_status: 0, change_reason: deactivateReason }
      );
      if (!res.success) throw new Error(res.message ?? "Deactivate failed");
      toast({ title: "Config entry deactivated" });
      setDeactivateId(null);
      setDeactivateReason("");
      load();
    } catch (e: any) {
      toast({ title: e?.message ?? "Error deactivating", variant: "destructive" });
    }
  }

  const visible = entries.filter(e => showInactive ? true : e.active_status === 1);

  // Group by scope for hierarchy display
  const grouped = SCOPE_ORDER.reduce<Record<ScopeType, BillingConfigEntry[]>>((acc, s) => {
    acc[s] = visible.filter(e => e.scope_type === s);
    return acc;
  }, { global: [], process: [], branch: [], designation: [], employee: [] });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-slate-500 mt-1">
            Configure whether extra billing (beyond calendar month days) is allowed per process, branch, designation or employee.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
          {/* 3c: New Rule is a write action — only render it for a role the API's
              POST /api/attendance/billing-config actually accepts. */}
          {canCreateOrEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" /> Add Rule
            </Button>
          )}
        </div>
      </div>

      {/* Forbidden — the tab is reachable but the API refuses this role's data. Visually
          distinct from the loading/empty states below: amber card + ShieldAlert. */}
      {isForbidden && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 p-5">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <p className="font-bold text-amber-900">Your role can open this page but not view this data</p>
              <p className="mt-1 text-sm text-amber-800">
                Attendance billing configuration is restricted to Finance Head, Admin, HR,
                WFM and Super Admin roles. Ask your administrator for access if you need it.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Any other error (non-403) */}
      {error && !isForbidden && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 p-4 text-sm font-bold text-red-800">
            <AlertTriangle className="h-4 w-4" />
            {error.message}
          </CardContent>
        </Card>
      )}

      {/* Precedence info banner */}
      {!isForbidden && (
      <Card className="border-blue-100 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800 space-y-1">
              <p className="font-medium">Most-specific rule wins</p>
              <p>Precedence order (highest to lowest): <span className="font-mono">Employee → Designation → Branch → Process → Global</span></p>
              <p>If an employee has a specific rule, it overrides any process/branch/global defaults for that employee.</p>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Show inactive toggle */}
      {!isForbidden && (
      <div className="flex items-center gap-2">
        <Switch checked={showInactive} onCheckedChange={setShowInactive} id="show-inactive" />
        <Label htmlFor="show-inactive" className="text-sm cursor-pointer">Show inactive rules</Label>
      </div>
      )}

      {isForbidden ? null : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center text-slate-500">No billing rules configured.</div>
      ) : (
        <div className="space-y-4">
          {SCOPE_ORDER.map(scope => {
            const group = grouped[scope];
            if (group.length === 0 && scope !== "global") return null;
            return (
              <Card key={scope}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {scopeBadge(scope)}
                    <span className="text-slate-500 font-normal">({group.length} rule{group.length !== 1 ? "s" : ""})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {group.length === 0 ? (
                    <p className="px-4 pb-4 text-sm text-slate-400 italic">No rules at this scope</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Target</TableHead>
                          <TableHead>Extra Billing</TableHead>
                          <TableHead>Effective From</TableHead>
                          <TableHead>Effective To</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Last Change</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.map(entry => (
                          <TableRow key={entry.id} className={entry.active_status === 0 ? "opacity-50" : ""}>
                            <TableCell className="font-medium text-sm">{targetLabel(entry)}</TableCell>
                            <TableCell>
                              {entry.extra_day_salary_allowed ? (
                                <Badge className="bg-emerald-50 text-emerald-700">Allowed</Badge>
                              ) : (
                                <Badge className="bg-rose-50 text-rose-700">Capped to Month</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{entry.effective_from?.slice(0, 10)}</TableCell>
                            <TableCell className="text-sm">{entry.effective_to?.slice(0, 10) ?? "Open-ended"}</TableCell>
                            <TableCell>
                              {entry.active_status ? (
                                <Badge className="bg-emerald-50 text-emerald-700">Active</Badge>
                              ) : (
                                <Badge className="bg-slate-100 text-slate-600">Inactive</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-slate-500 max-w-40 truncate" title={entry.change_reason ?? ""}>
                              {entry.change_reason ?? "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {/* 3c: Edit (PATCH) is gated on canCreateOrEdit (finance_head,
                                    super_admin — matches POST/PATCH). Deactivate (PATCH
                                    active_status=0, but backed by the DELETE-shaped API
                                    contract) is gated separately on canDeactivate
                                    (super_admin only — matches DELETE). */}
                                {entry.active_status === 1 && canCreateOrEdit && (
                                  <Button size="icon" variant="ghost" aria-label="Edit billing rule" onClick={() => openEdit(entry)}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                                {entry.active_status === 1 && entry.scope_type !== "global" && canDeactivate && (
                                  <Button size="icon" variant="ghost" className="text-rose-500 hover:text-rose-700" aria-label="Deactivate billing rule" onClick={() => { setDeactivateId(entry.id); setDeactivateReason(""); }}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Billing Rule" : "Add Billing Rule"}</DialogTitle>
            <DialogDescription>
              All changes are logged for compliance. A reason is mandatory.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Scope type */}
            {!editingId && (
              <div className="space-y-2">
                <Label>Scope *</Label>
                <Select value={form.scope_type} onValueChange={v => setForm(f => ({ ...f, scope_type: v as ScopeType, process_id: "", branch_id: "", designation_id: "", employee_id: "", employee_search: "" }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select scope…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(["process", "branch", "designation", "employee"] as ScopeType[]).map(s => (
                      <SelectItem key={s} value={s}>{SCOPE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Scope-specific entity picker */}
            {form.scope_type === "process" && (
              <div className="space-y-2">
                <Label>Process *</Label>
                <Select value={form.process_id} onValueChange={v => setForm(f => ({ ...f, process_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select process…" /></SelectTrigger>
                  <SelectContent>
                    {processes.map(p => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.scope_type === "branch" && (
              <div className="space-y-2">
                <Label>Branch *</Label>
                <Select value={form.branch_id} onValueChange={v => setForm(f => ({ ...f, branch_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select branch…" /></SelectTrigger>
                  <SelectContent>
                    {(org.branches ?? []).map(b => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.scope_type === "designation" && (
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select value={form.designation_id} onValueChange={v => setForm(f => ({ ...f, designation_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select designation…" /></SelectTrigger>
                  <SelectContent>
                    {(org.designations ?? []).map(d => <SelectItem key={d.id} value={d.id}>{d.designation_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.scope_type === "employee" && (
              <div className="space-y-2">
                <Label>Employee *</Label>
                <Input
                  placeholder="Type name or code to search…"
                  value={form.employee_search}
                  onChange={e => {
                    setForm(f => ({ ...f, employee_search: e.target.value, employee_id: "" }));
                    searchEmployees(e.target.value);
                  }}
                />
                {employees.length > 0 && !form.employee_id && (
                  <div className="border rounded-md shadow-sm max-h-40 overflow-y-auto bg-white">
                    {employees.map(emp => (
                      <button
                        key={emp.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => {
                          setForm(f => ({ ...f, employee_id: emp.id, employee_search: `${emp.first_name} ${emp.last_name ?? ""} (${emp.employee_code})` }));
                          setEmployees([]);
                        }}
                      >
                        {emp.first_name} {emp.last_name ?? ""} — <span className="text-slate-400">{emp.employee_code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Extra billing toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3 bg-slate-50">
              <div>
                <p className="text-sm font-medium">Allow Extra Billing</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  When off, payable days are capped to the calendar month days even if the employee worked more.
                </p>
              </div>
              <Switch
                checked={form.extra_day_salary_allowed}
                onCheckedChange={v => setForm(f => ({ ...f, extra_day_salary_allowed: v }))}
              />
            </div>

            {/* Effective dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Effective From *</Label>
                <Input type="date" value={form.effective_from} onChange={e => setForm(f => ({ ...f, effective_from: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Effective To</Label>
                <Input type="date" value={form.effective_to} onChange={e => setForm(f => ({ ...f, effective_to: e.target.value }))} />
                <p className="text-xs text-slate-400">Leave blank = open-ended</p>
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label>Change Reason *</Label>
              <Textarea
                placeholder="Explain why this rule is being added or changed…"
                value={form.change_reason}
                onChange={e => setForm(f => ({ ...f, change_reason: e.target.value }))}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting || !form.scope_type || !form.change_reason.trim()}>
              {submitting ? "Saving…" : editingId ? "Save Changes" : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirmation */}
      <AlertDialog open={!!deactivateId} onOpenChange={open => { if (!open) { setDeactivateId(null); setDeactivateReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Billing Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This rule will be deactivated and the next most-specific active rule will apply. This action is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <Label>Reason *</Label>
            <Textarea
              className="mt-1"
              placeholder="Why is this rule being deactivated?"
              value={deactivateReason}
              onChange={e => setDeactivateReason(e.target.value)}
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={handleDeactivate}
              disabled={!deactivateReason.trim()}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
