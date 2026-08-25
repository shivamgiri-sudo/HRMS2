import React, { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertCircle, X, TrendingUp, TrendingDown, Users, Clock, CheckCircle2, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

export interface DashboardDrilldownDrawerProps {
  open: boolean;
  onClose: () => void;
  metricCode: string;
  metricName: string;
  dashboardCode: string;
  /**
   * Narrows the drawer's own query — e.g. { bucket: "stuck" } — for a metric with more
   * than one tile pointed at it, so each tile's drawer shows only what that tile
   * actually claims to be, not an identical everything-included breakdown.
   */
  filters?: Record<string, string>;
}

interface DrilldownData {
  summary?: Record<string, string | number>;
  records: Record<string, string | number | null>[];
  totalCount?: number;
}

const COLUMN_LABELS: Record<string, string> = {
  employeeCode: "Emp Code",
  employeeName: "Employee",
  branchName: "Branch",
  processName: "Process",
  appliedBranch: "Applied Branch",
  attendanceStatus: "Status",
  lateMark: "Late Mark",
  shiftName: "Shift",
  punchIn: "Punch In",
  punchOut: "Punch Out",
  candidateName: "Candidate",
  candidateCode: "Candidate Code",
  appliedProcess: "Applied For",
  appliedOn: "Applied On",
  currentStage: "Stage",
  currentStatus: "Status",
  checkType: "Check Type",
  matchScore: "Match Score",
  ageDays: "Age (Days)",
  daysPending: "Days Pending",
  lastWorkingDay: "LWD",
  exitReason: "Exit Reason",
  exitStatus: "Exit Status",
  noticePeriodDays: "Notice (Days)",
  submittedAt: "Submitted On",
  leaveTypeName: "Leave Type",
  leaveTypeCode: "Leave Code",
  fromDate: "From",
  toDate: "To",
  totalDays: "Days",
  appliedAt: "Applied On",
  createdOn: "Created On",
  createdAt: "Created On",
  documentName: "Document",
  verificationStatus: "Verification",
  dueAt: "Due Date",
  overdue: "Overdue",
  documentCount: "Docs On File",
  verifiedCount: "Verified",
  missingPan: "Missing PAN",
  missingUan: "Missing UAN",
  missingBank: "Missing Bank A/C",
  managerName: "Manager",
  recruiterName: "Recruiter",
  alreadyStarted: "Started",
  needsBranchHead: "Needs BH Approval",
  issueType: "Issue Type",
  severity: "Severity",
  autoFixFailed: "Auto-fix Failed",
  oldestIssueDate: "Oldest Issue",
  oldestAgeDays: "Oldest (Days)",
  status: "Status",
  count: "Count",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidColumn(colName: string): boolean {
  return colName === "id" || colName.endsWith("Id") || colName.endsWith("_id");
}

function isUuidValue(value: unknown): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function formatColumnLabel(col: string): string {
  return COLUMN_LABELS[col] ?? col.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim();
}

// Naming-convention-based formatting for the generic numeric cell renderer below.
// Scoped to suffixes/substrings verified against every column name actually returned
// by the ~20 drillXxx handlers in backend/src/modules/dashboards/*.ts (see
// drilldown-formatting-fix-report.md) — none of the in-use "count"/"days"/"score"/"id"
// style columns collide with these patterns.
function formatNumericValue(colName: string, value: number): string {
  if (colName.endsWith("Pct") || colName.endsWith("Percent") || colName.endsWith("Percentage")) {
    return `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  }
  if (/revenue|amount|salary|cost|budget|payable|balance/i.test(colName)) {
    return `₹${value.toLocaleString("en-IN")}`;
  }
  return value.toLocaleString();
}

export function DashboardDrilldownDrawer({
  open,
  onClose,
  metricCode,
  metricName,
  dashboardCode,
  filters,
}: DashboardDrilldownDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DrilldownData | null>(null);
  // Stable string key so the effect below doesn't re-fire on every render from a new
  // filters object literal with the same contents (every layout passes one inline).
  const filtersKey = filters ? JSON.stringify(filters) : "";

  useEffect(() => {
    if (!open || !metricCode || !dashboardCode) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    const query = filters && Object.keys(filters).length > 0
      ? `?${new URLSearchParams(filters).toString()}`
      : "";

    // Must go through hrmsApi: a bare fetch() sends no Authorization header, no
    // credentials and no API base URL, so it 401s in dev (app :8080, API :5055).
    hrmsApi
      .get<{ data?: DrilldownData } | DrilldownData>(
        `/api/dashboards/${dashboardCode}/metric/${metricCode}/drilldown${query}`,
      )
      .then((json) => {
        if (!cancelled) {
          setData(((json as { data?: DrilldownData })?.data ?? json) as DrilldownData);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load drilldown data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filtersKey stands in for filters
  }, [open, metricCode, dashboardCode, filtersKey]);

  const columns =
    data?.records && data.records.length > 0
      ? Object.keys(data.records[0]).filter((col) => !isUuidColumn(col))
      : [];

  const totalCount = data?.totalCount ?? data?.records?.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto bg-gradient-to-br from-slate-50 via-white to-blue-50/30">
        {/* Glassmorphism Header */}
        <div className="mb-5 -mx-6 -mt-6 px-6 py-5 bg-gradient-to-r from-[#0b1f44] via-[#1e3a5f] to-[#0b63e5] rounded-b-2xl">
          <SheetHeader>
            <SheetTitle className="text-xl font-bold text-white flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
                <Users className="h-5 w-5 text-white" />
              </span>
              {metricName}
            </SheetTitle>
            <SheetDescription className="text-xs text-blue-200/80 uppercase tracking-wider mt-1">
              {dashboardCode} / {metricCode}
            </SheetDescription>
          </SheetHeader>
        </div>

        {/* Summary Stats Row */}
        {!loading && !error && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 px-4 py-3 shadow-sm">
              <p className="text-[10px] font-bold text-blue-600/70 uppercase tracking-wide">Total Records</p>
              <p className="text-xl font-extrabold text-[#0b63e5]">{totalCount.toLocaleString()}</p>
            </div>
            {data?.summary && Object.entries(data.summary).slice(0, 2).map(([key, val]) => {
              const isPositive = typeof val === 'number' && val > 0;
              return (
                <div key={key} className={cn(
                  "rounded-xl border px-4 py-3 shadow-sm",
                  isPositive
                    ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-green-50"
                    : "border-slate-200 bg-gradient-to-br from-slate-50 to-gray-50"
                )}>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{key.replace(/_/g, " ")}</p>
                  <p className={cn("text-xl font-extrabold", isPositive ? "text-emerald-600" : "text-slate-700")}>
                    {val ?? "—"}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-8 w-full rounded-lg" />
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 p-4 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
              <AlertCircle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-red-800">Failed to load data</p>
              <p className="text-xs text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Records table */}
        {!loading && !error && data && (
          <>
            {data.records.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                  <CheckCircle2 className="h-7 w-7 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-500">No records found</p>
                <p className="text-xs text-slate-400 mt-1">Try adjusting your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
                <table className="min-w-full text-sm">
                  <thead className="bg-gradient-to-r from-slate-50 to-slate-100/80 border-b border-slate-200/70">
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-4 py-3 text-left text-[11px] font-bold text-slate-600 uppercase tracking-wider whitespace-nowrap"
                        >
                          {formatColumnLabel(col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.records.map((row, i) => (
                      <tr
                        key={i}
                        className="hover:bg-blue-50/50 transition-colors duration-150"
                      >
                        {columns.map((col, colIdx) => (
                          <td key={col} className={cn(
                            "px-4 py-3 whitespace-nowrap",
                            colIdx === 0 ? "font-semibold text-slate-800" : "text-slate-600"
                          )}>
                            {(() => {
                              const v = row[col];
                              if (v === null || v === undefined) return <span className="text-slate-300">—</span>;
                              if (typeof v === "boolean") return (
                                <span className={cn(
                                  "inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full",
                                  v ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                )}>
                                  {v ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                  {v ? "Yes" : "No"}
                                </span>
                              );
                              const s = String(v);
                              if (isUuidValue(s)) return <span className="text-slate-300">—</span>;
                              // Format numbers with locale
                              if (typeof v === "number") return (
                                <span className="font-bold text-[#0b63e5]">{formatNumericValue(col, v)}</span>
                              );
                              return s;
                            })()}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.totalCount !== undefined && data.totalCount !== null && (
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  {data.records.length < data.totalCount
                    ? `Showing ${data.records.length} of ${data.totalCount.toLocaleString()}`
                    : `${data.totalCount.toLocaleString()} record${data.totalCount !== 1 ? "s" : ""}`}
                </span>
                {data.records.length < data.totalCount && (
                  <span className="text-blue-500 font-medium">Scroll to load more</span>
                )}
              </div>
            )}
          </>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="rounded-lg border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all"
          >
            <X className="h-4 w-4 mr-1.5" />
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
