import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, RefreshCw, Plus, Trash2, Check, X,
  ChevronDown, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RbacMismatch {
  user_id: string;
  mysql_roles: string[];
  in_mysql_only: string[];
}

interface CatalogRole {
  role_key: string;
  role_name: string;
}

interface PageCatalogEntry {
  page_code: string;
  page_name: string;
  module: string | null;
}

interface RolePageRow {
  role_key: string;
  page_code: string;
  page_name: string | null;
  module: string | null;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

interface DesignationRoleRow {
  id: string;
  designation_id: string;
  designation_name: string | null;
  role_key: string;
}

interface DesignationOption {
  id: string;
  designation_name: string;
}

interface AccessRequestRow {
  id: string;
  user_id: string;
  user_email: string | null;
  page_code: string;
  page_name: string | null;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  reviewer_email: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

type Tab = "module" | "page" | "rbac" | "desig" | "requests";

const PERMS = ["can_view", "can_create", "can_edit", "can_delete", "can_export"] as const;
type PermKey = (typeof PERMS)[number];
const PERM_LABELS: Record<PermKey, string> = {
  can_view: "View", can_create: "Create", can_edit: "Edit", can_delete: "Delete", can_export: "Export",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function UnifiedAccessControl() {
  const [activeTab, setActiveTab] = useState<Tab>("page");
  const queryClient = useQueryClient();

  // ── Shared catalog data ────────────────────────────────────────────────────

  const { data: catalogRoles = [] } = useQuery<CatalogRole[]>({
    queryKey: ["role-catalog"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: CatalogRole[] }>("/api/access/roles/catalog");
      return res.data ?? [];
    },
  });

  const { data: pageCatalog = [] } = useQuery<PageCatalogEntry[]>({
    queryKey: ["page-catalog"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PageCatalogEntry[] }>("/api/access/pages/catalog");
      return res.data ?? [];
    },
  });

  // ── Page Access tab state ─────────────────────────────────────────────────

  const [selectedRole, setSelectedRole] = useState<string>("");
  // local edits: page_code → partial perm overrides
  const [pendingEdits, setPendingEdits] = useState<Record<string, Partial<Record<PermKey, boolean>>>>({});

  const { data: rolePageAccess = [], isLoading: rpaLoading, refetch: refetchRpa } = useQuery<RolePageRow[]>({
    queryKey: ["role-page-access", selectedRole],
    queryFn: async () => {
      if (!selectedRole) return [];
      const res = await hrmsApi.get<{ success: boolean; data: RolePageRow[] }>(
        `/api/access/role-page-access/${encodeURIComponent(selectedRole)}`
      );
      return res.data ?? [];
    },
    enabled: !!selectedRole,
  });

