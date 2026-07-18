import { useMemo, useState } from "react";
import { BarChart3, RefreshCcw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { EnterprisePageShell } from "@/components/enterprise/EnterprisePageShell";
import { ErrorState } from "@/components/enterprise/ErrorState";
import { Button } from "@/components/ui/button";
import { PerformanceMetricGrid } from "@/components/performance-hub/PerformanceMetricGrid";
import { PerformanceRoleLens } from "@/components/performance-hub/PerformanceRoleLens";
import { PerformancePeopleTable } from "@/components/performance-hub/PerformancePeopleTable";
import { PerformanceScopeBar } from "@/components/performance-hub/PerformanceScopeBar";
import { PerformanceTrendPanel } from "@/components/performance-hub/PerformanceTrendPanel";
import {
  usePerformanceContext,
  usePerformancePeople,
  usePerformanceScorecard,
  usePerformanceTrends,
} from "@/hooks/usePerformanceHub";
import {
  shouldShowPerformancePeople,
  type PerformanceFilters,
} from "@/types/performanceHub";

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initialPeriod(): Pick<PerformanceFilters, "from" | "to"> {
  const today = new Date();
  return {
    from: localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: localIsoDate(today),
  };
}

export default function PerformanceHub() {
  const [filters, setFilters] = useState<PerformanceFilters>(() => ({
    ...initialPeriod(),
    page: 1,
    pageSize: 25,
  }));
  const contextQuery = usePerformanceContext();
  const dataEnabled = contextQuery.isSuccess;
  const scorecardQuery = usePerformanceScorecard(filters, dataEnabled);
  const trendsQuery = usePerformanceTrends(filters, dataEnabled);
  const showPeople = contextQuery.data
    ? shouldShowPerformancePeople(contextQuery.data)
    : false;
  const peopleQuery = usePerformancePeople(filters, dataEnabled && showPeople);

  const latestComputedAt = useMemo(() => {
    return (scorecardQuery.data ?? [])
      .map((metric) => metric.latestComputedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  }, [scorecardQuery.data]);

  const retryAll = () => {
    void contextQuery.refetch();
    void scorecardQuery.refetch();
    void trendsQuery.refetch();
    if (showPeople) void peopleQuery.refetch();
  };

  return (
    <DashboardLayout>
      <EnterprisePageShell
        eyebrow="Performance Intelligence"
        title="Performance Hub"
        description="One trusted scorecard for your role, calculated from approved operational, quality, WFM, and sales facts."
        actions={(
          <Button variant="outline" className="h-11 rounded-[var(--r-md)]" onClick={retryAll}>
            <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        )}
      >
        {contextQuery.isError ? (
          <ErrorState
            title="Performance scope unavailable"
            description={contextQuery.error.message}
            onRetry={() => void contextQuery.refetch()}
          />
        ) : contextQuery.data ? (
          <>
            <PerformanceRoleLens context={contextQuery.data} />

            <PerformanceScopeBar
              context={contextQuery.data}
              from={filters.from}
              to={filters.to}
              latestComputedAt={latestComputedAt}
              onPeriodChange={(field, value) => {
                setFilters((current) => ({ ...current, [field]: value, page: 1 }));
              }}
            />

            {scorecardQuery.isError ? (
              <ErrorState
                title="Performance scorecard unavailable"
                description={scorecardQuery.error.message}
                onRetry={() => void scorecardQuery.refetch()}
              />
            ) : (
              <PerformanceMetricGrid
                metrics={scorecardQuery.data ?? []}
                loading={scorecardQuery.isLoading}
              />
            )}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
              <PerformanceTrendPanel
                trends={trendsQuery.data}
                loading={trendsQuery.isLoading}
                error={trendsQuery.error}
                onRetry={() => void trendsQuery.refetch()}
              />
              <section className="rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-5 shadow-[var(--shadow-xs)]">
                <div className="flex h-11 w-11 items-center justify-center rounded-[var(--r-md)] border border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-700)]">
                  <BarChart3 className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-[var(--text-primary)]">How to read this scorecard</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Verified metrics use stored numerator and denominator values from an approved formula version. Legacy values remain visible but are clearly marked until their source lineage is reconciled.
                </p>
              </section>
            </div>

            {showPeople && (
              peopleQuery.isError ? (
                <ErrorState
                  title="People performance unavailable"
                  description={peopleQuery.error.message}
                  onRetry={() => void peopleQuery.refetch()}
                />
              ) : (
                <PerformancePeopleTable
                  people={peopleQuery.data}
                  loading={peopleQuery.isLoading}
                />
              )
            )}
          </>
        ) : (
          <PerformanceMetricGrid metrics={[]} loading />
        )}
      </EnterprisePageShell>
    </DashboardLayout>
  );
}
