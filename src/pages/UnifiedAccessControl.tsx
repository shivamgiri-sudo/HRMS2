import { useQuery } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

export default function UnifiedAccessControl() {
  const { data: moduleAccess = [] } = useQuery({
    queryKey: ["role-module-access-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_module_access").select("role_key,module_code,can_view,can_manage,active_status").order("role_key").order("module_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: pageAccess = [] } = useQuery({
    queryKey: ["role-page-access-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("role_page_access").select("role_key,page_code,can_view,can_create,can_edit,can_delete,can_export,active_status").order("role_key").order("page_code");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3"><div className="rounded-2xl bg-slate-100 p-3"><Shield className="h-5 w-5" /></div><div><h1 className="text-3xl font-bold text-slate-950">Unified Access Control</h1><p className="text-sm text-slate-600">Role-module and role-page access using your live schema column: role_key.</p></div></div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Role Module Access</h2><div className="mt-4 max-h-[520px] overflow-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="py-2">Role</th><th>Module</th><th>Manage</th></tr></thead><tbody>{moduleAccess.map((r: any, i) => <tr key={i} className="border-t"><td className="py-2">{r.role_key}</td><td>{r.module_code}</td><td>{r.can_manage ? "Yes" : "No"}</td></tr>)}</tbody></table></div></div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Role Page Access</h2><div className="mt-4 max-h-[520px] overflow-auto"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className="py-2">Role</th><th>Page</th><th>Edit</th><th>Export</th></tr></thead><tbody>{pageAccess.map((r: any, i) => <tr key={i} className="border-t"><td className="py-2">{r.role_key}</td><td>{r.page_code}</td><td>{r.can_edit ? "Yes" : "No"}</td><td>{r.can_export ? "Yes" : "No"}</td></tr>)}</tbody></table></div></div>
        </div>
      </div>
    </DashboardLayout>
  );
}
