import { useState, useCallback, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Pencil, Ban, CheckCircle, Loader2, Search, ChevronLeft, ChevronRight,
  Shield, UserX, Clock, RefreshCcw, Plus, Trash2, MapPin, X,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  is_blocked: boolean;
  locked_until: string | null;
  failed_login_attempts: number;
  last_login_at: string | null;
  full_name: string | null;
  employee_code: string | null;
  employee_id: string | null;
  employment_status: string | null;
  roles: string[];
}

interface CatalogRole {
  role_key: string;
  role_name: string;
  description?: string;
}

interface BranchRow {
  id: string;
  branch_name: string;
  branch_code: string;
}

interface ProcessRow {
  id: string;
  process_name: string;
  process_code: string;
}

interface ScopeRow {
  id: string;
  role_key: string;
  scope_type: string;
  branch_id: string | null;
  branch_name: string | null;
  process_id: string | null;
  process_name: string | null;
  role_name: string | null;
  assigned_at: string | null;
}

interface UsersResponse {
  success: boolean;
  data: UserRow[];
  total: number;
  meta: { limit: number; offset: number; total: number };
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  super_admin:       "bg-red-100 text-red-800",
  admin:             "bg-orange-100 text-orange-800",
  hr:                "bg-blue-100 text-blue-800",
  finance:           "bg-emerald-100 text-emerald-800",
  payroll:           "bg-emerald-100 text-emerald-800",
  payroll_head:      "bg-emerald-100 text-emerald-800",
  payroll_admin:     "bg-emerald-100 text-emerald-800",
  payroll_hr:        "bg-emerald-100 text-emerald-800",
  branch_head:       "bg-violet-100 text-violet-800",
  branch_admin:      "bg-violet-100 text-violet-800",
  process_manager:   "bg-indigo-100 text-indigo-800",
  manager:           "bg-indigo-100 text-indigo-800",
  it:                "bg-sky-100 text-sky-800",
  branch_it:         "bg-sky-100 text-sky-800",
  it_admin:          "bg-sky-100 text-sky-800",
  wfm:               "bg-cyan-100 text-cyan-800",
  qa:                "bg-yellow-100 text-yellow-800",
  recruiter:         "bg-pink-100 text-pink-800",
  trainer:           "bg-pink-100 text-pink-800",
  team_leader:       "bg-slate-100 text-slate-700",
  tl:                "bg-slate-100 text-slate-700",
  interviewer:       "bg-slate-100 text-slate-700",
  employee:          "bg-gray-100 text-gray-600",
};

// Roles that require a branch assignment for proper data scoping.
// `hr` and the HR variants were missing, which is why an HR user showed no scope pin here
// despite holding real branch scope rows in user_assignment_scope.
const BRANCH_SCOPED_ROLES = new Set([
  "hr", "hr_admin", "ho_hr", "process_hr", "recruitment_hr",
  "branch_head", "bm", "branch_manager",
  "branch_hr", "hr_branch",
  "branch_finance", "payroll_branch",
  "branch_it", "it", "it_admin",
  "branch_admin",
  "process_manager", "manager", "assistant_manager",
  "wfm", "rta", "wfm_spoc",
  "qa", "quality_analyst",
  "trainer", "team_leader", "tl",
  "operations_manager",
]);

// Roles that can additionally be narrowed to specific PROCESSES. A process scope is what makes
// "an HR executive sees only their own processes" true: buildScopeWhereClause turns a
// scope_type='process' row into (process_id = ? AND branch_id = ?), and a holder of one of these
// roles with no scope row at all gets an empty list rather than the whole organisation.
//
// Until this UI existed the dialog only ever wrote scope_type:"branch", so the 20 process rows
// live in production had all been created out of band and no HR user had one.
const PROCESS_SCOPED_ROLES = new Set([
  "hr", "hr_admin", "ho_hr", "process_hr", "recruitment_hr", "branch_hr", "hr_branch",
  "recruiter", "process_manager", "manager", "assistant_manager",
  "team_leader", "tl", "trainer", "qa", "quality_analyst", "tq_head",
  "wfm", "wfm_spoc", "rta",
]);

