import React, { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, RefreshCw } from "lucide-react";

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
  const today = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date());

  return (
    <div className="min-h-screen bg-[#f7f9fc] flex flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 shadow-[0_1px_12px_rgba(15,23,42,0.05)] backdrop-blur">
        <div className="max-w-[1720px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-black tracking-tight text-slate-950 truncate">{title}</h1>
              {scopeLabel && (
                <span className="rounded-md bg-blue-50 border border-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700 shrink-0">
                  {scopeLabel}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-sm font-medium text-slate-500 mt-1 truncate">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {headerActions}
            <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm lg:flex">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              {today}
            </div>
            <div className="hidden items-center gap-2 text-xs font-medium text-slate-500 xl:flex">
              <RefreshCw className="h-3.5 w-3.5" />
              Updated live
            </div>
          </div>
        </div>
      </header>

      <main className="relative flex-1 max-w-[1720px] mx-auto w-full px-4 sm:px-6 py-6">
        <div className="pointer-events-none absolute inset-x-6 top-0 -z-0 h-56 rounded-[2rem] bg-gradient-to-r from-blue-50 via-white to-emerald-50 opacity-80 blur-3xl" />
        {loading ? (
          <div className="relative z-10 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-2xl w-full" />
          </div>
        ) : (
          <div className="relative z-10">{children}</div>
        )}
      </main>
    </div>
  );
}
