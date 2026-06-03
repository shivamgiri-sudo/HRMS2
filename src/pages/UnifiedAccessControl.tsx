import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface RbacMismatch {
  user_id: string;
  mysql_roles: string[];
  supabase_roles: string[];
  in_supabase_only: string[];
  in_mysql_only: string[];
}

type Tab = "module" | "page" | "rbac";

export default function UnifiedAccessControl() {
  const [activeTab, setActiveTab] = useState<Tab>("module");
  const queryClient = useQueryClient();

  const { data: moduleAccess = [] } = useQuery({
    queryKey: ["role-module-access-admin"],
    queryFn: async (): Promise<any[]> => [],
  });

  const { data: pageAccess = [] } = useQuery({
    queryKey: ["role-page-access-admin"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/access/page-access");
      return res.data ?? [];
    },
  });

  const { data: rbacMismatches = [], isLoading: rbacLoading, refetch: refetchRbac } = useQuery<RbacMismatch[]>({
    queryKey: ["rbac-reconciliation"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: RbacMismatch[] }>("/api/access/rbac-reconciliation");
      return res.data ?? [];
    },
    enabled: activeTab === "rbac",
  });

  const assignRole = useMutation({
    mutationFn: async (userId: string) => {
      return hrmsApi.post("/api/access/roles/assign", { user_id: userId, role_key: "employee" });
    },
    onSuccess: () => {
      toast.success("Role assigned successfully");
      queryClient.invalidateQueries({ queryKey: ["rbac-reconciliation"] });
    },
    onError: () => {
      toast.error("Failed to assign role");
    },
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "module", label: "Module Access" },
    { key: "page", label: "Page Access" },
    { key: "rbac", label: "RBAC Sync" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-100 p-3"><Shield className="h-5 w-5" /></div>
            <div>
              <h1 className="text-3xl font-bold text-slate-950">Unified Access Control</h1>
              <p className="text-sm text-slate-600">Role-module and role-page access using your live schema column: role_key.</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-200">
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

        {activeTab === "module" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Role Module Access</h2>
            <div className="mt-4 max-h-[520px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="py-2">Role</th><th>Module</th><th>Manage</th></tr></thead>
                <tbody>{moduleAccess.map((r: any, i) => <tr key={i} className="border-t"><td className="py-2">{r.role_key}</td><td>{r.module_code}</td><td>{r.can_manage ? "Yes" : "No"}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "page" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Role Page Access</h2>
            <div className="mt-4 max-h-[520px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="py-2">Role</th><th>Page</th><th>Edit</th><th>Export</th></tr></thead>
                <tbody>{pageAccess.map((r: any, i) => <tr key={i} className="border-t"><td className="py-2">{r.role_key}</td><td>{r.page_code}</td><td>{r.can_edit ? "Yes" : "No"}</td><td>{r.can_export ? "Yes" : "No"}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "rbac" && (
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">RBAC Sync</h2>
                <p className="mt-1 text-xs text-slate-500">Users whose roles differ between MySQL and Supabase.</p>
              </div>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => refetchRbac()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>

            {rbacLoading ? (
              <p className="text-sm text-slate-500">Loading reconciliation data…</p>
            ) : rbacMismatches.length === 0 ? (
              <p className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                No mismatches found — MySQL and Supabase roles are in sync.
              </p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-2 pr-4">User ID</th>
                      <th className="pr-4">MySQL Roles</th>
                      <th className="pr-4">Supabase Roles</th>
                      <th className="pr-4">Supabase Only</th>
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
                            {row.mysql_roles.map((r) => <Badge key={r} className="bg-sky-50 text-sky-700 hover:bg-sky-50">{r}</Badge>)}
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {row.supabase_roles.map((r) => <Badge key={r} className="bg-slate-100 text-slate-700 hover:bg-slate-100">{r}</Badge>)}
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {row.in_supabase_only.map((r) => <Badge key={r} className="bg-amber-50 text-amber-700 hover:bg-amber-50">{r}</Badge>)}
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {row.in_mysql_only.map((r) => <Badge key={r} className="bg-rose-50 text-rose-700 hover:bg-rose-50">{r}</Badge>)}
                          </div>
                        </td>
                        <td className="py-2">
                          {row.in_supabase_only.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              disabled={assignRole.isPending}
                              onClick={() => assignRole.mutate(row.user_id)}
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
      </div>
    </DashboardLayout>
  );
}
