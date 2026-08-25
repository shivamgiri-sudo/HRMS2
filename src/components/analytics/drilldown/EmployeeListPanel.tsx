import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";
import { chipsToFilterParams } from "./SliceDetailPanel";

interface EmployeeListPanelProps {
  open: boolean;
  metric: "headcount" | "exits" | "shrinkage";
  from: string;
  to: string;
}

export interface EmployeeRow {
  /** Real UUID `employees.id` -- the aon-drilldown-employees report selects this in both
   * response shapes (Task 3). This, never `employee_code`, is what the flag-retention
   * endpoint (Task 4) accepts as `employeeId`. */
  employee_id: string;
  employee_code: string;
  employee_name: string;
  aon_days?: number;
  risk_score?: number;
  date_of_exit?: string;
  tenure_at_exit_days?: number;
  [key: string]: unknown;
}

/**
 * Risk-band bucketing for the Flag-for-Retention-Review payload, exported as a pure function so
 * it can be tested directly (this repo has no jsdom/@testing-library/react to drive a real click
 * event against the mounted button -- see DrillDownProvider.test.tsx for the same deviation, and
 * EmployeeListPanel.test.tsx for how this file follows it).
 */
export function riskBandFor(score: number | undefined): "High" | "Medium" | "Low" {
  const s = score ?? 0;
  if (s >= 60) return "High";
  if (s >= 35) return "Medium";
  return "Low";
}

/**
 * Pure wrapper around the flag-retention POST, exported so the test can call it directly instead
 * of simulating a click. Takes the employee's real UUID `employee_id` -- Task 4's endpoint
 * expects `employeeId` to be that UUID, not the human-readable `employee_code`, and Task 3's
 * report already selects `e.id AS employee_id` in both response shapes to make that possible.
 */
export function flagForRetentionReview(employeeId: string, riskScore?: number) {
  return hrmsApi.post("/api/reports/aon-analytics/flag-retention", {
    employeeId,
    riskBand: riskBandFor(riskScore),
  });
}

/**
 * Builds the query-string filter params for the aon-drilldown-employees report from the current
 * chip bar plus the panel's own metric/from/to props. Exported so the shape can be asserted
 * directly without needing to introspect react-query's internals.
 */
export function buildEmployeeListFilterParams(
  chips: { dimension: string; value: string }[],
  metric: string,
  from: string,
  to: string,
): Record<string, string> {
  return { metric, from, to, ...chipsToFilterParams(chips) };
}

/**
 * Fetches the employee rows for the current slice. Extracted out of the `useQuery` call as a
 * plain async function so it -- and the `res.data` unwrapping -- can be exercised directly in a
 * test without mounting the component.
 */
export async function fetchAonDrilldownEmployees(
  filterParams: Record<string, string>,
): Promise<EmployeeRow[]> {
  const qs = new URLSearchParams({ ...filterParams, limit: "200", offset: "0" });
  const res = await hrmsApi.get<{ data?: EmployeeRow[] }>(
    `/api/reports/suite/aon-drilldown-employees?${qs.toString()}`,
    60_000,
  );
  return res.data ?? [];
}

export function EmployeeListPanel({ open, metric, from, to }: EmployeeListPanelProps) {
  const { chips, showEmployeeList, closeEmployeeList, selectEmployee } = useDrillDown();
  const queryClient = useQueryClient();
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set());

  const filterParams = buildEmployeeListFilterParams(chips, metric, from, to);

  // retry: false + a bounded staleTime, matching the sibling useReport hook in
  // AonAnalyticsView.tsx (aon-bucket-shrinkage) -- a dead/slow query here shouldn't retry three
  // times over before the panel gives up.
  const q = useQuery({
    queryKey: ["aon-drilldown-employees", JSON.stringify(filterParams)],
    enabled: open && showEmployeeList,
    retry: false,
    staleTime: 60_000,
    queryFn: () => fetchAonDrilldownEmployees(filterParams),
  });

  const flagMutation = useMutation({
    mutationFn: (params: { employeeId: string; riskScore?: number }) =>
      flagForRetentionReview(params.employeeId, params.riskScore),
    onSuccess: (_data, params) => {
      setFlaggedIds(prev => new Set(prev).add(params.employeeId));
      void queryClient.invalidateQueries({ queryKey: ["work-inbox"] });
    },
  });

  const rows = q.data ?? [];

  return (
    <Sheet open={open && showEmployeeList} onOpenChange={o => !o && closeEmployeeList()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Employees in this slice</SheetTitle>
        </SheetHeader>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : q.error ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {(q.error as Error).message || "Failed to load employees."}
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No employees match this slice.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.map(row => (
              <div key={row.employee_id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => selectEmployee(row.employee_id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-semibold text-slate-900 hover:underline">
                    {row.employee_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {row.employee_code}
                    {row.aon_days != null ? ` · ${row.aon_days} days on network` : ""}
                    {row.tenure_at_exit_days != null ? ` · ${row.tenure_at_exit_days} days at exit` : ""}
                  </p>
                </button>
                {metric !== "exits" && (
                  <Button
                    size="sm"
                    variant={flaggedIds.has(row.employee_id) ? "secondary" : "outline"}
                    disabled={flaggedIds.has(row.employee_id) || flagMutation.isPending}
                    onClick={() =>
                      flagMutation.mutate({ employeeId: row.employee_id, riskScore: row.risk_score })
                    }
                  >
                    {flaggedIds.has(row.employee_id) ? "Flagged" : "Flag for Retention Review"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
