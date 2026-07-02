import { useState, useCallback, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Pencil, Ban, CheckCircle, Loader2, Search, ChevronLeft, ChevronRight,
  Shield, UserX, Clock, RefreshCcw, Plus, Trash2,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  is_blocked: boolean;
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

interface UsersResponse {
  success: boolean;
  data: UserRow[];
  total: number;
  meta: { limit: number; offset: number; total: number };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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
  wfm:               "bg-cyan-100 text-cyan-800",
  qa:                "bg-yellow-100 text-yellow-800",
  recruiter:         "bg-pink-100 text-pink-800",
  trainer:           "bg-pink-100 text-pink-800",
  team_leader:       "bg-slate-100 text-slate-700",
  tl:                "bg-slate-100 text-slate-700",
  interviewer:       "bg-slate-100 text-slate-700",
  employee:          "bg-gray-100 text-gray-600",
};

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
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const PAGE_SIZE = 50;

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

  const users: UserRow[] = usersResp?.data ?? [];
  const total: number = usersResp?.total ?? 0;
  const roleMap = new Map(catalogRoles.map((r) => [r.role_key, r.role_name]));

  // ── Search debounce ────────────────────────────────────────────────────────

  const handleSearchChange = (v: string) => {
    setDraftSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(v);
      setOffset(0);
    }, 350);
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const assignRoleMutation = useMutation({
    mutationFn: ({ userId, roleKey }: { userId: string; roleKey: string }) =>
      hrmsApi.post("/api/access/roles/assign", { user_id: userId, role_key: roleKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["access-users"] });
      queryClient.invalidateQueries({ queryKey: ["user-role"] });
      toast({ title: "Role assigned" });
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
    setRemoveRole(u.roles[0] ?? "");
  };

  const availableToAdd = catalogRoles.filter(
    (r) => !roleDialogUser?.roles.includes(r.role_key)
  );

  const handleAddRole = () => {
    if (!roleDialogUser || !addRole) return;
    assignRoleMutation.mutate({ userId: roleDialogUser.id, roleKey: addRole });
    // Optimistically update dialog state
    setRoleDialogUser((prev) => prev ? { ...prev, roles: [...prev.roles, addRole] } : prev);
    setAddRole("");
  };

  const handleRemoveRole = () => {
    if (!roleDialogUser || !removeRole) return;
    revokeRoleMutation.mutate({ userId: roleDialogUser.id, roleKey: removeRole });
    setRoleDialogUser((prev) =>
      prev ? { ...prev, roles: prev.roles.filter((r) => r !== removeRole) } : prev
    );
    setRemoveRole(roleDialogUser.roles.filter((r) => r !== removeRole)[0] ?? "");
  };

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
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                value={draftSearch}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search name, email, code…"
                className="w-60 rounded-2xl border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
              />
            </div>
            {/* Include blocked toggle */}
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded"
                checked={includeBlocked}
                onChange={(e) => { setIncludeBlocked(e.target.checked); setOffset(0); }}
              />
              Show locked
            </label>
            {/* Refresh */}
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
                  {users.map((u) => (
                    <tr key={u.id} className={`border-t transition-colors hover:bg-slate-50/80 ${u.is_blocked ? "opacity-60 bg-red-50/40" : ""}`}>
                      {/* Account */}
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
                      {/* Employee */}
                      <td className="px-4 py-3">
                        {u.employee_code ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                            {u.employee_code}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300 italic">not linked</span>
                        )}
                      </td>
                      {/* Roles */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.length === 0 ? (
                            <span className="text-xs text-slate-300 italic">no role</span>
                          ) : (
                            u.roles.map((rk) => roleBadge(rk, roleMap.get(rk) ?? rk))
                          )}
                        </div>
                      </td>
                      {/* Last login */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs ${u.last_login_at ? "text-slate-600" : "text-slate-300"}`}>
                          <Clock className="h-3 w-3" />
                          {formatLastLogin(u.last_login_at)}
                        </span>
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        {u.is_blocked ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                            Locked
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
                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openRoleDialog(u)}
                            className="cursor-pointer rounded-xl border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                            title="Edit roles"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {u.id !== currentUser?.id && (
                            <button
                              onClick={() => setBlockDialogUser(u)}
                              className={`cursor-pointer rounded-xl border p-1.5 transition-colors ${
                                u.is_blocked
                                  ? "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                                  : "border-red-200 text-red-500 hover:bg-red-50"
                              }`}
                              title={u.is_blocked ? "Unlock account" : "Lock account"}
                            >
                              {u.is_blocked
                                ? <CheckCircle className="h-3.5 w-3.5" />
                                : <Ban className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Roles</DialogTitle>
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

              {/* Add a role */}
              <div className="rounded-2xl border p-4 space-y-3 bg-slate-50">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add Role
                </p>
                <div className="flex gap-2">
                  <Select value={addRole} onValueChange={setAddRole}>
                    <SelectTrigger className="flex-1 text-sm rounded-xl">
                      <SelectValue placeholder="Select role to add…" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableToAdd.length === 0 ? (
                        <SelectItem value="__none__" disabled>All roles assigned</SelectItem>
                      ) : (
                        availableToAdd.map((r) => (
                          <SelectItem key={r.role_key} value={r.role_key}>
                            <div>
                              <span>{r.role_name}</span>
                              {r.description && <span className="ml-2 text-xs text-slate-400">{r.description}</span>}
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleAddRole}
                    disabled={!addRole || assignRoleMutation.isPending}
                    className="rounded-xl shrink-0"
                  >
                    {assignRoleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                  </Button>
                </div>
              </div>

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
      <AlertDialog open={!!blockDialogUser} onOpenChange={(o) => !o && setBlockDialogUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {blockDialogUser?.is_blocked ? "Unlock Account" : "Lock Account"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {blockDialogUser?.is_blocked
                ? `Unlock ${blockDialogUser.full_name ?? blockDialogUser.email}? They will be able to log in again.`
                : `Lock ${blockDialogUser?.full_name ?? blockDialogUser?.email}? They will be unable to log in until unlocked.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                blockDialogUser &&
                blockMutation.mutate({ userId: blockDialogUser.id, block: !blockDialogUser.is_blocked })
              }
              className={blockDialogUser?.is_blocked ? "" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
            >
              {blockMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {blockDialogUser?.is_blocked ? "Unlock" : "Lock"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
