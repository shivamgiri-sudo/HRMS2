import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  FileCheck2,
  Lock,
} from "lucide-react";

import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { Textarea } from "../../components/ui/textarea";
import { useWorkforceAccess } from "../../hooks/useUserRole";
import { hrmsApi } from "../../lib/hrmsApi";
import { useFreezeAttendance } from "../../hooks/usePayroll";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayrollRun {
  id: number | string;
  run_month: string;
  status: string;
  validation_status: string;
  attendance_snapshot_locked?: number | boolean;
}

interface PayrollLine {
  id: number | string;
  employee_code?: string;
  employee_name?: string;
  department?: string;
  designation?: string;
  attendance_source?: string;
  attendance_data_source?: string | null;
  paid_base?: number | null;
  week_off_days?: number | null;
  holiday_days?: number | null;
  calc_payable_days?: number | null;
  final_payable_days?: number | null;
  active_calendar_days?: number | null;
  leave_reversed_days?: number | null;
  gross_salary?: number | null;
  net_salary?: number | null;
  status?: string;
  needs_recalculation?: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, prefix = ""): string {
  if (n === null || n === undefined) return "—";
  return `${prefix}${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function ValidationBadge({ status }: { status: string }) {
  if (status === "validated") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Validated
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200">
        <XCircle className="w-3 h-3 mr-1" />
        Rejected
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 border-amber-200">
      <AlertTriangle className="w-3 h-3 mr-1" />
      Pending Validation
    </Badge>
  );
}

function AttSourceBadge({ source, dataSource }: { source?: string | null; dataSource?: string | null }) {
  const isFallback = dataSource === 'SESSION_FALLBACK';
  const isNoData   = dataSource === 'NO_DATA';
  if (isFallback || isNoData) {
    return (
      <Badge variant="outline" className="border-amber-400 text-amber-700 bg-amber-50" title="Attendance engine data unavailable — legacy session fallback used. Verify before disbursement.">
        <AlertTriangle className="w-3 h-3 mr-1" />
        {isNoData ? 'No Data' : 'Fallback'}
      </Badge>
    );
  }
  if (!source && !dataSource) return <span className="text-slate-400">—</span>;
  const isDialler = /apr|dialler|dial/i.test(source ?? '');
  return (
    <Badge
      variant="outline"
      className={
        isDialler
          ? "border-blue-300 text-blue-700 bg-blue-50"
          : "border-slate-300 text-slate-600 bg-slate-50"
      }
    >
      {isDialler ? "APR/Dialler" : "Biometric"}
    </Badge>
  );
}

function KpiCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-2xl font-semibold text-slate-900">{value}</div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PayrollValidationScreen() {
  const { roleKeys } = useWorkforceAccess();
  const canValidate = roleKeys.some((r) =>
    ["payroll_head", "super_admin"].includes(r),
  );

  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [lines, setLines] = useState<PayrollLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const freezeAttendance = useFreezeAttendance();

  // ── Fetch runs list ──────────────────────────────────────────────────────────
  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await hrmsApi.get<any>("/api/payroll/runs?limit=24");
      const list: PayrollRun[] = Array.isArray(data)
        ? data
        : data?.runs ?? data?.data ?? [];
      setRuns(list);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load payroll runs");
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // ── Fetch lines for selected run ─────────────────────────────────────────────
  const fetchLines = useCallback(async (runId: string) => {
    if (!runId) return;
    setLoading(true);
    setLines([]);
    try {
      const data = await hrmsApi.get<any>(
        `/api/payroll/runs/${runId}/lines`,
      );
      const list: PayrollLine[] = Array.isArray(data)
        ? data
        : data?.lines ?? data?.data ?? [];
      setLines(list);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load payroll lines");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRunChange = (runId: string) => {
    setSelectedRunId(runId);
    fetchLines(runId);
  };

  // ── Selected run object ──────────────────────────────────────────────────────
  const selectedRun = runs.find(
    (r) => String(r.id) === String(selectedRunId),
  );

  // ── Freeze attendance ────────────────────────────────────────────────────────
  const handleFreezeAttendance = async () => {
    if (!selectedRunId) return;
    setActionLoading(true);
    try {
      await freezeAttendance.mutateAsync(selectedRunId);
      toast.success("Attendance frozen — payroll can now be calculated");
      await fetchRuns();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to freeze attendance");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Validate ─────────────────────────────────────────────────────────────────
  const handleValidate = async () => {
    if (!selectedRunId) return;
    setActionLoading(true);
    try {
      await hrmsApi.patch(`/api/payroll/runs/${selectedRunId}/validate`, {});
      toast.success("Payroll run validated successfully");
      await fetchRuns();
    } catch (err: any) {
      toast.error(err?.message ?? "Validation failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── Reject ───────────────────────────────────────────────────────────────────
  const handleRejectSubmit = async () => {
    if (!selectedRunId || !rejectReason.trim()) {
      toast.warning("Please enter a rejection reason");
      return;
    }
    setActionLoading(true);
    try {
      await hrmsApi.patch(
        `/api/payroll/runs/${selectedRunId}/reject-validation`,
        { reason: rejectReason.trim() },
      );
      toast.success("Payroll run rejected");
      setRejectOpen(false);
      setRejectReason("");
      await fetchRuns();
    } catch (err: any) {
      toast.error(err?.message ?? "Rejection failed");
    } finally {
      setActionLoading(false);
    }
  };

  // ── KPI aggregates ───────────────────────────────────────────────────────────
  const totalEmployees = lines.length;
  const totalGross = lines.reduce(
    (s, l) => s + (Number(l.gross_salary) || 0),
    0,
  );
  const totalNet = lines.reduce(
    (s, l) => s + (Number(l.net_salary) || 0),
    0,
  );
  const leaveReversedCount = lines.filter(
    (l) => l.leave_reversed_days !== null && l.leave_reversed_days !== undefined && Number(l.leave_reversed_days) > 0,
  ).length;

  // ── Role guard ───────────────────────────────────────────────────────────────
  if (!canValidate) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-slate-500">
          Access restricted to Head Payroll
        </div>
      </DashboardLayout>
    );
  }

  const validationStatus = selectedRun?.validation_status ?? "";
  const isAttendanceFrozen = Boolean(selectedRun?.attendance_snapshot_locked);
  const validateDisabled =
    validationStatus === "validated" || lines.length === 0 || actionLoading;
  const rejectDisabled =
    validationStatus === "rejected" || lines.length === 0 || actionLoading;
  const freezeDisabled =
    !selectedRunId || isAttendanceFrozen || actionLoading;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <FileCheck2 className="w-6 h-6 text-indigo-600" />
            Payroll Validation
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Review and validate payroll runs before NEFT export
          </p>
        </div>

        {/* Run selector row */}
        <div className="flex gap-3 items-center flex-wrap">
          <Select
            value={selectedRunId}
            onValueChange={handleRunChange}
            disabled={runsLoading}
          >
            <SelectTrigger className="w-60">
              <SelectValue placeholder={runsLoading ? "Loading runs…" : "Select payroll run"} />
            </SelectTrigger>
            <SelectContent>
              {runs.map((run) => (
                <SelectItem key={String(run.id)} value={String(run.id)}>
                  {run.run_month} — {run.status ?? ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedRun && (
            <ValidationBadge status={validationStatus} />
          )}
          {selectedRun && (
            <Badge
              variant="outline"
              className={isAttendanceFrozen
                ? "border-blue-300 text-blue-700 bg-blue-50"
                : "border-amber-300 text-amber-700 bg-amber-50"
              }
            >
              <Lock className="w-3 h-3 mr-1" />
              {isAttendanceFrozen ? "Attendance Frozen" : "Attendance Not Frozen"}
            </Badge>
          )}

          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              onClick={fetchRuns}
              size="sm"
              disabled={runsLoading}
              title="Refresh runs"
            >
              <RefreshCw
                className={`w-4 h-4 mr-1 ${runsLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              variant="outline"
              onClick={handleFreezeAttendance}
              disabled={freezeDisabled}
              className="border-blue-300 text-blue-700 hover:bg-blue-50"
              title={isAttendanceFrozen ? "Attendance already frozen" : "Lock attendance before calculating payroll"}
            >
              <Lock className="w-4 h-4 mr-1" />
              {isAttendanceFrozen ? "Frozen" : "Freeze Attendance"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setRejectOpen(true)}
              disabled={rejectDisabled}
              className="border-red-300 text-red-700 hover:bg-red-50"
            >
              <XCircle className="w-4 h-4 mr-1" />
              Reject Run
            </Button>
            <Button
              onClick={handleValidate}
              disabled={validateDisabled}
              className="bg-green-700 hover:bg-green-800 text-white"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Validate Run
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total Employees" value={totalEmployees} />
          <KpiCard
            label="Total Gross"
            value={`₹ ${totalGross.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
          />
          <KpiCard
            label="Total Net"
            value={`₹ ${totalNet.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
          />
          <KpiCard
            label="Leave Reversed (rows)"
            value={leaveReversedCount}
          />
        </div>

        {/* Main table */}
        <Card>
          <CardHeader className="px-6 py-4 border-b">
            <CardTitle className="text-base font-medium text-slate-800">
              Salary Preparation Lines
              {lines.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  ({lines.length} records)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!selectedRunId ? (
              <div className="p-10 text-center text-slate-400 text-sm">
                Select a payroll run to view lines
              </div>
            ) : loading ? (
              <div className="p-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading payroll lines…
              </div>
            ) : lines.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-sm">
                No salary lines found for this run
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="whitespace-nowrap">
                        Emp Code
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Name</TableHead>
                      <TableHead className="whitespace-nowrap">
                        Dept / Designation
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        Att. Source
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        Paid Base (₹)
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        Week-offs
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        Holidays
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        Calc Payable
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        Final Payable
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        Leave Reversed
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        Gross (₹)
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-right">
                        Net (₹)
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        Status
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, idx) => {
                      const capHit =
                        line.final_payable_days !== null &&
                        line.final_payable_days !== undefined &&
                        line.active_calendar_days !== null &&
                        line.active_calendar_days !== undefined &&
                        Number(line.final_payable_days) >=
                          Number(line.active_calendar_days);

                      return (
                        <TableRow
                          key={String(line.id ?? idx)}
                          className="hover:bg-slate-50"
                        >
                          <TableCell className="font-mono text-xs whitespace-nowrap">
                            {line.employee_code ?? "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {line.needs_recalculation === 1 && (
                                <AlertTriangle
                                  className="w-3.5 h-3.5 text-amber-500 shrink-0"
                                  title="Needs recalculation"
                                />
                              )}
                              <span>{line.employee_name ?? "—"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-slate-500">
                            <div>{line.department ?? "—"}</div>
                            <div className="text-slate-400">
                              {line.designation ?? ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            <AttSourceBadge source={line.attendance_source} dataSource={line.attendance_data_source} />
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {fmt(line.paid_base)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(line.week_off_days)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(line.holiday_days)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {fmt(line.calc_payable_days)}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {line.final_payable_days !== null &&
                            line.final_payable_days !== undefined ? (
                              <span
                                className={
                                  capHit
                                    ? "font-semibold text-amber-700"
                                    : "font-semibold text-green-700"
                                }
                                title={
                                  capHit
                                    ? "Calendar cap reached"
                                    : undefined
                                }
                              >
                                {Number(line.final_payable_days).toFixed(1)}
                                {capHit && (
                                  <span className="ml-1 text-xs text-amber-500">
                                    ⚠
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {line.leave_reversed_days !== null &&
                            line.leave_reversed_days !== undefined
                              ? Number(line.leave_reversed_days).toFixed(1)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {fmt(line.gross_salary)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm font-semibold">
                            {fmt(line.net_salary)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                line.status === "finalised" ||
                                line.status === "finalized"
                                  ? "bg-green-100 text-green-700"
                                  : line.status === "draft"
                                  ? "bg-slate-100 text-slate-600"
                                  : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {line.status ?? "—"}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="w-5 h-5" />
              Reject Payroll Run
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Please provide a reason for rejecting this payroll run. This
              action will require re-processing before the run can be validated.
            </p>
            <Textarea
              placeholder="Enter rejection reason…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectSubmit}
              disabled={!rejectReason.trim() || actionLoading}
              className="bg-red-700 hover:bg-red-800 text-white"
            >
              {actionLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <XCircle className="w-4 h-4 mr-1" />
              )}
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
