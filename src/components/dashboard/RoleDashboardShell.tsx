import React, { ReactNode } from "react";
import { cn } from "@/lib/utils";
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
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-slate-900 truncate">{title}</h1>
              {scopeLabel && (
                <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600 shrink-0">
                  {scopeLabel}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-sm text-slate-500 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          {headerActions && (
            <div className="flex items-center gap-2 shrink-0">{headerActions}</div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-screen-2xl mx-auto w-full px-4 sm:px-6 py-6">
        {loading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-xl w-full" />
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
