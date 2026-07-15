import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import RoleDashboardV3, { type RoleDashboardVariant } from "./dashboards/RoleDashboardV3";

function resolveVariant(roleKeys: string[]): RoleDashboardVariant {
  const roles = new Set(roleKeys);

  if (roles.has("super_admin") || roles.has("admin")) return "super_admin";
  if (roles.has("ceo") || roles.has("coo")) return "ceo";
  if (roles.has("hr")) return "hr";
  if (roles.has("wfm")) return "wfm";
  if (
    roles.has("payroll") ||
    roles.has("payroll_hr") ||
    roles.has("payroll_head") ||
    roles.has("payroll_branch") ||
    roles.has("finance") ||
    roles.has("finance_head") ||
    roles.has("accounts_head")
  ) return "payroll";
  if (
    roles.has("manager") ||
    roles.has("process_manager") ||
    roles.has("assistant_manager") ||
    roles.has("branch_head") ||
    roles.has("team_leader") ||
    roles.has("tl")
  ) return "manager";

  return "employee";
}

export default function Index() {
  const { data, isLoading } = useUserRole();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-[1600px] space-y-5">
          <Skeleton className="h-12 w-80" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-36 rounded-2xl" />)}
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Skeleton className="h-80 rounded-2xl" />
            <Skeleton className="h-80 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  return <RoleDashboardV3 variant={resolveVariant(data?.roleKeys ?? [])} />;
}
