import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type TabKey = "users" | "permissions" | "admin";
type AccessLevel = "no-access" | "view-only" | "editor" | "creator" | "full-access";
type PermissionKey = "can_view" | "can_create" | "can_edit" | "can_delete" | "can_export";

interface PermissionSet {
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

interface RoleInfo {
  role_key: string;
  role_name: string;
  description?: string;
}

interface UserOption {
  id: string;
  email: string;
  full_name: string;
  employee_code?: string | null;
  roles?: string[];
}

interface UserRole {
  role_key: string;
  role_name: string;
}

interface PageCatalogEntry {
  page_code: string;
  page_name: string;
  page_path?: string;
  module: string | null;
  description?: string | null;
}

interface PagePermission {
  page_code: string;
  page_name: string | null;
  module: string | null;
  permissions: PermissionSet;
}

interface RoleSummary {
  role_key: string;
  role_name: string;
  role_description?: string;
  user_count: number;
  page_count: number;
  modules: Array<{ module_name: string; page_count: number; access_level: AccessLevel }>;
}

interface RbacStatus {
  synced: boolean;
  last_sync: string;
  conflicts_count: number;
  mysql_count?: number;
}

interface AccessRequestRow {
  id: string;
  user_id: string;
  user_email: string | null;
  page_code: string;
  page_name: string | null;
  reason: string | null;
  status: "pending" | "approved" | "denied";
  reviewer_email?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
}

interface ActivityItem {
  id: string;
  action: string;
  description: string;
  created_at: string;
}

const PERMISSIONS: Array<{ key: PermissionKey; label: string }> = [
  { key: "can_view", label: "View" },
  { key: "can_create", label: "Create" },
  { key: "can_edit", label: "Edit" },
  { key: "can_delete", label: "Delete" },
  { key: "can_export", label: "Export" },
];

const ACCESS_LEVELS: Record<AccessLevel, { label: string; className: string; icon: LucideIcon }> = {
  "no-access": { label: "No Access", className: "bg-slate-100 text-slate-600", icon: Lock },
  "view-only": { label: "View Only", className: "bg-blue-100 text-blue-700", icon: Eye },
  editor: { label: "Editor", className: "bg-emerald-100 text-emerald-700", icon: KeyRound },
  creator: { label: "Creator", className: "bg-violet-100 text-violet-700", icon: Plus },
  "full-access": { label: "Full Access", className: "bg-indigo-100 text-indigo-700", icon: Shield },
};

const TEMPLATE_PERMISSIONS: Record<AccessLevel, PermissionSet> = {
  "no-access": { can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false },
  "view-only": { can_view: true, can_create: false, can_edit: false, can_delete: false, can_export: false },
  editor: { can_view: true, can_create: false, can_edit: true, can_delete: false, can_export: false },
  creator: { can_view: true, can_create: true, can_edit: true, can_delete: false, can_export: true },
  "full-access": { can_view: true, can_create: true, can_edit: true, can_delete: true, can_export: true },
};

function accessLevelFromPermissions(permissions: PermissionSet): AccessLevel {
  const { can_view, can_create, can_edit, can_delete, can_export } = permissions;
  if (!can_view && !can_create && !can_edit && !can_delete && !can_export) return "no-access";
  if (can_view && can_create && can_edit && can_delete && can_export) return "full-access";
  if (can_view && can_create && can_edit) return "creator";
  if (can_view && can_edit) return "editor";
  if (can_view) return "view-only";
  return "no-access";
}

function mergePermissions(a: PermissionSet, b: Partial<PermissionSet>): PermissionSet {
  return { ...a, ...b };
}

function AccessBadge({ level }: { level: AccessLevel }) {
  const config = ACCESS_LEVELS[level];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.className} border-transparent font-semibold`}>
      <Icon className="mr-1 h-3.5 w-3.5" />
      {config.label}
    </Badge>
  );
}

function QuickActionCard({
  icon: Icon,
  title,
  description,
  action,
  badge,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-700">
          <Icon className="h-5 w-5" />
        </div>
        {badge ? (
          <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{badge}</span>
        ) : null}
      </div>
      <div className="mt-3 text-sm font-bold text-slate-950">{title}</div>
      <p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{description}</p>
      <div className="mt-3 text-xs font-bold text-indigo-700">{action}</div>
    </button>
  );
}

export default function UnifiedAccessControl() {
  const queryClient = useQueryClient();
  const { role } = useIsAdminOrHR();
  const isAdmin = role === 'admin' || role === 'super_admin';

  const [activeTab, setActiveTab] = useState<TabKey>("users");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [roleToAssign, setRoleToAssign] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState("");
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [pendingPermissionEdits, setPendingPermissionEdits] = useState<Record<string, Partial<PermissionSet>>>({});
  const [requestStatus, setRequestStatus] = useState<"pending" | "approved" | "denied">("pending");
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyRequestId, setDenyRequestId] = useState("");
  const [denyReason, setDenyReason] = useState("");

  const { data: roles = [], isLoading: rolesLoading } = useQuery<RoleInfo[]>({
    queryKey: ["access-control", "roles"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: RoleInfo[] }>("/api/access/roles/catalog");
      return res.data ?? [];
    },
    staleTime: 60 * 60 * 1000,
  });

  const debouncedSearch = useDebouncedValue(userSearch, 250);
  const { data: users = [], isFetching: usersFetching } = useQuery<UserOption[]>({
    queryKey: ["access-control", "users", debouncedSearch],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: UserOption[] }>(
        `/api/access/users?search=${encodeURIComponent(debouncedSearch)}&limit=20`
      );
      return res.data ?? [];
    },
    enabled: activeTab === "users" && debouncedSearch.trim().length > 1,
    staleTime: 5 * 60 * 1000,
  });

  const { data: selectedUserRoles = [], isLoading: selectedUserRolesLoading } = useQuery<UserRole[]>({
    queryKey: ["access-control", "user-roles", selectedUser?.id],
    queryFn: async () => {
      if (!selectedUser) return [];
      const res = await hrmsApi.get<{ data: UserRole[] }>(`/api/access/roles/user/${selectedUser.id}`);
      return res.data ?? [];
    },
    enabled: !!selectedUser,
  });

  const { data: roleSummaries = [], isFetching: roleSummariesLoading } = useQuery<RoleSummary[]>({
    queryKey: ["access-control", "role-summaries", roles.map((role) => role.role_key).join(",")],
    queryFn: async () => {
      const summaries = await Promise.all(
        roles.map(async (role) => {
          const res = await hrmsApi.get<{ data: RoleSummary }>(`/api/access/roles/${role.role_key}/summary`);
          return res.data;
        })
      );
      return summaries.filter(Boolean);
    },
    enabled: activeTab === "users" && roles.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: pageCatalog = [], isLoading: pagesLoading } = useQuery<PageCatalogEntry[]>({
    queryKey: ["access-control", "page-catalog"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: PageCatalogEntry[] }>("/api/access/pages/catalog");
      return res.data ?? [];
    },
    enabled: activeTab === "permissions",
    staleTime: 30 * 60 * 1000,
  });

  const { data: rolePermissions = [], isFetching: permissionsLoading } = useQuery<PagePermission[]>({
    queryKey: ["access-control", "role-permissions", selectedRole],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: PagePermission[] }>(`/api/access/roles/${selectedRole}/permissions`);
      return res.data ?? [];
    },
    enabled: activeTab === "permissions" && !!selectedRole,
  });

  const { data: pendingRequests = [] } = useQuery<AccessRequestRow[]>({
    queryKey: ["access-control", "pending-requests-count"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: AccessRequestRow[] }>("/api/access/requests?status=pending");
      return res.data ?? [];
    },
    enabled: isAdmin,
    staleTime: 60 * 1000,
    retry: false,
  });

  const { data: accessRequests = [], isFetching: requestsLoading, isError: requestsError } = useQuery<AccessRequestRow[]>({
    queryKey: ["access-control", "requests", requestStatus],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: AccessRequestRow[] }>(`/api/access/requests?status=${requestStatus}`);
      return res.data ?? [];
    },
    enabled: activeTab === "admin" && isAdmin,
    retry: false,
  });

  const { data: rbacStatus, isFetching: rbacLoading, refetch: refetchRbac, isError: rbacError } = useQuery<RbacStatus>({
    queryKey: ["access-control", "rbac-status"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: RbacStatus }>("/api/access/rbac/status");
      return res.data;
    },
    enabled: activeTab === "admin" && isAdmin,
    refetchInterval: activeTab === "admin" && isAdmin ? 5 * 60 * 1000 : false,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: activity = [], isFetching: activityLoading, isError: activityError } = useQuery<ActivityItem[]>({
    queryKey: ["access-control", "activity"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: ActivityItem[] }>("/api/access/activity?limit=10");
      return res.data ?? [];
    },
    enabled: activeTab === "admin" && isAdmin,
    staleTime: 2 * 60 * 1000,
    retry: false,
  });

  const assignRoleMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUser || !roleToAssign) return;
      await hrmsApi.post("/api/access/roles/assign", {
        user_id: selectedUser.id,
        role_key: roleToAssign,
      });
    },
    onSuccess: () => {
      toast.success("Role assigned");
      setRoleToAssign("");
      setAssignOpen(false);
      queryClient.invalidateQueries({ queryKey: ["access-control"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Failed to assign role"),
  });

  const revokeRoleMutation = useMutation({
    mutationFn: async (roleKey: string) => {
      if (!selectedUser) return;
      await hrmsApi.post("/api/access/roles/revoke", {
        user_id: selectedUser.id,
        role_key: roleKey,
      });
    },
    onSuccess: () => {
      toast.success("Role revoked");
      queryClient.invalidateQueries({ queryKey: ["access-control"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Failed to revoke role"),
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async (updates: Array<{ page_code: string; permissions: PermissionSet }>) => {
      await hrmsApi.put(`/api/access/roles/${selectedRole}/permissions`, { updates });
    },
    onSuccess: () => {
      toast.success("Permissions saved");
      setPendingPermissionEdits({});
      queryClient.invalidateQueries({ queryKey: ["access-control", "role-permissions", selectedRole] });
      queryClient.invalidateQueries({ queryKey: ["access-control", "role-summaries"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Failed to save permissions"),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => hrmsApi.post(`/api/access/requests/${id}/approve`, {}),
    onSuccess: () => {
      toast.success("Access request approved");
      queryClient.invalidateQueries({ queryKey: ["access-control"] });
    },
    onError: () => toast.error("Failed to approve request"),
  });

  const denyMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      hrmsApi.post(`/api/access/requests/${id}/deny`, { review_note: reason }),
    onSuccess: () => {
      toast.success("Access request denied");
      setDenyOpen(false);
      setDenyReason("");
      queryClient.invalidateQueries({ queryKey: ["access-control"] });
    },
    onError: () => toast.error("Failed to deny request"),
  });

  const rolePermissionMap = useMemo(() => {
    return new Map(rolePermissions.map((row) => [row.page_code, row]));
  }, [rolePermissions]);

  const mergedPages = useMemo(() => {
    return pageCatalog.map((page) => {
      const existing = rolePermissionMap.get(page.page_code);
      const base = existing?.permissions ?? TEMPLATE_PERMISSIONS["no-access"];
      return {
        page_code: page.page_code,
        page_name: existing?.page_name ?? page.page_name,
        module: existing?.module ?? page.module ?? "Unassigned",
        permissions: mergePermissions(base, pendingPermissionEdits[page.page_code] ?? {}),
        hasGrant: !!existing,
        isDirty: !!pendingPermissionEdits[page.page_code],
      };
    });
  }, [pageCatalog, pendingPermissionEdits, rolePermissionMap]);

  const groupedPages = useMemo(() => {
    const groups = new Map<string, typeof mergedPages>();
    for (const page of mergedPages) {
      const moduleName = page.module || "Unassigned";
      groups.set(moduleName, [...(groups.get(moduleName) ?? []), page]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [mergedPages]);

  const selectedRoleSummary = roleSummaries.find((role) => role.role_key === selectedRole);

  function updatePagePermission(pageCode: string, key: PermissionKey, checked: boolean) {
    setPendingPermissionEdits((prev) => ({
      ...prev,
      [pageCode]: {
        ...(prev[pageCode] ?? {}),
        [key]: checked,
      },
    }));
  }

  function applyTemplateToModule(moduleName: string, level: AccessLevel) {
    const modulePages = mergedPages.filter((page) => page.module === moduleName);
    setPendingPermissionEdits((prev) => {
      const next = { ...prev };
      for (const page of modulePages) next[page.page_code] = TEMPLATE_PERMISSIONS[level];
      return next;
    });
  }

  function saveAllPermissionEdits() {
    const updates = mergedPages
      .filter((page) => page.isDirty)
      .map((page) => ({ page_code: page.page_code, permissions: page.permissions }));
    if (updates.length === 0) {
      toast.info("No permission changes to save");
      return;
    }
    updatePermissionsMutation.mutate(updates);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white shadow-xl">
          <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-indigo-100">
                <Sparkles className="h-3.5 w-3.5" />
                Redesigned Access Control Hub
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight">Users, roles, and permissions in one clean workflow</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Assign roles quickly, review permission coverage by module, and manage access requests without jumping across six separate tabs.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Roles" value={roles.length} />
              <Metric label="Pending" value={pendingRequests.length} />
              <Metric label="Conflicts" value={rbacStatus?.conflicts_count ?? 0} />
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <QuickActionCard
            icon={UserCog}
            title="Assign Role"
            description="Find a user and add the correct workforce role with audit tracking."
            action="Start assignment"
            onClick={() => {
              setActiveTab("users");
              setAssignOpen(true);
            }}
          />
          <QuickActionCard
            icon={Shield}
            title="Review Permissions"
            description="Pick a role, expand a module, and apply visual permission templates."
            action="Open permissions"
            onClick={() => setActiveTab("permissions")}
          />
          {isAdmin && (
            <QuickActionCard
              icon={Activity}
              title="Pending Requests"
              description="Approve or deny employee access requests from a single queue."
              action="Review requests"
              badge={pendingRequests.length}
              onClick={() => setActiveTab("admin")}
            />
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          <div className="grid gap-1 sm:grid-cols-3">
            {([
              { key: "users" as const, label: "Users & Roles", icon: Users },
              { key: "permissions" as const, label: "Permissions", icon: Shield },
              ...(isAdmin ? [{ key: "admin" as const, label: "Administration", icon: Activity }] : []),
            ] as const).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${
                    activeTab === tab.key
                      ? "bg-slate-950 text-white shadow"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "users" && (
          <section className="grid gap-5 xl:grid-cols-[minmax(340px,0.95fr)_1.25fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-950">Find User</h2>
                  <p className="text-sm text-slate-500">Type name, employee code, or email. Results appear as you type.</p>
                </div>
                {usersFetching ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
              </div>
              <div className="relative mt-4">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  className="pl-9"
                  placeholder="Search employee..."
                />
              </div>
              <div className="mt-4 space-y-2">
                {debouncedSearch.length <= 1 ? (
                  <EmptyState text="Enter at least two characters to search users." />
                ) : users.length === 0 && !usersFetching ? (
                  <EmptyState text="No matching users found." />
                ) : (
                  users.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => {
                        setSelectedUser(user);
                        setAssignOpen(false);
                      }}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        selectedUser?.id === user.id
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-slate-950">{user.full_name || user.email}</div>
                          <div className="text-xs text-slate-500">{user.employee_code ?? "No employee code"} • {user.email}</div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </div>
                      {user.roles?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {user.roles.map((role) => <Badge key={role} variant="secondary">{role}</Badge>)}
                        </div>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">Selected User Roles</h2>
                    <p className="text-sm text-slate-500">Assign and revoke roles with security audit logging.</p>
                  </div>
                  <Button disabled={!selectedUser} onClick={() => setAssignOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Assign Role
                  </Button>
                </div>
                {!selectedUser ? (
                  <EmptyState text="Select a user from the search panel to manage roles." />
                ) : (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="font-black text-slate-950">{selectedUser.full_name || selectedUser.email}</div>
                    <div className="text-sm text-slate-500">{selectedUser.employee_code ?? "No employee code"} • {selectedUser.email}</div>
                    <div className="mt-4">
                      <Label className="text-xs uppercase tracking-wide text-slate-500">Active Roles</Label>
                      {selectedUserRolesLoading ? (
                        <Loader2 className="mt-3 h-5 w-5 animate-spin text-slate-400" />
                      ) : selectedUserRoles.length === 0 ? (
                        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No active role assigned.</p>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedUserRoles.map((role) => (
                            <span key={role.role_key} className="inline-flex items-center gap-2 rounded-full border bg-white py-1 pl-3 pr-1 text-sm font-semibold text-slate-700">
                              {role.role_name}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 rounded-full text-rose-600"
                                onClick={() => revokeRoleMutation.mutate(role.role_key)}
                                disabled={revokeRoleMutation.isPending}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">Role Summary</h2>
                    <p className="text-sm text-slate-500">Who has what, and how much page coverage it gives.</p>
                  </div>
                  {roleSummariesLoading || rolesLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {(roleSummaries.length ? roleSummaries : roles.map((role) => ({
                    role_key: role.role_key,
                    role_name: role.role_name,
                    role_description: role.description,
                    user_count: 0,
                    page_count: 0,
                    modules: [],
                  }))).map((role) => (
                    <div key={role.role_key} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-slate-950">{role.role_name}</div>
                          <div className="text-xs text-slate-500">{role.role_key}</div>
                        </div>
                        <Badge className="bg-slate-950 text-white hover:bg-slate-950">{role.user_count} users</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-slate-50 p-2">
                          <div className="font-bold text-slate-950">{role.page_count}</div>
                          <div className="text-slate-500">Viewable pages</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-2">
                          <div className="font-bold text-slate-950">{role.modules?.length ?? 0}</div>
                          <div className="text-slate-500">Modules</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "permissions" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-950">Role Permissions</h2>
                <p className="text-sm text-slate-500">Grouped by module with visual access levels instead of a long checkbox wall.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={selectedRole} onValueChange={(value) => {
                  setSelectedRole(value);
                  setPendingPermissionEdits({});
                  setExpandedModules({});
                }}>
                  <SelectTrigger className="w-full min-w-64 sm:w-72">
                    <SelectValue placeholder="Select role..." />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.role_key} value={role.role_key}>{role.role_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={saveAllPermissionEdits}
                  disabled={!selectedRole || updatePermissionsMutation.isPending || Object.keys(pendingPermissionEdits).length === 0}
                >
                  {updatePermissionsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Changes
                </Button>
              </div>
            </div>

            {selectedRoleSummary ? (
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className="bg-indigo-700 hover:bg-indigo-700">{selectedRoleSummary.role_name}</Badge>
                  <span className="text-sm font-semibold text-indigo-950">{selectedRoleSummary.user_count} users</span>
                  <span className="text-sm font-semibold text-indigo-950">{selectedRoleSummary.page_count} pages</span>
                </div>
              </div>
            ) : null}

            {!selectedRole ? (
              <EmptyState text="Select a role to view page permissions." />
            ) : pagesLoading || permissionsLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
            ) : (
              <div className="mt-5 space-y-3">
                {groupedPages.map(([moduleName, pages]) => {
                  const open = expandedModules[moduleName] ?? false;
                  const granted = pages.filter((page) => accessLevelFromPermissions(page.permissions) !== "no-access").length;
                  const full = pages.filter((page) => accessLevelFromPermissions(page.permissions) === "full-access").length;
                  const summaryLevel: AccessLevel = full === pages.length ? "full-access" : granted > 0 ? "editor" : "no-access";

                  return (
                    <div key={moduleName} className="overflow-hidden rounded-xl border border-slate-200">
                      <div className="flex flex-col gap-3 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
                        <button
                          type="button"
                          className="flex min-w-0 items-center gap-3 text-left"
                          onClick={() => setExpandedModules((prev) => ({ ...prev, [moduleName]: !open }))}
                        >
                          {open ? <ChevronDown className="h-5 w-5 text-slate-500" /> : <ChevronRight className="h-5 w-5 text-slate-500" />}
                          <div>
                            <div className="font-black text-slate-950">{moduleName}</div>
                            <div className="text-xs text-slate-500">{granted} of {pages.length} pages granted</div>
                          </div>
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          <AccessBadge level={summaryLevel} />
                          {(["view-only", "editor", "full-access", "no-access"] as AccessLevel[]).map((level) => (
                            <Button key={level} variant="outline" size="sm" onClick={() => applyTemplateToModule(moduleName, level)}>
                              {ACCESS_LEVELS[level].label}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {open && (
                        <div className="overflow-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-white text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-3">Page</th>
                                <th className="px-4 py-3">Access Level</th>
                                {PERMISSIONS.map((permission) => (
                                  <th key={permission.key} className="px-3 py-3 text-center">{permission.label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {pages.map((page) => (
                                <tr key={page.page_code} className={`border-t ${page.isDirty ? "bg-amber-50" : "bg-white"}`}>
                                  <td className="px-4 py-3">
                                    <div className="font-bold text-slate-950">{page.page_name ?? page.page_code}</div>
                                    <div className="font-mono text-xs text-slate-500">{page.page_code}</div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <AccessBadge level={accessLevelFromPermissions(page.permissions)} />
                                  </td>
                                  {PERMISSIONS.map((permission) => (
                                    <td key={permission.key} className="px-3 py-3 text-center">
                                      <Checkbox
                                        checked={page.permissions[permission.key]}
                                        onCheckedChange={(checked) => updatePagePermission(page.page_code, permission.key, Boolean(checked))}
                                      />
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "admin" && (
          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-950">Access Requests</h2>
                  <p className="text-sm text-slate-500">Approve or deny page access requests quickly.</p>
                </div>
                <div className="flex gap-2">
                  {(["pending", "approved", "denied"] as const).map((status) => (
                    <Button
                      key={status}
                      variant={requestStatus === status ? "default" : "outline"}
                      size="sm"
                      className="capitalize"
                      onClick={() => setRequestStatus(status)}
                    >
                      {status}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {requestsError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
                    <p className="text-sm font-semibold text-rose-700">Access denied or unavailable</p>
                    <p className="mt-1 text-xs text-rose-600">You may not have permission to view access requests.</p>
                  </div>
                ) : requestsLoading ? (
                  <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                ) : accessRequests.length === 0 ? (
                  <EmptyState text={`No ${requestStatus} access requests.`} />
                ) : (
                  accessRequests.map((request) => (
                    <div key={request.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="font-bold text-slate-950">{request.user_email ?? request.user_id}</div>
                          <div className="mt-1 font-mono text-xs text-slate-500">{request.page_code}</div>
                          <p className="mt-2 text-sm text-slate-600">{request.reason || "No reason provided."}</p>
                        </div>
                        {requestStatus === "pending" ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => approveMutation.mutate(request.id)}
                              disabled={approveMutation.isPending}
                            >
                              <Check className="mr-1 h-4 w-4" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                              onClick={() => {
                                setDenyRequestId(request.id);
                                setDenyOpen(true);
                              }}
                            >
                              <X className="mr-1 h-4 w-4" />
                              Deny
                            </Button>
                          </div>
                        ) : (
                          <Badge variant="secondary" className="capitalize">{request.status}</Badge>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">RBAC Status</h2>
                    <p className="text-sm text-slate-500">MySQL role integrity check.</p>
                  </div>
                  <Button variant="outline" size="icon" onClick={() => refetchRbac()}>
                    <RefreshCw className={`h-4 w-4 ${rbacLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
                <div className={`mt-4 rounded-xl p-4 ${rbacStatus?.synced ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                  <div className="text-2xl font-black">{rbacStatus?.synced ? "Synced" : `${rbacStatus?.conflicts_count ?? 0} conflicts`}</div>
                  <div className="mt-1 text-xs font-semibold">
                    Last checked: {rbacStatus?.last_sync ? formatIST(rbacStatus.last_sync) : "Not checked yet"}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-black text-slate-950">Recent Activity</h2>
                    <p className="text-sm text-slate-500">Last access-control audit events.</p>
                  </div>
                  {activityLoading ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : null}
                </div>
                <div className="mt-4 space-y-3">
                  {activity.length === 0 ? (
                    <EmptyState text="No recent activity found." />
                  ) : (
                    activity.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="text-sm font-bold text-slate-950">{item.action}</div>
                        <div className="text-xs text-slate-500">{item.description}</div>
                        <div className="mt-1 text-[11px] text-slate-400">{formatIST(item.created_at)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign Role to User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Selected User</Label>
              <div className="mt-1 rounded-xl border bg-slate-50 p-3 text-sm">
                {selectedUser ? (
                  <>
                    <div className="font-bold text-slate-950">{selectedUser.full_name || selectedUser.email}</div>
                    <div className="text-xs text-slate-500">{selectedUser.email}</div>
                  </>
                ) : (
                  <span className="text-slate-500">Search and select a user first.</span>
                )}
              </div>
            </div>
            <div>
              <Label>Role</Label>
              <Select value={roleToAssign} onValueChange={setRoleToAssign} disabled={!selectedUser}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a role..." />
                </SelectTrigger>
                <SelectContent>
                  {roles
                    .filter((role) => !selectedUserRoles.some((assigned) => assigned.role_key === role.role_key))
                    .map((role) => (
                      <SelectItem key={role.role_key} value={role.role_key}>{role.role_name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button
              onClick={() => assignRoleMutation.mutate()}
              disabled={!selectedUser || !roleToAssign || assignRoleMutation.isPending}
            >
              {assignRoleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Assign Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={denyOpen} onOpenChange={setDenyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deny Access Request</DialogTitle>
          </DialogHeader>
          <Textarea
            value={denyReason}
            onChange={(event) => setDenyReason(event.target.value)}
            placeholder="Reason for denial..."
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyOpen(false)}>Cancel</Button>
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/10 p-4 text-center">
      <div className="text-2xl font-black">{value}</div>
      <div className="text-xs font-semibold uppercase tracking-wide text-indigo-100">{label}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
