import React, { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";

export interface RoleDashboardShellProps {
  title: string;
  subtitle?: string;
  scopeLabel?: string;
  children: ReactNode;
  headerActions?: ReactNode;
  loading?: boolean;
}

export function RoleDashboardShell({
  title,
  subtitle,
  scopeLabel,
  children,
  headerActions,
  loading = false,
}: RoleDashboardShellProps) {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
              {scopeLabel && (
                <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                  {scopeLabel}
                </span>
              )}
            </div>
            {subtitle && <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
            {headerActions}
            <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <RefreshCw className="h-3.5 w-3.5" />
              Updated just now
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-80 rounded-2xl w-full" />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Skeleton className="h-72 rounded-2xl" />
              <Skeleton className="h-72 rounded-2xl" />
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </DashboardLayout>
  );
}
