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
import { AlertCircle, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

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

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-lg font-semibold">{metricName}</SheetTitle>
          <SheetDescription className="text-xs text-slate-400 uppercase tracking-wide">
            {dashboardCode} / {metricCode}
          </SheetDescription>
        </SheetHeader>

        {/* Summary header */}
        {!loading && !error && data?.summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            {Object.entries(data.summary).map(([key, val]) => (
              <div key={key} className="rounded-lg border bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500 capitalize">{key.replace(/_/g, " ")}</p>
                <p className="text-base font-semibold text-slate-900">{val ?? "—"}</p>
              </div>
            ))}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Records table */}
        {!loading && !error && data && (
          <>
            {data.records.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No records found.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                        >
                          {formatColumnLabel(col)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b last:border-0 hover:bg-slate-50 transition-colors"
                      >
                        {columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                            {(() => {
                              const v = row[col];
                              if (v === null || v === undefined) return "—";
                              if (typeof v === "boolean") return v ? "Yes" : "No";
                              const s = String(v);
                              if (isUuidValue(s)) return "—";
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
              <p className="mt-2 text-xs text-slate-400 text-right">
                {data.records.length < data.totalCount
                  ? `Showing ${data.records.length} of ${data.totalCount}`
                  : `${data.totalCount} record${data.totalCount !== 1 ? "s" : ""}`}
              </p>
            )}
          </>
        )}

        <div className="mt-6 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
