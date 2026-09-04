import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type CoverageStatus = "paid" | "in_run" | "not_started";

export type CoverageCostCentre = {
  costCentreId: string;
  costCentreCode: string;
  branchId: string;
  branchName: string;
  staff: number;
  runId: string | null;
  status: CoverageStatus;
};

export type MonthCoverage = {
  month: string;
  /** False while any active employee sits outside every run — the month cannot be closed. */
  complete: boolean;
  costCentres: CoverageCostCentre[];
  uncoveredEmployees: Array<{ employeeId: string; employeeCode: string; reason: string }>;
  totals: { paid: number; inRun: number; notStarted: number; uncovered: number };
};

/**
 * What the month still owes: which cost centres are paid, in a run, or untouched, and which
 * employees no run covers.
 *
 * Also feeds the run-scope picker, which needs each cost centre's current status to disable the
 * ones already claimed. One endpoint serves both so the two views cannot disagree about what is
 * still available.
 */
export function useMonthCoverage(month: string) {
  return useQuery({
    queryKey: ["payroll", "month-coverage", month],
    queryFn: () =>
      hrmsApi
        .get<{ data: MonthCoverage }>(`/api/payroll/runs/coverage?month=${month}`)
        .then((r) => r.data),
    enabled: !!month,
    staleTime: 30_000,
  });
}
