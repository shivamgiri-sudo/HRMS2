import { BriefcaseBusiness, Building2, CalendarDays, Database, ShieldCheck } from "lucide-react";
import type { PerformanceContext } from "@/types/performanceHub";

export function PerformanceScopeBar({
  context,
  from,
  to,
  branchId,
  processId,
  latestComputedAt,
  onPeriodChange,
  onScopeChange,
}: {
  context: PerformanceContext;
  from: string;
  to: string;
  branchId?: string;
  processId?: string;
  latestComputedAt: string | null;
  onPeriodChange: (field: "from" | "to", value: string) => void;
  onScopeChange: (field: "branchId" | "processId", value: string) => void;
}) {
  const calculatedLabel = latestComputedAt
    ? `Calculated ${new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(latestComputedAt))}`
    : "Calculated data not available";

  return (
    <section
      aria-label="Performance scope and freshness"
      className="grid gap-3 rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-3 shadow-[var(--shadow-2xs)]"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex min-h-11 items-center gap-2 rounded-[var(--r-md)] border border-[var(--brand-200)] bg-[var(--brand-50)] px-3 font-semibold text-[var(--brand-700)]">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {context.scopeLabel}
        </span>
        <span className="inline-flex min-h-11 items-center gap-2 rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 text-[var(--text-secondary)]">
          <Database className="h-4 w-4" aria-hidden="true" />
          {calculatedLabel}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {context.canSelectBranch && (
          <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
            Branch
            <span className="relative">
              <Building2 className="pointer-events-none absolute left-3 top-3 h-4 w-4" aria-hidden="true" />
              <select
                aria-label="Performance branch"
                value={branchId ?? ""}
                onChange={(event) => onScopeChange("branchId", event.target.value)}
                className="h-11 w-full appearance-none rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] pl-9 pr-8 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
              >
                <option value="">All authorised branches</option>
                {context.branchOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </span>
          </label>
        )}

        {context.canSelectProcess && (
          <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
            Process
            <span className="relative">
              <BriefcaseBusiness className="pointer-events-none absolute left-3 top-3 h-4 w-4" aria-hidden="true" />
              <select
                aria-label="Performance process"
                value={processId ?? ""}
                onChange={(event) => onScopeChange("processId", event.target.value)}
                className="h-11 w-full appearance-none rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] pl-9 pr-8 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
              >
                <option value="">All authorised processes</option>
                {context.processOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </span>
          </label>
        )}

        <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
          From
          <span className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4" aria-hidden="true" />
            <input
              aria-label="Performance period start"
              name="performanceFrom"
              type="date"
              value={from}
              max={to}
              onChange={(event) => onPeriodChange("from", event.target.value)}
              className="h-11 w-full rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] pl-9 pr-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
            />
          </span>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[var(--text-muted)]">
          To
          <input
            aria-label="Performance period end"
            name="performanceTo"
            type="date"
            value={to}
            min={from}
            onChange={(event) => onPeriodChange("to", event.target.value)}
            className="h-11 w-full rounded-[var(--r-md)] border border-[var(--border-default)] bg-[var(--surface-0)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]"
          />
        </label>
      </div>
    </section>
  );
}
