import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Per-employee "live" salary estimate for the currently-running month — the month payroll
 * has not closed yet, so /api/payroll/records legitimately has no rows for it (payroll runs
 * in arrears). This panel fills that gap using the same computeRunningSalary source that
 * already backs the Attendance Hub Salary tab, the employee Payslip viewer and the standalone
 * /payroll/running-breakdown page — it was simply never surfaced on the main /payroll grid.
 *
 * GET /api/payroll/running-summary-batch caps at 100 employees per call and has no offset
 * param, so a large org only gets a first slice — shown with an explicit "showing first N"
 * note rather than silently truncating, matching the precedent in useTeamAttendanceMonth.ts.
 */

interface LiveSalaryRow {
  employee_id: string;
  employee_code: string;
  name: string;
  // computeRunningSalary shape
  earned_payable_days?: number;
  projected_payable_days?: number;
  earned_net_till_date?: number;
  projected_net?: number;
  // finalized-line fallback shape (rare for a running month, but the endpoint can return it)
  final_payable_days?: number;
  net_salary?: number;
  error?: boolean;
}

interface Props {
  month: string; // YYYY-MM
  branchId?: string;
  processId?: string;
}

const fmt = (n: number | undefined | null) =>
  n === undefined || n === null
    ? "—"
    : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export function LiveSalaryPanel({ month, branchId, processId }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["payroll-running-summary-batch", month, branchId ?? "", processId ?? ""],
    queryFn: async () => {
      const qs = new URLSearchParams({ month, limit: "100" });
      if (branchId) qs.set("branch_id", branchId);
      if (processId) qs.set("process_id", processId);
      const res = await hrmsApi.get<{ success: boolean; data: LiveSalaryRow[]; count: number }>(
        `/api/payroll/running-summary-batch?${qs.toString()}`
      );
      return res.data ?? [];
    },
    staleTime: 60_000,
  });

  const rows = data ?? [];
  const truncated = rows.length === 100;

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
          figures are a live estimate from confirmed attendance to date — they will move as the
          month progresses and are not the final payable amount.
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading live estimates…
          </div>
        ) : isError ? (
          <p className="py-4 text-sm text-slate-500">Live estimates are unavailable right now.</p>
        ) : rows.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">No live estimates available for this scope yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-emerald-100 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-emerald-50/60 text-xs uppercase tracking-wide text-emerald-700">
                <tr>
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-right">Days so far</th>
                  <th className="px-3 py-2 text-right">Earned so far</th>
                  <th className="px-3 py-2 text-right">Projected (month-end)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee_id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{r.name || r.employee_code}</div>
                      <div className="text-xs text-slate-400">{r.employee_code}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.earned_payable_days ?? r.final_payable_days ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
                      {fmt(r.earned_net_till_date ?? r.net_salary)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.projected_net !== undefined ? fmt(r.projected_net) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {truncated && (
          <p className="mt-2 text-xs text-slate-400">
            Showing the first 100 employees in scope. Open an individual employee's Payslip or
            Attendance Hub for their live figure if they aren't listed here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