// ── Helpers ────────────────────────────────────────────────────────────────────

function roleBadge(roleKey: string, roleName: string) {
  const cls = ROLE_COLORS[roleKey] ?? "bg-gray-100 text-gray-600";
  return (
    <span key={roleKey} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {roleName}
    </span>
  );
}

function initials(name: string | null, email: string) {
  const src = name?.trim() || email;
  return src.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatLastLogin(dt: string | null) {
  if (!dt) return "Never";
  const d = new Date(dt);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

const PAGE_SIZE = 50;

function getLockState(u: UserRow): "manual" | "auto" | "none" {
  if (u.is_blocked) return "manual";
  if (u.locked_until && new Date(u.locked_until) > new Date()) return "auto";
  return "none";
}

// ── Main component ─────────────────────────────────────────────────────────────

export function UserRolesManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [includeBlocked, setIncludeBlocked] = useState(false);

  // Dialogs
  const [roleDialogUser, setRoleDialogUser] = useState<UserRow | null>(null);
  const [addRole, setAddRole] = useState<string>("");
  const [addBranchId, setAddBranchId] = useState<string>("");
  const [addProcessId, setAddProcessId] = useState<string>("");
  // The "map an existing role" panel below. Separate state from the add-role flow because every
  // user who needs mapping already HOLDS their role — all 16 hr accounts do — so mapping could
  // not be done at all while scope assignment only happened at the moment a role was granted.
  const [scopeRole, setScopeRole] = useState<string>("");
  const [scopeBranchId, setScopeBranchId] = useState<string>("");
  const [scopeProcessId, setScopeProcessId] = useState<string>("");
  const [removeRole, setRemoveRole] = useState<string>("");
  const [blockDialogUser, setBlockDialogUser] = useState<UserRow | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const usersKey = ["access-users", search, offset, includeBlocked];

  const { data: usersResp, isLoading, isFetching } = useQuery<UsersResponse>({
    queryKey: usersKey,
    queryFn: () => hrmsApi.get<UsersResponse>(
      `/api/access/users?search=${encodeURIComponent(search)}&limit=${PAGE_SIZE}&offset=${offset}&includeBlocked=${includeBlocked}`
    ),
    placeholderData: (prev) => prev,
  });

  const { data: catalogRoles = [] } = useQuery<CatalogRole[]>({
    queryKey: ["role-catalog"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: CatalogRole[] }>("/api/access/roles/catalog");
      return res.data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: branches = [] } = useQuery<BranchRow[]>({
    queryKey: ["access-branches"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: BranchRow[] }>("/api/access/branches");
      return res.data ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });

  // Processes for the branch being chosen. The endpoint filters to processes that actually have
  // active employees in that branch, so the list offers real postings rather than the full 132.
  const { data: addProcesses = [] } = useQuery<ProcessRow[]>({
    queryKey: ["access-processes", addBranchId],
    queryFn: async () => {
      const qs = addBranchId ? `?branchId=${encodeURIComponent(addBranchId)}` : "";
      const res = await hrmsApi.get<{ data: ProcessRow[] }>(`/api/access/processes${qs}`);
      return res.data ?? [];
    },
    enabled: !!addBranchId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: scopeProcesses = [] } = useQuery<ProcessRow[]>({
    queryKey: ["access-processes", scopeBranchId],
    queryFn: async () => {
      const qs = scopeBranchId ? `?branchId=${encodeURIComponent(scopeBranchId)}` : "";
      const res = await hrmsApi.get<{ data: ProcessRow[] }>(`/api/access/processes${qs}`);
      return res.data ?? [];
    },
    enabled: !!scopeBranchId,
    staleTime: 5 * 60 * 1000,
  });

  const { data: userScopes = [], isLoading: scopesLoading } = useQuery<ScopeRow[]>({
    queryKey: ["user-scopes", roleDialogUser?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: ScopeRow[] }>(`/api/access/roles/user-scopes/${roleDialogUser!.id}`);
      return res.data ?? [];
    },
    enabled: !!roleDialogUser,
    staleTime: 0,
  });

  const users: UserRow[] = usersResp?.data ?? [];
  const total: number = usersResp?.total ?? 0;
  const roleMap = new Map(catalogRoles.map((r) => [r.role_key, r.role_name]));

  // ── Search debounce ────────────────────────────────────────────────────────

  const handleSearchChange = useCallback((v: string) => {
    setDraftSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(v);
      setOffset(0);
    }, 350);
  }, []);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const assignRoleMutation = useMutation({
    mutationFn: ({ userId, roleKey }: { userId: string; roleKey: string }) =>
      hrmsApi.post("/api/access/roles/assign", { user_id: userId, role_key: roleKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-users"] });
      queryClient.invalidateQueries({ queryKey: ["user-role"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignScopeMutation = useMutation({
    // scope_type is derived, not hardcoded. A row carrying both branch and process becomes
    // (process_id = ? AND branch_id = ?) in buildScopeWhereClause — the narrowest grant, and the
    // one "this HR executive owns these processes in this branch" actually means.
    mutationFn: ({ userId, roleKey, branchId, processId }: {
      userId: string; roleKey: string; branchId?: string; processId?: string;
    }) =>
      hrmsApi.post("/api/access/roles/assign-scope", {
        user_id: userId,
        role_key: roleKey,
        scope_type: processId ? "process" : "branch",
        branch_id: branchId || null,
        process_id: processId || null,
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["user-scopes", roleDialogUser?.id] });
      toast({ title: vars.processId ? "Process scope assigned" : "Branch scope assigned" });
    },
    onError: (e: Error) => toast({ title: "Scope error", description: e.message, variant: "destructive" }),
  });

  const removeScopeMutation = useMutation({
    mutationFn: (scopeId: string) =>
      hrmsApi.delete(`/api/access/roles/remove-scope/${scopeId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-scopes", roleDialogUser?.id] });
      toast({ title: "Scope removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revokeRoleMutation = useMutation({
    mutationFn: ({ userId, roleKey }: { userId: string; roleKey: string }) =>
      hrmsApi.post("/api/access/roles/revoke", { user_id: userId, role_key: roleKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-users"] });
      queryClient.invalidateQueries({ queryKey: ["user-role"] });
      toast({ title: "Role removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const blockMutation = useMutation({
    mutationFn: ({ userId, block }: { userId: string; block: boolean }) =>
      block
        ? hrmsApi.post("/api/account-control/lock", { userId })
        : hrmsApi.post("/api/account-control/unlock", { userId }),
    onSuccess: (_, { block }) => {
      queryClient.invalidateQueries({ queryKey: ["access-users"] });
      setBlockDialogUser(null);
      toast({ title: block ? "Account locked" : "Account unlocked" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const openRoleDialog = (u: UserRow) => {
    setRoleDialogUser(u);
    setAddRole("");
    setAddBranchId("");
    setRemoveRole(u.roles[0] ?? "");
  };

  const availableToAdd = catalogRoles.filter(
    (r) => !roleDialogUser?.roles.includes(r.role_key)
  );

  const isBranchScoped = BRANCH_SCOPED_ROLES.has(addRole);
  const isProcessScoped = PROCESS_SCOPED_ROLES.has(addRole);

  const handleAddRole = async () => {
    if (!roleDialogUser || !addRole) return;
    await assignRoleMutation.mutateAsync({ userId: roleDialogUser.id, roleKey: addRole });
    setRoleDialogUser((prev) => prev ? { ...prev, roles: [...prev.roles, addRole] } : prev);
    if (isBranchScoped && addBranchId) {
      assignScopeMutation.mutate({
        userId: roleDialogUser.id,
        roleKey: addRole,
        branchId: addBranchId,
        processId: isProcessScoped && addProcessId ? addProcessId : undefined,
      });
    } else if (!isBranchScoped) {
      toast({ title: "Role assigned" });
    }
    setAddRole("");
    setAddBranchId("");
  };

  const handleRemoveRole = () => {
    if (!roleDialogUser || !removeRole) return;
    revokeRoleMutation.mutate({ userId: roleDialogUser.id, roleKey: removeRole });
    setRoleDialogUser((prev) =>
      prev ? { ...prev, roles: prev.roles.filter((r) => r !== removeRole) } : prev
    );
    setRemoveRole(roleDialogUser.roles.filter((r) => r !== removeRole)[0] ?? "");
  };

  const isPending = assignRoleMutation.isPending || assignScopeMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-600" />
              User Accounts & Roles
            </CardTitle>
            <CardDescription>
              {total > 0 ? `${total.toLocaleString()} login accounts` : "All login accounts"} —
              assign / revoke roles, lock / unlock access
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                value={draftSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search name, email, code…"
                className="w-60 rounded-2xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded"
                checked={includeBlocked}
                onChange={(e) => { setIncludeBlocked(e.target.checked); setOffset(0); }}
              />
              Show locked / auto-locked
            </label>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["access-users"] })}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <RefreshCcw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <UserX className="mx-auto mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold">No accounts found.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 border-b">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Account</th>
                    <th className="px-4 py-3 font-semibold">Employee</th>
                    <th className="px-4 py-3 font-semibold">Roles</th>
                    <th className="px-4 py-3 font-semibold">Last Login</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const lockState = getLockState(u);
                    const isLocked = lockState !== "none";
                    return (
                        <tr key={u.id} className={`border-t transition-colors hover:bg-slate-50/80 ${isLocked ? "opacity-60 bg-red-50/40" : ""}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar className="h-8 w-8 shrink-0">
                                <AvatarFallback className="text-xs bg-slate-200 text-slate-700">
                                  {initials(u.full_name, u.email)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-900 truncate max-w-[180px]">
                                  {u.full_name ?? <span className="text-slate-400 font-normal italic">No name</span>}
                                </p>
                                <p className="text-xs text-slate-500 truncate max-w-[180px]">{u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {u.employee_code ? (
                              <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                                {u.employee_code}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-300 italic">not linked</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {u.roles.length === 0 ? (
                                <span className="text-xs text-slate-300 italic">no role</span>
                              ) : (
                                u.roles.map((rk) => roleBadge(rk, roleMap.get(rk) ?? rk))
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-xs ${u.last_login_at ? "text-slate-600" : "text-slate-300"}`}>
                              <Clock className="h-3 w-3" />
                              {formatLastLogin(u.last_login_at)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {lockState === "manual" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                                <Ban className="h-3 w-3" /> Locked
                              </span>
                            ) : lockState === "auto" ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700"
                                title={`${u.failed_login_attempts} failed attempts — locked until ${new Date(u.locked_until!).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}`}>
                                <Clock className="h-3 w-3" /> Auto-locked
                              </span>
                            ) : u.employment_status ? (
                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                u.employment_status.toLowerCase() === "active"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-slate-100 text-slate-500"
                              }`}>
                                {u.employment_status}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-300 italic">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openRoleDialog(u)}
                                className="cursor-pointer rounded-xl border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                                title="Edit roles & scope"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {u.id !== currentUser?.id && (
                                <button
                                  onClick={() => setBlockDialogUser(u)}
                                  className={`cursor-pointer rounded-xl border p-1.5 transition-colors ${
                                    isLocked
                                      ? "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                                      : "border-red-200 text-red-500 hover:bg-red-50"
                                  }`}
                                  title={isLocked ? "Unlock account" : "Lock account"}
                                >
                                  {isLocked
                                    ? <CheckCircle className="h-3.5 w-3.5" />
                                    : <Ban className="h-3.5 w-3.5" />}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-slate-500">
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()} accounts
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-default transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <button
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 font-semibold hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-default transition-colors"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* ── Role edit dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!roleDialogUser} onOpenChange={(o) => !o && setRoleDialogUser(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage Roles & Scope</DialogTitle>
            <DialogDescription>
              {roleDialogUser?.full_name ?? roleDialogUser?.email}
              {roleDialogUser?.employee_code && (
                <span className="ml-2 font-mono text-xs text-slate-500">({roleDialogUser.employee_code})</span>
              )}
            </DialogDescription>
          </DialogHeader>

          {roleDialogUser && (
            <div className="space-y-5 py-2">
              {/* Current roles */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Current Roles</p>
                {roleDialogUser.roles.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">No roles assigned</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {roleDialogUser.roles.map((rk) => (
                      <span key={rk} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${ROLE_COLORS[rk] ?? "bg-gray-100 text-gray-600"}`}>
                        {roleMap.get(rk) ?? rk}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Scope assignments */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> Branch / Scope Assignments
                </p>
                {scopesLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                ) : userScopes.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No scope assignments — data access may be limited or org-wide depending on role.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {userScopes.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 font-semibold ${ROLE_COLORS[s.role_key] ?? "bg-gray-100 text-gray-600"}`}>
                            {s.role_name ?? s.role_key}
                          </span>
                          <span className="text-slate-500">→</span>
                          <span className="font-semibold text-slate-700">
                            {s.branch_name ?? s.process_name ?? s.scope_type}
                          </span>
                          {s.scope_type && (
                            <span className="text-slate-400">({s.scope_type})</span>
                          )}
                        </div>
                        <button
                          onClick={() => removeScopeMutation.mutate(s.id)}
                          disabled={removeScopeMutation.isPending}
                          className="rounded-lg p-1 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
                          title="Remove scope"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add a role */}
              <div className="rounded-2xl border p-4 space-y-3 bg-slate-50">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add Role
                </p>
                <div className="flex gap-2">
                  <Select value={addRole} onValueChange={(v) => { setAddRole(v); setAddBranchId(""); setAddProcessId(""); }}>
                    <SelectTrigger className="flex-1 text-sm rounded-xl">
                      <SelectValue placeholder="Select role to add…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableToAdd.length === 0 ? (
                        <SelectItem value="__none__" disabled>All roles assigned</SelectItem>
                      ) : (
                        availableToAdd.map((r) => (
                          <SelectItem key={r.role_key} value={r.role_key}>
                            <div className="flex items-center gap-1.5">
                              <span>{r.role_name}</span>
                              {BRANCH_SCOPED_ROLES.has(r.role_key) && (
                                <MapPin className="h-3 w-3 text-blue-400 shrink-0" />
                              )}
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleAddRole}
                    disabled={!addRole || isPending || (isBranchScoped && !addBranchId)}
                    className="rounded-xl shrink-0"
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                  </Button>
                </div>
                {/* Branch picker — shown only for branch-scoped roles */}
                {isBranchScoped && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-blue-600 font-semibold flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Select branch for this role (required for proper data scoping)
                    </p>
                    <Select value={addBranchId} onValueChange={(v) => { setAddBranchId(v); setAddProcessId(""); }}>
                      <SelectTrigger className="text-sm rounded-xl">
                        <SelectValue placeholder="Choose branch…" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.length === 0 ? (
                          <SelectItem value="__none__" disabled>No branches found</SelectItem>
                        ) : (
                          branches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                              {b.branch_name}
                              {b.branch_code && <span className="ml-2 text-xs text-slate-400">({b.branch_code})</span>}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Optional process narrowing, once a branch is chosen */}
                {isBranchScoped && isProcessScoped && addBranchId && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-slate-500 font-semibold flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Narrow to one process (optional — leave blank for the whole branch)
                    </p>
                    <Select value={addProcessId} onValueChange={setAddProcessId}>
                      <SelectTrigger className="text-sm rounded-xl">
                        <SelectValue placeholder="Whole branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {addProcesses.length === 0 ? (
                          <SelectItem value="__none__" disabled>No processes with active staff in this branch</SelectItem>
                        ) : (
                          addProcesses.map((pr) => (
                            <SelectItem key={pr.id} value={pr.id}>
                              {pr.process_name}
                              {pr.process_code && <span className="ml-2 text-xs text-slate-400">({pr.process_code})</span>}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* Map an EXISTING role to a branch/process.
                  Without this, scope could only be granted at the moment a role was first
                  assigned — so none of the users who already hold their role could ever be
                  mapped, which is every HR executive in the system. */}
              {roleDialogUser.roles.length > 0 && (
                <div className="rounded-2xl border border-blue-100 p-4 space-y-3 bg-blue-50/30">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> Map an existing role to a branch / process
                  </p>
                  <p className="text-xs text-slate-500">
                    Scoped pages show only the branches and processes mapped here. A role with no
                    mapping sees nothing on those pages rather than everything.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Select value={scopeRole} onValueChange={(v) => { setScopeRole(v); setScopeBranchId(""); setScopeProcessId(""); }}>
                      <SelectTrigger className="text-sm rounded-xl">
                        <SelectValue placeholder="Role…" />
                      </SelectTrigger>
                      <SelectContent>
                        {roleDialogUser.roles.map((rk) => (
                          <SelectItem key={rk} value={rk}>{roleMap.get(rk) ?? rk}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={scopeBranchId} onValueChange={(v) => { setScopeBranchId(v); setScopeProcessId(""); }}>
                      <SelectTrigger className="text-sm rounded-xl">
                        <SelectValue placeholder="Branch…" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={scopeProcessId} onValueChange={setScopeProcessId} disabled={!scopeBranchId}>
                      <SelectTrigger className="text-sm rounded-xl">
                        <SelectValue placeholder={scopeBranchId ? "Whole branch" : "Pick a branch first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {scopeProcesses.length === 0 ? (
                          <SelectItem value="__none__" disabled>No processes with active staff in this branch</SelectItem>
                        ) : (
                          scopeProcesses.map((pr) => (
                            <SelectItem key={pr.id} value={pr.id}>{pr.process_name}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">
                      {scopeProcessId
                        ? "Grants this one process in this branch."
                        : scopeBranchId
                          ? "Grants the whole branch. Add one row per process to narrow it."
                          : ""}
                    </p>
                    <Button
                      size="sm"
                      className="rounded-xl shrink-0"
                      disabled={!scopeRole || !scopeBranchId || assignScopeMutation.isPending}
                      onClick={() => {
                        if (!roleDialogUser || !scopeRole || !scopeBranchId) return;
                        assignScopeMutation.mutate({
                          userId: roleDialogUser.id,
                          roleKey: scopeRole,
                          branchId: scopeBranchId,
                          processId: scopeProcessId || undefined,
                        });
                        setScopeProcessId("");
                      }}
                    >
                      {assignScopeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add mapping"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Remove a role */}
              {roleDialogUser.roles.length > 0 && (
                <div className="rounded-2xl border border-red-100 p-4 space-y-3 bg-red-50/30">
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-500 flex items-center gap-1">
                    <Trash2 className="h-3.5 w-3.5" /> Remove Role
                  </p>
                  <div className="flex gap-2">
                    <Select value={removeRole} onValueChange={setRemoveRole}>
                      <SelectTrigger className="flex-1 text-sm rounded-xl">
                        <SelectValue placeholder="Select role to remove…" />
                      </SelectTrigger>
                      <SelectContent>
                        {roleDialogUser.roles.map((rk) => (
                          <SelectItem key={rk} value={rk}>
                            {roleMap.get(rk) ?? rk}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleRemoveRole}
                      disabled={!removeRole || revokeRoleMutation.isPending}
                      className="rounded-xl shrink-0"
                    >
                      {revokeRoleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogUser(null)} className="rounded-xl">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Lock / unlock dialog ─────────────────────────────────────────────── */}
      {blockDialogUser && (() => {
        const lockState = getLockState(blockDialogUser);
        const isLocked = lockState !== "none";
        return (
          <AlertDialog open onOpenChange={(o) => !o && setBlockDialogUser(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isLocked ? "Unlock Account" : "Lock Account"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isLocked ? (
                    <>
                      Unlock <strong>{blockDialogUser.full_name ?? blockDialogUser.email}</strong>?
                      {lockState === "auto" && (
                        <span className="block mt-1 text-amber-700">
                          Auto-locked after {blockDialogUser.failed_login_attempts} failed login attempts.
                          Unlocking will reset the counter.
                        </span>
                      )}
                      {lockState === "manual" && " They will be able to log in again."}
                    </>
                  ) : (
                    <>Lock <strong>{blockDialogUser.full_name ?? blockDialogUser.email}</strong>? They will be unable to log in until manually unlocked.</>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => blockMutation.mutate({ userId: blockDialogUser.id, block: !isLocked })}
                  className={isLocked ? "" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
                >
                  {blockMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isLocked ? "Unlock" : "Lock"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })()}
    </Card>
  );
}
