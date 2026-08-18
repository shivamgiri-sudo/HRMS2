import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveSalaryTable, type LiveSalaryRow } from "./LiveSalaryTable";
import { LiveSalaryDrawer } from "./LiveSalaryDrawer";

/**
 * Per-employee "live" salary estimate for the currently-running month — the month payroll
 * has not closed yet, so /api/payroll/records legitimately has no rows for it (payroll runs
 * in arrears). This panel fills that gap using the same computeRunningSalary source that
 * already backs the Attendance Hub Salary tab, the employee Payslip viewer and the standalone
 * /payroll/running-breakdown page.
 *
 * Rebuilt to match the Attendance lookup page's pattern (AttendanceHubTable +
 * AttendanceHubDrawer) after the first version shipped with no working search and no
 * click-through detail: it now takes the Current Payroll tab's own search/branch/process
 * filters as props instead of ignoring them, is paginated server-side, and clicking a row
 * opens a drawer that reuses SalaryTab (the same RunningMonthCard + payslip history the
 * Attendance Hub already shows) rather than a bespoke detail view.
 */

interface Props {
  month: string; // YYYY-MM
  branchId?: string;
  processId?: string;
  search?: string;
}

const LIMIT = 20;

export function LiveSalaryPanel({ month, branchId, processId, search }: Props) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LiveSalaryRow | null>(null);

  // Same as the Current Payroll tab's own search/filter effect: a changed filter means the
  // old page number no longer means anything, so land back on page 1 rather than showing an
  // empty "page 3 of 1" result.
  useEffect(() => {
    setPage(1);
  }, [branchId, processId, search]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["payroll-running-summary-batch", month, branchId ?? "", processId ?? "", search ?? "", page],
    queryFn: async () => {
      const qs = new URLSearchParams({ month, limit: String(LIMIT), page: String(page) });
      if (branchId) qs.set("branch_id", branchId);
      if (processId) qs.set("process_id", processId);
      if (search?.trim()) qs.set("search", search.trim());
      const res = await hrmsApi.get<{ success: boolean; data: LiveSalaryRow[]; total: number; page: number; limit: number }>(
        `/api/payroll/running-summary-batch?${qs.toString()}`
      );
      return res;
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
        <TrendingUp className="h-4 w-4 text-emerald-600" />
        <CardTitle className="text-sm font-semibold text-emerald-900">
          Live salary estimate — running month
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="mb-3 text-xs text-emerald-800">
          Payroll for this month has not closed yet, so there is no final run to show. These
          figures are a live estimate from confirmed attendance to date — they move as the
          month progresses and are not the final payable amount. Use the search and filters
          above to find an employee, and click a row for their full breakdown.
        </p>

        {isError ? (
          <p className="py-4 text-sm text-slate-500">Live estimates are unavailable right now.</p>
        ) : (
          <LiveSalaryTable
            employees={rows}
            total={total}
            page={page}
            limit={LIMIT}
            isLoading={isLoading}
            onPageChange={setPage}
            onSelect={setSelected}
            selectedId={selected?.employee_id ?? null}
          />
        )}
      </CardContent>

      <LiveSalaryDrawer employee={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
