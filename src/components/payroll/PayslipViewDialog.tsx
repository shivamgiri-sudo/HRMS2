import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  Minus,
  TrendingUp,
  TrendingDown,
  Minus as Flat,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  Umbrella,
  AlertTriangle,
  Sun,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  useEmployeeSalaryHistoryByCode,
  usePayrollLineAttendance,
  type PayrollRecord,
} from "@/hooks/usePayroll";

interface PayslipViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: PayrollRecord | null;
}

const fmt = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);

const fmtShort = (v: number) => {
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)}L`;
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${Math.round(v)}`;
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "paid":
      return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Paid</Badge>;
    case "processing":
      return <Badge className="bg-primary/10 text-primary border-primary/20">Processed</Badge>;
    default:
      return <Badge variant="secondary">Pending</Badge>;
  }
};

// ── Attendance tile ──────────────────────────────────────────────────────────
function AttTile({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center ${color}`}>
      <div className="text-lg">{icon}</div>
      <span className="text-xl font-black tabular-nums">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide leading-tight opacity-80">{label}</span>
    </div>
  );
}

export function PayslipViewDialog({ open, onOpenChange, record }: PayslipViewDialogProps) {
  const { data: salaryHistory = [], isLoading: historyLoading } = useEmployeeSalaryHistoryByCode(
    open ? record?.employeeCode : null
  );

  // Detailed attendance from attendance_daily_record (includes week_off, holidays, half_days)
  const { data: attDetail, isLoading: attLoading } = usePayrollLineAttendance(
    record?.id,
    open
  );

  if (!record) return null;

  const hra            = record.hra            ?? 0;
  const specialAllow   = record.specialAllowance ?? 0;
  const incentiveTotal = record.incentiveTotal  ?? 0;
  const grossSalary    = record.basic + record.allowances;

  // MoM delta
  const thisRunMonth = `${record.year}-${String(record.monthNum).padStart(2, "0")}`;
  const thisIdx = salaryHistory.findIndex((h) => h.runMonth === thisRunMonth);
  const prevPoint = thisIdx > 0 ? salaryHistory[thisIdx - 1] : null;
  const momDelta = prevPoint ? record.netSalary - prevPoint.netSalary : null;
  const momPct = prevPoint && prevPoint.netSalary > 0 ? (momDelta! / prevPoint.netSalary) * 100 : null;

  // Attendance numbers — prefer live attDetail, fallback to record-level fields from salary_prep_line
  const attPresent  = attDetail?.present_days  ?? record.presentDays  ?? 0;
  const attLeave    = attDetail?.approved_leave_days ?? record.leaveDays ?? 0;
  const attLwp      = attDetail ? Number(attDetail.lwp_days) : (record.lwpDays ?? 0);
  const attAbsent   = attDetail?.absent_days   ?? record.absentDays  ?? 0;
  const attWeekOff  = attDetail?.week_off_days ?? 0;
  const attHoliday  = attDetail?.holiday_days  ?? 0;
  const attHalfDay  = attDetail?.half_days     ?? 0;
  const attWorking  = attDetail?.working_days  ?? record.workingDays ?? 0;
  const hasAttData  = attWorking > 0 || attPresent > 0 || attDetail !== null;

  // Payable days — from salary_prep_line via record
  const eligibleWeekoff  = record.eligibleWeekoffDays  ?? 0;
  const eligibleHoliday  = record.eligibleHolidayDays  ?? 0;
  const paidWorkingDays  = record.paidWorkingDays       ?? 0;
  // Approved leave counts as present for weekoff eligibility
  // payable = present + approved_leave + eligible_weekoff + eligible_holiday − lwp
  const finalPayableDays = record.finalPayableDays ??
    (attPresent + attLeave + eligibleWeekoff + eligibleHoliday - attLwp) || paidWorkingDays;

  // Deduction components from salary_prep_line
  const pfEmployee     = record.pfEmployee     ?? 0;
  const esicEmployee   = record.esicEmployee   ?? 0;
  const professionalTax= record.professionalTax?? 0;
  const tdsAmount      = record.tdsAmount      ?? 0;
  const lwpDeduction   = record.lwpDeduction   ?? 0;
  const advanceRecovery= record.advanceRecovery?? 0;
  const otherDeductions= record.otherDeductions?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Payslip — {record.month} {record.year}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* ── Employee Details ─────────────────────────────────────────── */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <h3 className="font-semibold mb-3">Employee Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>
                <span className="ml-2 font-medium">{record.employee.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Code:</span>
                <span className="ml-2 font-medium">{record.employeeCode}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Email:</span>
                <span className="ml-2 font-medium">{record.employee.email}</span>
              </div>
              {record.designation && (
                <div>
                  <span className="text-muted-foreground">Designation:</span>
                  <span className="ml-2 font-medium">{record.designation}</span>
                </div>
              )}
              {record.department && (
                <div>
                  <span className="text-muted-foreground">Department:</span>
                  <span className="ml-2 font-medium">{record.department}</span>
                </div>
              )}
              {record.branch && (
                <div>
                  <span className="text-muted-foreground">Branch:</span>
                  <span className="ml-2 font-medium">{record.branch}</span>
                </div>
              )}
              {record.process && (
                <div>
                  <span className="text-muted-foreground">Process:</span>
                  <span className="ml-2 font-medium">{record.process}</span>
                </div>
              )}
              <div className="col-span-2">
                <span className="text-muted-foreground">Status:</span>
                <span className="ml-2">{getStatusBadge(record.status)}</span>
                {record.paidAt && (
                  <span className="ml-2 text-muted-foreground text-xs">({record.paidAt})</span>
                )}
              </div>
            </div>
          </div>

          {/* ── Attendance Record ─────────────────────────────────────────── */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-600" />
              <span className="text-sm font-semibold text-slate-900">
                Attendance — {record.month} {record.year}
              </span>
              {attWorking > 0 && (
                <span className="ml-auto text-xs text-slate-500">{attWorking} working days</span>
              )}
            </div>

            {attLoading ? (
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
              </div>
            ) : !hasAttData ? (
              <p className="text-sm text-slate-400 text-center py-4">
                No attendance data found for this period.
              </p>
            ) : (
              <>
                {/* Main tiles */}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  <AttTile
                    label="Present"
                    value={attPresent + attLeave}
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    color="border-emerald-200 bg-emerald-50 text-emerald-700"
                  />
                  <AttTile
                    label="Absent"
                    value={attAbsent}
                    icon={<XCircle className="h-4 w-4" />}
                    color="border-red-200 bg-red-50 text-red-700"
                  />
                  <AttTile
                    label="Week Off"
                    value={attWeekOff}
                    icon={<Sun className="h-4 w-4" />}
                    color="border-blue-200 bg-blue-50 text-blue-700"
                  />
                  <AttTile
                    label="Leave"
                    value={attLeave}
                    icon={<Umbrella className="h-4 w-4" />}
                    color="border-violet-200 bg-violet-50 text-violet-700"
                  />
                  <AttTile
                    label="LWP"
                    value={attLwp}
                    icon={<AlertTriangle className="h-4 w-4" />}
                    color={attLwp > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-100 text-slate-400"}
                  />
                  <AttTile
                    label="Holiday"
                    value={attHoliday}
                    icon={<Clock className="h-4 w-4" />}
                    color="border-teal-200 bg-teal-50 text-teal-700"
                  />
                </div>

                {/* Half-day indicator */}
                {attHalfDay > 0 && (
                  <p className="mt-2 text-xs text-slate-500 text-center">
                    + {attHalfDay} half day{attHalfDay !== 1 ? "s" : ""} included in present count
                  </p>
                )}

                {/* Payable days calculation row */}
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">Payable Days</span>
                    <span className="font-black text-base text-emerald-700 tabular-nums">{finalPayableDays}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-slate-500">
                    <span>{attPresent + attLeave} present{attLeave > 0 ? ` (${attPresent} worked + ${attLeave} approved leave)` : ""}</span>
                    {eligibleWeekoff > 0 && <span>+ {eligibleWeekoff} eligible week off</span>}
                    {eligibleHoliday > 0 && <span>+ {eligibleHoliday} eligible holiday</span>}
                    {attLwp > 0 && <span className="text-amber-600">− {attLwp} LWP</span>}
                  </div>
                </div>

                {/* LWP warning */}
                {attLwp > 0 && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {attLwp} day{attLwp !== 1 ? "s" : ""} of Leave Without Pay deducted from this month's salary.
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Earnings / Deductions ─────────────────────────────────────── */}
          {false ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Earnings */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-600">
                  <Plus className="h-4 w-4" />
                  <span className="font-semibold">Earnings</span>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b">
                        <td className="py-1.5 text-muted-foreground">Basic Salary</td>
                        <td className="py-1.5 text-right font-mono font-semibold">{fmt(record.basic)}</td>
                      </tr>
                      {hra > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">HRA</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-emerald-600">+{fmt(hra)}</td>
                        </tr>
                      )}
                      {specialAllow > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">Special Allowance</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-emerald-600">+{fmt(specialAllow)}</td>
                        </tr>
                      )}
                      {incentiveTotal > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">Incentive</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-emerald-600">+{fmt(incentiveTotal)}</td>
                        </tr>
                      )}
                      {hra === 0 && specialAllow === 0 && incentiveTotal === 0 && record.allowances > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">Total Allowances</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-emerald-600">+{fmt(record.allowances)}</td>
                        </tr>
                      )}
                      <tr className="font-semibold">
                        <td className="py-1.5">Gross Salary</td>
                        <td className="py-1.5 text-right font-mono">{fmt(grossSalary)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Deductions */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-destructive">
                  <Minus className="h-4 w-4" />
                  <span className="font-semibold">Deductions</span>
                </div>
                <div className="rounded-lg border bg-background p-4">
                  <table className="w-full text-sm">
                    <tbody>
                      {pfEmployee > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">Provident Fund (PF)</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(pfEmployee)}</td>
                        </tr>
                      )}
                      {esicEmployee > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">ESIC</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(esicEmployee)}</td>
                        </tr>
                      )}
                      {professionalTax > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">Professional Tax</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(professionalTax)}</td>
                        </tr>
                      )}
                      {tdsAmount > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">TDS (Income Tax)</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(tdsAmount)}</td>
                        </tr>
                      )}
                      {lwpDeduction > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">LWP Deduction</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(lwpDeduction)}</td>
                        </tr>
                      )}
                      {advanceRecovery > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">Advance Recovery</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(advanceRecovery)}</td>
                        </tr>
                      )}
                      {otherDeductions > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">Other Deductions</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(otherDeductions)}</td>
                        </tr>
                      )}
                      {pfEmployee === 0 && esicEmployee === 0 && professionalTax === 0 &&
                       tdsAmount === 0 && lwpDeduction === 0 && advanceRecovery === 0 &&
                       otherDeductions === 0 && record.deductions > 0 && (
                        <tr className="border-b">
                          <td className="py-1.5 text-muted-foreground">Deductions</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(record.deductions)}</td>
                        </tr>
                      )}
                      <tr className="font-semibold">
                        <td className="py-1.5">Total Deductions</td>
                        <td className="py-1.5 text-right font-mono text-destructive">-{fmt(record.deductions)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── Net Salary ───────────────────────────────────────────────── */}
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold text-lg">Net Salary</span>
                {momDelta !== null && momPct !== null && (
                  <div className={`mt-1 flex items-center gap-1 text-xs font-medium ${momDelta > 0 ? "text-emerald-600" : momDelta < 0 ? "text-red-500" : "text-slate-400"}`}>
                    {momDelta > 0 ? <TrendingUp className="h-3 w-3" /> : momDelta < 0 ? <TrendingDown className="h-3 w-3" /> : <Flat className="h-3 w-3" />}
                    {momDelta > 0 ? "+" : ""}{fmt(momDelta)} vs last month ({momPct > 0 ? "+" : ""}{momPct.toFixed(1)}%)
                  </div>
                )}
              </div>
              <span className="font-bold text-2xl text-primary">{fmt(record.netSalary)}</span>
            </div>
          </div>

          {/* ── Salary Trend ─────────────────────────────────────────────── */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Salary Trend</p>
                <p className="text-xs text-slate-500 mt-0.5">Net salary across all processed months</p>
              </div>
              {salaryHistory.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {salaryHistory.length} month{salaryHistory.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {historyLoading ? (
              <Skeleton className="h-[160px] w-full rounded-xl" />
            ) : salaryHistory.length === 0 ? (
              <div className="flex h-[100px] items-center justify-center text-sm text-slate-400">
                No salary history found — run payroll for previous months first.
              </div>
            ) : salaryHistory.length === 1 ? (
              <div className="flex h-[60px] items-center justify-center text-sm text-slate-400">
                Only one month on record — trend visible from two months onwards.
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={salaryHistory} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="netTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtShort} width={52} />
                    <Tooltip
                      formatter={(v: number) => [fmt(v), "Net salary"]}
                      contentStyle={{ borderRadius: 12, borderColor: "#cbd5e1", fontSize: 12 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="netSalary"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      fill="url(#netTrend)"
                      dot={{ r: 3, fill: "#6366f1" }}
                      activeDot={{ r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>

                {/* Monthly table */}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-1.5 text-left font-medium">Month</th>
                        <th className="py-1.5 text-right font-medium">Basic</th>
                        <th className="py-1.5 text-right font-medium">Net</th>
                        <th className="py-1.5 text-right font-medium">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...salaryHistory].reverse().map((h, i, arr) => {
                        const prev = arr[i + 1];
                        const delta = prev ? h.netSalary - prev.netSalary : null;
                        const isCurrentMonth = h.runMonth === thisRunMonth;
                        return (
                          <tr
                            key={h.runMonth}
                            className={`border-b border-slate-100 last:border-0 ${isCurrentMonth ? "bg-primary/5 font-semibold" : ""}`}
                          >
                            <td className="py-1 text-slate-700">
                              {h.monthLabel}
                              {isCurrentMonth && <span className="ml-1 text-primary text-[10px]">← this</span>}
                            </td>
                            <td className="py-1 text-right tabular-nums text-slate-600">{fmtShort(h.basic)}</td>
                            <td className="py-1 text-right tabular-nums font-medium text-slate-900">{fmtShort(h.netSalary)}</td>
                            <td className={`py-1 text-right tabular-nums text-xs ${delta === null ? "text-slate-300" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-slate-400"}`}>
                              {delta === null ? "—" : `${delta > 0 ? "+" : ""}${fmtShort(delta)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center italic">
            Computer-generated payslip view. Historical data reflects processed payroll runs only.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