  const upsertRolePageMutation = useMutation({
    mutationFn: async ({ page_code, permissions }: { page_code: string; permissions: Record<PermKey, boolean> }) => {
      await hrmsApi.put("/api/access/role-page-access", {
        role_key: selectedRole, page_code, permissions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-page-access", selectedRole] });
      toast.success("Page permissions saved");
    },
    onError: () => toast.error("Failed to save permissions"),
  });

  const deleteRolePageMutation = useMutation({
    mutationFn: async (pageCode: string) => {
      await hrmsApi.delete(
        `/api/access/role-page-access/${encodeURIComponent(selectedRole)}/${encodeURIComponent(pageCode)}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-page-access", selectedRole] });
      toast.success("Permission removed");
    },
    onError: () => toast.error("Failed to remove permission"),
  });

  // Build merged view: all pages in catalog, with current permissions overlaid
  const existingMap = new Map(rolePageAccess.map((r) => [r.page_code, r]));
  const mergedRows: (RolePageRow & { isGranted: boolean })[] = pageCatalog.map((p) => {
    const existing = existingMap.get(p.page_code);
    return {
      role_key: selectedRole,
      page_code: p.page_code,
      page_name: p.page_name,
      module: p.module,
      can_view: existing?.can_view ?? false,
      can_create: existing?.can_create ?? false,
      can_edit: existing?.can_edit ?? false,
      can_delete: existing?.can_delete ?? false,
      can_export: existing?.can_export ?? false,
      isGranted: !!existing,
    };
  });

  function getEffectivePerm(row: typeof mergedRows[0], key: PermKey): boolean {
    return pendingEdits[row.page_code]?.[key] ?? row[key];
  }

  function togglePerm(pageCode: string, key: PermKey, currentVal: boolean) {
    setPendingEdits((prev) => ({
      ...prev,
      [pageCode]: { ...(prev[pageCode] ?? {}), [key]: !currentVal },
    }));
  }

  function savePageEdits(row: typeof mergedRows[0]) {
    const permissions = Object.fromEntries(
      PERMS.map((k) => [k, getEffectivePerm(row, k)])
    ) as Record<PermKey, boolean>;
    upsertRolePageMutation.mutate({ page_code: row.page_code, permissions });
    setPendingEdits((prev) => { const n = { ...prev }; delete n[row.page_code]; return n; });
  }

  // ── RBAC Sync tab ─────────────────────────────────────────────────────────

  const { data: rbacMismatches = [], isLoading: rbacLoading, refetch: refetchRbac } = useQuery<RbacMismatch[]>({
    queryKey: ["rbac-reconciliation"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: RbacMismatch[] }>("/api/access/rbac-reconciliation");
      return res.data ?? [];
    },
    enabled: activeTab === "rbac",
  });

  const assignRoleMutation = useMutation({
    mutationFn: async (userId: string) =>
      hrmsApi.post("/api/access/roles/assign", { user_id: userId, role_key: "employee" }),
    onSuccess: () => {
      toast.success("Role assigned");
      queryClient.invalidateQueries({ queryKey: ["rbac-reconciliation"] });
    },
    onError: () => toast.error("Failed to assign role"),
  });

  // ── Designation Roles tab ─────────────────────────────────────────────────

  const { data: desigRoleMap = [], isLoading: desigLoading } = useQuery<DesignationRoleRow[]>({
    queryKey: ["designation-role-map"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: DesignationRoleRow[] }>("/api/access/designation-role-map");
      return res.data ?? [];
    },
    enabled: activeTab === "desig",
  });

  const { data: designations = [] } = useQuery<DesignationOption[]>({
    queryKey: ["designation-options"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: DesignationOption[] }>("/api/org/designations");
      return res.data ?? [];
    },
    enabled: activeTab === "desig",
  });

  const [addDesigOpen, setAddDesigOpen] = useState(false);
  const [newDesigId, setNewDesigId] = useState("");
  const [newDesigRole, setNewDesigRole] = useState("");

  const addDesigMutation = useMutation({
    mutationFn: async () => {
      await hrmsApi.post("/api/access/designation-role-map", {
        designation_id: newDesigId, role_key: newDesigRole,
      });
    },
    onSuccess: () => {
      toast.success("Mapping added");
      queryClient.invalidateQueries({ queryKey: ["designation-role-map"] });
      setAddDesigOpen(false);
      setNewDesigId(""); setNewDesigRole("");
    },
    onError: () => toast.error("Failed to add mapping"),
  });

  const deleteDesigMutation = useMutation({
    mutationFn: async (id: string) => hrmsApi.delete(`/api/access/designation-role-map/${id}`),
    onSuccess: () => {
      toast.success("Mapping removed");
      queryClient.invalidateQueries({ queryKey: ["designation-role-map"] });
    },
    onError: () => toast.error("Failed to remove mapping"),
  });

  // ── Access Requests tab ───────────────────────────────────────────────────

  const [requestStatus, setRequestStatus] = useState<"pending" | "approved" | "denied">("pending");

  const { data: accessRequests = [], isLoading: arLoading } = useQuery<AccessRequestRow[]>({
    queryKey: ["access-requests", requestStatus],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: AccessRequestRow[] }>(
        `/api/access/access-requests?status=${requestStatus}`
      );
      return res.data ?? [];
    },
    enabled: activeTab === "requests",
  });

  const [denyOpen, setDenyOpen] = useState(false);
  const [denyRequestId, setDenyRequestId] = useState("");
  const [denyReason, setDenyReason] = useState("");

  const approveMutation = useMutation({
    mutationFn: async (id: string) => hrmsApi.post(`/api/access/access-requests/${id}/approve`),
    onSuccess: () => {
      toast.success("Access request approved");
      queryClient.invalidateQueries({ queryKey: ["access-requests"] });
    },
    onError: () => toast.error("Failed to approve request"),
  });

  const denyMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      hrmsApi.post(`/api/access/access-requests/${id}/deny`, { reason }),
    onSuccess: () => {
      toast.success("Access request denied");
      queryClient.invalidateQueries({ queryKey: ["access-requests"] });
      setDenyOpen(false);
      setDenyReason("");
    },
    onError: () => toast.error("Failed to deny request"),
  });

  // ── Tab definitions ────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string }[] = [
    { key: "module",   label: "Module Access" },
    { key: "page",     label: "Page Access" },
    { key: "rbac",     label: "RBAC Sync" },
    { key: "desig",    label: "Designation Roles" },
    { key: "requests", label: "Access Requests" },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-100 p-3"><Shield className="h-5 w-5" /></div>
            <div>
              <h1 className="text-3xl font-bold text-slate-950">Unified Access Control</h1>
              <p className="text-sm text-slate-600">
                Manage role-page permissions, designation auto-assignments, and access requests.
              </p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab.key
                  ? "border-b-2 border-slate-950 text-slate-950"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Module Access (read-only placeholder) ─────────────────────────── */}
        {activeTab === "module" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Role Module Access</h2>
            <p className="mt-1 text-xs text-slate-500">
              Module-level access is managed via role_module_access. No data yet — page access is the
              primary access control layer in this build.
            </p>
          </div>
        )}

        {/* ── Page Access (editable matrix) ─────────────────────────────────── */}
        {activeTab === "page" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold">Role → Page Permissions</h2>
              <div className="w-56">
                <Select value={selectedRole} onValueChange={(v) => { setSelectedRole(v); setPendingEdits({}); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role…" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogRoles.map((r) => (
                      <SelectItem key={r.role_key} value={r.role_key}>{r.role_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {!selectedRole ? (
              <p className="mt-8 text-center text-sm text-slate-500">Select a role to view and edit its page permissions.</p>
            ) : rpaLoading ? (
              <div className="mt-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : (
              <div className="mt-4 overflow-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Page</th>
                      <th className="px-4 py-3">Module</th>
                      {PERMS.map((k) => (
                        <th key={k} className="px-3 py-3 text-center">{PERM_LABELS[k]}</th>
                      ))}
                      <th className="px-3 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mergedRows.map((row) => {
                      const isDirty = !!pendingEdits[row.page_code];
                      return (
                        <tr key={row.page_code} className={`border-t ${isDirty ? "bg-amber-50" : ""}`}>
                          <td className="px-4 py-2 font-mono text-xs text-slate-700">{row.page_code}</td>
                          <td className="px-4 py-2 text-xs text-slate-500">{row.module ?? "—"}</td>
                          {PERMS.map((k) => (
                            <td key={k} className="px-3 py-2 text-center">
                              <Checkbox
                                checked={getEffectivePerm(row, k)}
                                onCheckedChange={() => togglePerm(row.page_code, k, getEffectivePerm(row, k))}
                              />
                            </td>
                          ))}
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {isDirty && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => savePageEdits(row)}
                                  disabled={upsertRolePageMutation.isPending}
                                >
                                  Save
                                </Button>
                              )}
                              {row.isGranted && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-rose-600 hover:text-rose-700"
                                  onClick={() => deleteRolePageMutation.mutate(row.page_code)}
                                  disabled={deleteRolePageMutation.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── RBAC Sync ────────────────────────────────────────────────────── */}
        {activeTab === "rbac" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">RBAC Sync</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Users whose roles differ from expected MySQL assignments.
                </p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => refetchRbac()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>

            {rbacLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : rbacMismatches.length === 0 ? (
              <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                No mismatches found — all roles are properly assigned in MySQL.
              </p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-2 pr-4">User ID</th>
                      <th className="pr-4">MySQL Roles</th>
                      <th className="pr-4">MySQL Only</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rbacMismatches.map((row, i) => (
                      <tr key={i} className="border-t align-top">
                        <td className="py-2 pr-4 font-mono text-xs text-slate-700">{row.user_id}</td>
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {row.mysql_roles.map((r) => (
                              <Badge key={r} className="bg-sky-50 text-sky-700 hover:bg-sky-50">{r}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {row.in_mysql_only.map((r) => (
                              <Badge key={r} className="bg-rose-50 text-rose-700 hover:bg-rose-50">{r}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-2">
                          {row.in_mysql_only.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={assignRoleMutation.isPending}
                              onClick={() => assignRoleMutation.mutate(row.user_id)}
                            >
                              Assign Role
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Designation Roles ─────────────────────────────────────────────── */}
        {activeTab === "desig" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Designation → Role Auto-Assignment</h2>
                <p className="mt-1 text-xs text-slate-500">
                  When an employee's designation changes, the mapped roles are automatically added
                  (additive only, never removed).
                </p>
              </div>
              <Button size="sm" className="gap-2" onClick={() => setAddDesigOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Mapping
              </Button>
            </div>

            {desigLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : desigRoleMap.length === 0 ? (
              <p className="text-sm text-slate-500">No designation-role mappings configured yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-6">Designation</th>
                    <th className="pr-6">Assigned Role</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {desigRoleMap.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="py-2 pr-6">{row.designation_name ?? row.designation_id}</td>
                      <td className="pr-6">
                        <Badge variant="secondary">{row.role_key}</Badge>
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-rose-600 hover:text-rose-700"
                          onClick={() => deleteDesigMutation.mutate(row.id)}
                          disabled={deleteDesigMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Add Mapping dialog */}
            <Dialog open={addDesigOpen} onOpenChange={setAddDesigOpen}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Add Designation → Role Mapping</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-1">
                    <Label>Designation</Label>
                    <Select value={newDesigId} onValueChange={setNewDesigId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select designation…" />
                      </SelectTrigger>
                      <SelectContent>
                        {designations.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.designation_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Role to Auto-Assign</Label>
                    <Select value={newDesigRole} onValueChange={setNewDesigRole}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role…" />
                      </SelectTrigger>
                      <SelectContent>
                        {catalogRoles.map((r) => (
                          <SelectItem key={r.role_key} value={r.role_key}>{r.role_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setAddDesigOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => addDesigMutation.mutate()}
                    disabled={!newDesigId || !newDesigRole || addDesigMutation.isPending}
                  >
                    {addDesigMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Add
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ── Access Requests ───────────────────────────────────────────────── */}
        {activeTab === "requests" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Employee Access Requests</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Review and approve or deny requests from employees for additional page access.
                </p>
              </div>
              <div className="flex gap-2">
                {(["pending", "approved", "denied"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setRequestStatus(s)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                      requestStatus === s
                        ? s === "pending" ? "bg-amber-100 text-amber-800"
                          : s === "approved" ? "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-800"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {arLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : accessRequests.length === 0 ? (
              <p className="text-sm text-slate-500">No {requestStatus} access requests.</p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-4">User</th>
                      <th className="pr-4">Page</th>
                      <th className="pr-4">Reason</th>
                      <th className="pr-4">Requested</th>
                      {requestStatus === "pending" && <th>Actions</th>}
                      {requestStatus !== "pending" && <th>Review</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {accessRequests.map((req) => (
                      <tr key={req.id} className="border-t align-top">
                        <td className="py-2 pr-4 text-xs text-slate-700">{req.user_email ?? req.user_id}</td>
                        <td className="py-2 pr-4">
                          <div className="font-mono text-xs">{req.page_code}</div>
                          {req.page_name && <div className="text-xs text-slate-500">{req.page_name}</div>}
                        </td>
                        <td className="py-2 pr-4 max-w-[200px] text-xs text-slate-600">
                          {req.reason ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-xs text-slate-500">
                          {new Date(req.created_at).toLocaleDateString()}
                        </td>
                        {requestStatus === "pending" && (
                          <td className="py-2">
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 border-emerald-300 px-2 text-xs text-emerald-700 hover:bg-emerald-50"
                                disabled={approveMutation.isPending}
                                onClick={() => approveMutation.mutate(req.id)}
                              >
                                <Check className="h-3 w-3" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 border-rose-300 px-2 text-xs text-rose-700 hover:bg-rose-50"
                                onClick={() => { setDenyRequestId(req.id); setDenyOpen(true); }}
                              >
                                <X className="h-3 w-3" />
                                Deny
                              </Button>
                            </div>
                          </td>
                        )}
                        {requestStatus !== "pending" && (
                          <td className="py-2 text-xs text-slate-500">
                            {req.reviewer_email && <div>{req.reviewer_email}</div>}
                            {req.review_note && <div className="mt-0.5 italic">{req.review_note}</div>}
                            {req.reviewed_at && <div className="mt-0.5">{new Date(req.reviewed_at).toLocaleDateString()}</div>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Deny dialog */}
      <Dialog open={denyOpen} onOpenChange={setDenyOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deny Access Request</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Provide a reason for denying this request (shown to the employee).
          </p>
          <Textarea
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder="Reason for denial…"
            rows={3}
            className="mt-2"
          />
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setDenyOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => denyMutation.mutate({ id: denyRequestId, reason: denyReason })}
              disabled={denyMutation.isPending}
            >
              {denyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Deny
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
