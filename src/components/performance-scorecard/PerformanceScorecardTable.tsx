import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi, getHrmsApiErrorStatus, type HrmsEnvelope } from "@/lib/hrmsApi";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { DashboardDrilldownDrawer } from "@/components/dashboard/DashboardDrilldownDrawer";
import { BASELINE_COLUMNS, TEMPLATE_COLUMNS, type ScorecardRow } from "./performanceScorecardColumns";
import { Button } from "@/components/ui/button";
import PerformanceCompareModal from "./PerformanceCompareModal";

interface PerformanceScorecardTableProps {
  dateFrom: string;
  dateTo: string;
}

function groupByEmployee(rows: ScorecardRow[]): ScorecardRow[] {
  const byEmployee = new Map<string, ScorecardRow>();
  for (const row of rows) {
    const existing = byEmployee.get(row.employeeId);
    if (!existing || row.snapshotDate > existing.snapshotDate) byEmployee.set(row.employeeId, row);
  }
  return Array.from(byEmployee.values());
}

export default function PerformanceScorecardTable({ dateFrom, dateTo }: PerformanceScorecardTableProps) {
  const [drilldown, setDrilldown] = useState<{ employeeId: string; metricCode: string; metricName: string } | null>(null);
  const [compareEmployee, setCompareEmployee] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["performance-scorecard", dateFrom, dateTo],
    queryFn: () =>
      hrmsApi.get<HrmsEnvelope<ScorecardRow[]>>(
        `/api/performance-scorecard?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => groupByEmployee(data?.data ?? []), [data]);
  const columns = [...BASELINE_COLUMNS, ...TEMPLATE_COLUMNS];

  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading scorecard…</div>;

  // The route returns 403 when the caller's role isn't granted OR their team scope
  // can't be resolved — surface this distinctly, don't let it look like an empty table.
  if (error) {
    const status = getHrmsApiErrorStatus(error);
    // 403 is an intentional, correctly-enforced role restriction (not a bug) —
    // render it as a calm informational state, not an alarming red error box.
    if (status === 403) {
      return (
        <div className="p-6 text-sm text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
          Performance Scorecard isn't available for your role — contact your administrator if you believe this is incorrect.
        </div>
      );
    }
    return (
      <div className="p-6 text-sm text-red-600 bg-red-50 rounded-2xl border border-red-200">
        Failed to load the performance scorecard. Please try again.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-white/95 z-10">Employee</TableHead>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
            <TableHead>Compare</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length + 2} className="text-center text-sm text-gray-500 py-6">
                No performance data for this date range.
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => (
            <TableRow key={row.employeeId}>
              <TableCell className="sticky left-0 bg-white z-10">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{row.employeeName.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="font-semibold text-gray-800">{row.employeeName}</span>
                </div>
              </TableCell>
              {columns.map((col) => {
                if (col.available === false) {
                  return (
                    <TableCell key={col.key} className="text-gray-400">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="cursor-default border-dashed text-gray-400 font-normal">
                              Not yet available
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            Shrinkage data isn't scoped by branch/process yet in the underlying system — showing once that's fixed.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  );
                }

                const rowValue = row[col.key as keyof ScorecardRow];
                if (rowValue === null) {
                  return (
                    <TableCell key={col.key} className="text-gray-500">
                      {col.format(row)}
                    </TableCell>
                  );
                }

                return (
                  <TableCell
                    key={col.key}
                    className="cursor-pointer hover:underline"
                    onClick={() => setDrilldown({ employeeId: row.employeeId, metricCode: col.metricCode, metricName: col.label })}
                  >
                    {col.key === "pipStatus" ? (
                      <Badge variant={row.pipStatus === "off_track" ? "destructive" : row.pipStatus === "at_risk" ? "secondary" : "outline"}>
                        {col.format(row)}
                      </Badge>
                    ) : (
                      col.format(row)
                    )}
                  </TableCell>
                );
              })}
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCompareEmployee({ id: row.employeeId, name: row.employeeName })}
                >
                  Compare
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {compareEmployee && (
        <PerformanceCompareModal
          open={true}
          onClose={() => setCompareEmployee(null)}
          employeeName={compareEmployee.name}
          rows={(data?.data ?? []).filter((r) => r.employeeId === compareEmployee.id)}
        />
      )}
      {drilldown && (
        <DashboardDrilldownDrawer
          open={true}
          onClose={() => setDrilldown(null)}
          metricCode={drilldown.metricCode}
          metricName={drilldown.metricName}
          dashboardCode="PERFORMANCE_SCORECARD"
          filters={{ employeeId: drilldown.employeeId, dateFrom, dateTo }}
        />
      )}
    </div>
  );
}
