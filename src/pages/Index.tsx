import { useState } from "react";
import {
  BarChart3, Briefcase, Crown, GraduationCap, Receipt, Shield, User, Users,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserRole } from "@/hooks/useUserRole";
import ReferenceRoleDashboard from "./dashboards/ReferenceRoleDashboard";
import RoleDashboardV3 from "./dashboards/RoleDashboardV3";
import {
  canAccessRoleDashboard,
  resolveRoleDashboardVariant,
  type RoleDashboardVariant,
} from "./dashboards/roleDashboardAccess";

export { resolveRoleDashboardVariant } from "./dashboards/roleDashboardAccess";

const VARIANT_META: Record<RoleDashboardVariant, { label: string; icon: React.ElementType }> = {
  super_admin: { label: "Super Admin",  icon: Shield },
  ceo:         { label: "CEO",          icon: Crown },
  hr:          { label: "HR",           icon: Users },
  wfm:         { label: "WFM",          icon: BarChart3 },
  payroll:     { label: "Payroll",      icon: Receipt },
  manager:     { label: "Manager",      icon: Briefcase },
  employee:    { label: "My Dashboard", icon: User },
};

const ALL_VARIANTS: RoleDashboardVariant[] = [
  "super_admin", "ceo", "hr", "wfm", "payroll", "manager", "employee",
];

export default function Index() {
  const { data, isLoading } = useUserRole();
  const roleKeys = data?.roleKeys ?? [];

  const accessible = ALL_VARIANTS.filter((v) => canAccessRoleDashboard(v, roleKeys));
  const defaultVariant = resolveRoleDashboardVariant(roleKeys);

  const [active, setActive] = useState<RoleDashboardVariant | null>(null);
  const current = active ?? defaultVariant;

  if (isLoading) {
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
            onClick={() => setActive(variant)}
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

  // Employee tab uses the richer V3 layout (production-equivalent)
  if (current === "employee") {
    return (
      <RoleDashboardV3 variant="employee" subheader={tabBar} />
    );
  }

  return <ReferenceRoleDashboard key={current} variant={current} subheader={tabBar} />;
}
