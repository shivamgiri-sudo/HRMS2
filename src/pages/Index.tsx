import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity, BarChart3, Briefcase, Crown, GraduationCap, Receipt, Server, Shield, ShieldCheck, User, UserPlus, Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import { useBranchHeadEnabled } from "@/hooks/useBranchHeadEnabled";
import { pickBranchHeadVariant } from "./dashboards/branchHeadVariant";
import ReferenceRoleDashboard from "./dashboards/ReferenceRoleDashboard";
import {
  canAccessRoleDashboard,
  resolveRoleDashboardVariant,
  type RoleDashboardVariant,
} from "./dashboards/roleDashboardAccess";

export { resolveRoleDashboardVariant } from "./dashboards/roleDashboardAccess";

const VARIANT_META: Record<RoleDashboardVariant, { label: string; icon: React.ElementType }> = {
  super_admin:    { label: "Super Admin",  icon: Shield },
  ceo:            { label: "CEO",          icon: Crown },
  branch_head:    { label: "Branch Health", icon: Activity },
  hr:             { label: "HR",           icon: Users },
  wfm:            { label: "WFM",          icon: BarChart3 },
  wfm_attendance: { label: "WFM Attend.",  icon: BarChart3 },
  payroll:        { label: "Payroll",      icon: Receipt },
  manager:        { label: "Manager",      icon: Briefcase },
  quality:        { label: "Quality",      icon: ShieldCheck },
  operations:     { label: "Operations",   icon: BarChart3 },
  recruiter:      { label: "Recruiter",    icon: UserPlus },
  it_manager:     { label: "IT Manager",   icon: Server },
  employee:       { label: "My Dashboard", icon: User },
};

const ALL_VARIANTS: RoleDashboardVariant[] = [
  "super_admin", "ceo", "branch_head", "hr", "wfm", "wfm_attendance", "payroll",
  "quality", "operations", "recruiter", "it_manager", "manager", "employee",
];

export default function Index() {
  const { data, isLoading } = useUserRole();
  const navigate = useNavigate();
  const roleKeys = data?.roleKeys ?? [];

  // canAccessRoleDashboard already includes the build flag: flag-off builds never ask the backend.
  const branchHeadCandidate = !isLoading && canAccessRoleDashboard("branch_head", roleKeys);
  const pilot = useBranchHeadEnabled({ enabled: branchHeadCandidate });
  const accessible = ALL_VARIANTS.filter((v) => canAccessRoleDashboard(v, roleKeys) && (v !== "branch_head" || pilot.enabled));
  const picked = pickBranchHeadVariant({
    resolved: resolveRoleDashboardVariant(roleKeys),
    enabled: pilot.enabled,
    isLoading: pilot.isLoading,
    fallback: resolveRoleDashboardVariant(roleKeys, { branchHeadEnabled: false }),
  });

  const [active, setActive] = useState<RoleDashboardVariant | null>(null);
  const current = active ?? (picked === "loading" ? "employee" : picked);

  if (isLoading || picked === "loading") {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  const tabBar = accessible.length > 1 ? (
    <div className="flex items-center gap-0 overflow-x-auto px-4 lg:px-6">
      {accessible.map((variant) => {
        const { label, icon: Icon } = VARIANT_META[variant];
        const isActive = variant === current;
        return (
          <button
            key={variant}
            type="button"
            onClick={() => (variant === "branch_head" ? navigate("/branch-head/dashboard") : setActive(variant))}
            className={[
              "flex shrink-0 items-center gap-2 border-b-[3px] px-5 py-3.5 text-[12px] font-semibold transition-all",
              isActive
                ? "border-blue-600 text-blue-700 bg-blue-50"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  ) : undefined;

  if (accessible.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[65vh] items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <Shield className="mx-auto h-10 w-10 text-slate-400" />
            <h1 className="mt-4 text-xl font-bold text-slate-900">No Dashboard Assigned</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Your current role does not include a role dashboard. Open My Modules for pages assigned through RBAC.
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return <ReferenceRoleDashboard key={current} variant={current} subheader={tabBar} />;
}
