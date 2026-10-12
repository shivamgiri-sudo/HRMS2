import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Users,
  Calendar,
  IndianRupee,
  ArrowRightLeft,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DbbillSummary {
  workingDays: number; actualDays: number; earnedDays: number; leaveCount: number;
  basic: number; hra: number; conv: number; bonus: number; portfolio: number;
  medicalAllowance: number; specialAllowance: number; otherAllowance: number;
  lta: number; gross: number;
  basic1: number; hra1: number; conv1: number; bonus1: number; portfolio1: number;
  medicalAllowance1: number; specialAllowance1: number; otherAllowance1: number; gross1: number;
  incentive: number; extraDayIncentive: number; arrear: number; pli: number;
  esic: number; epf: number; proTax: number; tds: number; advPaid: number;
  loanDed: number; leaveDeduction: number; totalDeduction: number; netSalary: number;
  esicCompany: number; epfCompany: number; adminChrg: number; ctc: number;
  attPresent: number; attAbsent: number; attWeekOff: number; attHoliday: number;
  attLeave: number; attTotalRecords: number;
}

interface HrmsSummary {
  attPresent: number; attAbsent: number; attHalfDay: number; attLwp: number;
  attNonWorking: number; attLateMarks: number; attTotalRecords: number;
}

interface EmployeeRow {
  empCode: string; empName: string; costCenter: string; branch: string;
  designation: string; empStatus: string; esiElig: string; pfElig: string;
  dbbill: DbbillSummary; hrms: HrmsSummary; attDiff: number;
}

interface ListResponse {
  month: string; total: number; page: number; limit: number;
  employees: EmployeeRow[];
}

interface DayWiseEntry {
  date: string; day: number; dayOfWeek: string;
  dbbill: { status: string; intime: string | null; outtime: string | null; empStatus: string } | null;
  hrms: {
    status: string; lwp: number; lateMark: number; lateByMins: number;
    clockIn: string | null; clockOut: string | null; workMode: string; source: string; biometricStatus: string;
  } | null;
  match: boolean | null;
}

interface DetailResponse {
  empCode: string; empName: string; costCenter: string; branch: string;
  designation: string; month: string;
  salary: DbbillSummary & { esiElig: string; pfElig: string; pli1: number };
  dayWise: DayWiseEntry[];
  attendanceSummary: {
    dbbill: { present: number; absent: number; weekOff: number; holiday: number; leave: number; totalRecords: number };
    hrms: { present: number; halfDay: number; absent: number; weekOff: number; holiday: number; lwp: number; lateMarks: number; totalRecords: number };
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n === 0 ? "—" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;

const MONTHS = [
  "2026-09", "2026-08", "2026-07", "2026-06", "2026-05",
  "2026-04", "2026-03", "2026-02", "2026-01",
];

function statusBadge(status: string | undefined) {
  if (!status) return <span className="text-slate-400 text-xs">—</span>;
  const map: Record<string, string> = {
    P: "bg-green-100 text-green-700", OP: "bg-green-100 text-green-700",
    A: "bg-red-100 text-red-700", WO: "bg-slate-100 text-slate-600",
    WH: "bg-slate-100 text-slate-600", H: "bg-blue-100 text-blue-700",
    PRESENT: "bg-green-100 text-green-700", HALF_DAY: "bg-yellow-100 text-yellow-700",
    ABSENT: "bg-red-100 text-red-700", WEEK_OFF: "bg-slate-100 text-slate-600",
    HOLIDAY: "bg-blue-100 text-blue-700", LWP: "bg-orange-100 text-orange-700",
  };
  const label: Record<string, string> = {
    P: "P", OP: "OP", A: "A", WO: "WO", WH: "WH", H: "H",
    PRESENT: "P", HALF_DAY: "HD", ABSENT: "A", WEEK_OFF: "WO",
    HOLIDAY: "H", LWP: "LWP",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-purple-100 text-purple-700"}`}>
      {label[status] ?? status}
    </span>
  );
}

// ─── Employee Detail Drawer ────────────────────────────────────────────────────

function EmployeeDetailDrawer({
  empCode, month, onClose,
}: { empCode: string | null; month: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["salary-att-compare-detail", empCode, month],
    queryFn: async () => {
      if (!empCode) return null;
      const r = await hrmsApi.get(`/payroll/salary-att-compare/employee/${empCode}?month=${month}`);
      return r.data.data as DetailResponse;
    },
    enabled: !!empCode,
  });

  const sal = data?.salary;
  const summary = data?.attendanceSummary;

  return (
    <Sheet open={!!empCode} onOpenChange={o => !o && onClose()}>
      <SheetContent className="max-w-3xl w-full overflow-y-auto" side="right">
        {isLoading && (
          <div className="flex items-center justify-center h-40 text-slate-400">
            <RefreshCw className="animate-spin mr-2 h-4 w-4" /> Loading…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-red-500 p-4">
            <AlertCircle className="h-4 w-4" /> Failed to load employee detail.
          </div>
        )}
        {data && (
          <>
            <SheetHeader className="mb-4">
              <div className="flex items-start justify-between">
                <div>
                  <SheetTitle className="text-base font-bold">{data.empCode} — {data.empName}</SheetTitle>
                  <p className="text-xs text-slate-400 mt-0.5">{data.costCenter} · {data.branch} · {data.designation}</p>
                </div>
                <Badge variant="outline">{data.month}</Badge>
              </div>
            </SheetHeader>

            {/* ── Attendance Summary ── */}
            <section className="mb-5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Attendance Summary</h3>
              <div className="grid grid-cols-2 gap-3">
                <Card className="border-blue-100">
                  <CardContent className="p-3">
                    <p className="text-xs font-semibold text-blue-700 mb-2">db_bill (Legacy)</p>
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      {[
                        ["Present", summary?.dbbill.present],
                        ["Absent", summary?.dbbill.absent],
                        ["Week Off", summary?.dbbill.weekOff],
                        ["Holiday", summary?.dbbill.holiday],
                        ["Leave", summary?.dbbill.leave],
                        ["Records", summary?.dbbill.totalRecords],
                      ].map(([label, val]) => (
                        <div key={String(label)}>
                          <span className="text-slate-400">{label}</span>
                          <span className="font-medium ml-1">{val ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-emerald-100">
                  <CardContent className="p-3">
                    <p className="text-xs font-semibold text-emerald-700 mb-2">HRMS (Live)</p>
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      {[
                        ["Present", summary?.hrms.present],
                        ["Half Day", summary?.hrms.halfDay],
                        ["Absent", summary?.hrms.absent],
                        ["Week Off", summary?.hrms.weekOff],
                        ["Holiday", summary?.hrms.holiday],
                        ["LWP", summary?.hrms.lwp],
                        ["Late Marks", summary?.hrms.lateMarks],
                        ["Records", summary?.hrms.totalRecords],
                      ].map(([label, val]) => (
                        <div key={String(label)}>
                          <span className="text-slate-400">{label}</span>
                          <span className="font-medium ml-1">{val ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* ── Salary Components ── */}
            {sal && (
              <section className="mb-5">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Salary Components (db_bill)</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs border rounded-lg p-3 bg-slate-50">
                  {/* Days */}
                  <div className="col-span-2 font-semibold text-slate-500 mt-1 mb-0.5">Days</div>
                  {[
                    ["Working Days", sal.workingDays],
                    ["Actual Days", sal.actualDays],
                    ["Earned Days", sal.earnedDays],
                    ["Leave Days", sal.leaveCount],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="flex justify-between">
                      <span className="text-slate-500">{l}</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}

                  {/* Earnings - Entitlement */}
                  <div className="col-span-2 font-semibold text-slate-500 mt-2 mb-0.5">Earnings (Entitlement)</div>
                  {[
                    ["Basic", sal.basic], ["HRA", sal.hra], ["Conv", sal.conv],
                    ["Bonus", sal.bonus], ["Portfolio", sal.portfolio],
                    ["Medical Allowance", sal.medicalAllowance],
                    ["Special Allowance", sal.specialAllowance],
                    ["Other Allowance", sal.otherAllowance],
                    ["LTA", sal.lta], ["Gross", sal.gross],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="flex justify-between">
                      <span className="text-slate-500">{l}</span>
                      <span className={`font-medium ${l === "Gross" ? "text-blue-700" : ""}`}>{fmt(Number(v))}</span>
                    </div>
                  ))}

                  {/* Earnings - Earned */}
                  <div className="col-span-2 font-semibold text-slate-500 mt-2 mb-0.5">Earnings (Pro-Rated / Earned)</div>
                  {[
                    ["Basic (Earned)", sal.basic1], ["HRA (Earned)", sal.hra1],
                    ["Conv (Earned)", sal.conv1], ["Bonus (Earned)", sal.bonus1],
                    ["Portfolio (Earned)", sal.portfolio1],
                    ["Medical Allw (Earned)", sal.medicalAllowance1],
                    ["Special Allw (Earned)", sal.specialAllowance1],
                    ["Other Allw (Earned)", sal.otherAllowance1],
                    ["Gross (Earned)", sal.gross1],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="flex justify-between">
                      <span className="text-slate-500">{l}</span>
                      <span className={`font-medium ${l === "Gross (Earned)" ? "text-emerald-700" : ""}`}>{fmt(Number(v))}</span>
                    </div>
                  ))}

                  {/* Additions */}
                  <div className="col-span-2 font-semibold text-slate-500 mt-2 mb-0.5">Additions</div>
                  {[
                    ["Incentive", sal.incentive], ["Extra Day Incentive", sal.extraDayIncentive],
                    ["Arrear", sal.arrear], ["PLI", sal.pli],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="flex justify-between">
                      <span className="text-slate-500">{l}</span>
                      <span className="font-medium">{fmt(Number(v))}</span>
                    </div>
                  ))}

                  {/* Deductions */}
                  <div className="col-span-2 font-semibold text-slate-500 mt-2 mb-0.5">Deductions</div>
                  {[
                    ["ESIC (Emp)", sal.esic], ["EPF (Emp)", sal.epf],
                    ["Prof Tax", sal.proTax], ["TDS", sal.tds],
                    ["Adv Paid", sal.advPaid], ["Loan Ded", sal.loanDed],
                    ["Leave Ded", sal.leaveDeduction], ["Total Deduction", sal.totalDeduction],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="flex justify-between">
                      <span className="text-slate-500">{l}</span>
                      <span className={`font-medium ${l === "Total Deduction" ? "text-red-600" : ""}`}>{fmt(Number(v))}</span>
                    </div>
                  ))}

                  {/* Net + Employer */}
                  <div className="col-span-2 mt-2 flex justify-between border-t pt-2">
                    <span className="font-bold text-slate-700">Net Salary</span>
                    <span className="font-bold text-emerald-700">{fmt(sal.netSalary)}</span>
                  </div>
                  <div className="col-span-2 font-semibold text-slate-500 mt-2 mb-0.5">Employer Costs</div>
                  {[
                    ["ESIC (Employer)", sal.esicCompany], ["EPF (Employer)", sal.epfCompany],
                    ["Admin Charges", sal.adminChrg], ["CTC", sal.ctc],
                  ].map(([l, v]) => (
                    <div key={String(l)} className="flex justify-between">
                      <span className="text-slate-500">{l}</span>
                      <span className="font-medium">{fmt(Number(v))}</span>
                    </div>
                  ))}
                  <div className="col-span-2 flex gap-3 mt-2">
                    <Badge variant="outline" className="text-xs">ESI: {sal.esiElig}</Badge>
                    <Badge variant="outline" className="text-xs">PF: {sal.pfElig}</Badge>
                  </div>
                </div>
              </section>
            )}

            {/* ── Day-wise Attendance ── */}
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Day-wise Attendance — September 2026</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="border px-2 py-1 text-left font-semibold text-slate-600 w-10">Day</th>
                      <th className="border px-2 py-1 text-left font-semibold text-slate-600 w-8">DoW</th>
                      <th className="border px-2 py-1 text-center font-semibold text-blue-700">db_bill Status</th>
                      <th className="border px-2 py-1 text-center font-semibold text-blue-600">In / Out</th>
                      <th className="border px-2 py-1 text-center font-semibold text-emerald-700">HRMS Status</th>
                      <th className="border px-2 py-1 text-center font-semibold text-emerald-600">Clock In / Out</th>
                      <th className="border px-2 py-1 text-center font-semibold text-slate-500">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dayWise.map(d => (
                      <tr
                        key={d.date}
                        className={
                          d.match === false
                            ? "bg-red-50"
                            : d.dayOfWeek === "Sun"
                            ? "bg-slate-50"
                            : ""
                        }
                      >
                        <td className="border px-2 py-1 font-medium">{d.day}</td>
                        <td className="border px-2 py-1 text-slate-400">{d.dayOfWeek}</td>
                        <td className="border px-2 py-1 text-center">
                          {d.dbbill ? statusBadge(d.dbbill.status) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="border px-2 py-1 text-center text-slate-500">
                          {d.dbbill?.intime || d.dbbill?.outtime
                            ? `${d.dbbill.intime ?? "—"} / ${d.dbbill.outtime ?? "—"}`
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="border px-2 py-1 text-center">
                          {d.hrms ? statusBadge(d.hrms.status) : <span className="text-slate-300">—</span>}
                          {d.hrms?.lateMark === 1 && (
                            <span className="ml-1 text-orange-500 text-[10px]">L</span>
                          )}
                          {Number(d.hrms?.lwp) > 0 && (
                            <span className="ml-1 text-red-500 text-[10px]">LWP</span>
                          )}
                        </td>
                        <td className="border px-2 py-1 text-center text-slate-500">
                          {d.hrms?.clockIn || d.hrms?.clockOut
                            ? `${d.hrms.clockIn ?? "—"} / ${d.hrms.clockOut ?? "—"}`
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="border px-2 py-1 text-center">
                          {d.match === null ? (
                            <span className="text-slate-300">—</span>
                          ) : d.match ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500 mx-auto" />
                          ) : (
                            <AlertCircle className="h-3 w-3 text-red-500 mx-auto" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SalaryAttendanceCompare() {
  const [month, setMonth] = useState("2026-09");
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedEmp, setSelectedEmp] = useState<string | null>(null);
  const limit = 50;

  const { data: branchData } = useQuery({
    queryKey: ["salary-att-compare-branches", month],
    queryFn: async () => {
      const r = await hrmsApi.get(`/payroll/salary-att-compare/branches?month=${month}`);
      return r.data.data as string[];
    },
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["salary-att-compare-list", month, search, branch, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        month,
        page: String(page),
        limit: String(limit),
        search,
        branch: branch === "all" ? "" : branch,
      });
      const r = await hrmsApi.get(`/payroll/salary-att-compare/list?${params}`);
      return r.data.data as ListResponse;
    },
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 1;

  const mismatchCount = useMemo(
    () => data?.employees.filter(e => Math.abs(e.attDiff) > 0).length ?? 0,
    [data],
  );

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-blue-600" />
              Salary &amp; Attendance Comparison
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              db_bill (legacy) vs HRMS — salary components + day-wise attendance
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-2">
          <Select value={month} onValueChange={v => { setMonth(v); setPage(1); }}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={branch} onValueChange={v => { setBranch(v); setPage(1); }}>
            <SelectTrigger className="w-48 h-8 text-sm">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {(branchData ?? []).map(b => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              className="pl-7 h-8 text-sm w-56"
              placeholder="Emp code or name…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-blue-100">
            <CardContent className="p-3 flex items-center gap-3">
              <Users className="h-8 w-8 text-blue-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Total Employees</p>
                <p className="text-xl font-bold text-slate-800">{data?.total.toLocaleString("en-IN") ?? "—"}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-orange-100">
            <CardContent className="p-3 flex items-center gap-3">
              <AlertCircle className="h-8 w-8 text-orange-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Att. Mismatches (page)</p>
                <p className="text-xl font-bold text-orange-600">{mismatchCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-emerald-100">
            <CardContent className="p-3 flex items-center gap-3">
              <IndianRupee className="h-8 w-8 text-emerald-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Total Net (page)</p>
                <p className="text-lg font-bold text-emerald-700">
                  {data
                    ? fmt(data.employees.reduce((s, e) => s + e.dbbill.netSalary, 0))
                    : "—"}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-purple-100">
            <CardContent className="p-3 flex items-center gap-3">
              <Calendar className="h-8 w-8 text-purple-500 shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Month</p>
                <p className="text-xl font-bold text-purple-700">{month}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Table ── */}
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <RefreshCw className="animate-spin mr-2 h-4 w-4" /> Loading salary data…
          </div>
        )}
        {error && (
          <div className="text-red-500 flex items-center gap-2 py-8 justify-center">
            <AlertCircle className="h-4 w-4" /> Failed to load data.
          </div>
        )}
        {data && (
          <>
            <div className="rounded-lg border overflow-x-auto shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 text-xs">
                    <TableHead className="w-28">Emp Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Branch</TableHead>
                    <TableHead className="hidden lg:table-cell">Cost Centre</TableHead>
                    <TableHead className="text-right">Working Days</TableHead>
                    <TableHead className="text-right">Earned Days</TableHead>
                    <TableHead className="text-right">Gross (Earned)</TableHead>
                    <TableHead className="text-right">Net Salary</TableHead>
                    <TableHead className="text-center">db_bill Att.</TableHead>
                    <TableHead className="text-center">HRMS Att.</TableHead>
                    <TableHead className="text-center">Diff</TableHead>
                    <TableHead className="text-center hidden sm:table-cell">ESI / PF</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.employees.map(emp => {
                    const hasMismatch = Math.abs(emp.attDiff) > 0;
                    return (
                      <TableRow
                        key={emp.empCode}
                        className={`text-xs cursor-pointer hover:bg-blue-50/50 ${hasMismatch ? "bg-orange-50/40" : ""}`}
                        onClick={() => setSelectedEmp(emp.empCode)}
                      >
                        <TableCell className="font-mono font-medium text-blue-700">{emp.empCode}</TableCell>
                        <TableCell>
                          <div className="font-medium text-slate-800 truncate max-w-[140px]">{emp.empName}</div>
                          <div className="text-slate-400 text-[10px] truncate">{emp.designation}</div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-slate-500 truncate max-w-[100px]">{emp.branch}</TableCell>
                        <TableCell className="hidden lg:table-cell text-slate-400 text-[10px] truncate max-w-[120px]">{emp.costCenter}</TableCell>
                        <TableCell className="text-right tabular-nums">{emp.dbbill.workingDays}</TableCell>
                        <TableCell className="text-right tabular-nums">{emp.dbbill.earnedDays}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-emerald-700">{fmt(emp.dbbill.gross1)}</TableCell>
                        <TableCell className="text-right tabular-nums font-bold text-slate-800">{fmt(emp.dbbill.netSalary)}</TableCell>
                        <TableCell className="text-center tabular-nums">
                          <Badge variant="outline" className="text-blue-700 border-blue-200 bg-blue-50 text-[10px] px-1.5">
                            {emp.dbbill.attPresent}P / {emp.dbbill.attAbsent}A
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {emp.hrms.attTotalRecords > 0 ? (
                            <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50 text-[10px] px-1.5">
                              {emp.hrms.attPresent}P / {emp.hrms.attAbsent}A
                            </Badge>
                          ) : (
                            <span className="text-slate-300 text-[10px]">No data</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {emp.attDiff === 0 ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mx-auto" />
                          ) : (
                            <span className={`text-xs font-bold ${emp.attDiff > 0 ? "text-orange-600" : "text-red-600"}`}>
                              {emp.attDiff > 0 ? "+" : ""}{emp.attDiff}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center hidden sm:table-cell">
                          <div className="flex gap-1 justify-center text-[10px]">
                            <Badge variant="outline" className={`px-1 ${emp.esiElig === "YES" ? "border-green-300 text-green-700" : "text-slate-400"}`}>
                              ESI {emp.esiElig === "YES" ? "✓" : "✗"}
                            </Badge>
                            <Badge variant="outline" className={`px-1 ${emp.pfElig === "YES" ? "border-green-300 text-green-700" : "text-slate-400"}`}>
                              PF {emp.pfElig === "YES" ? "✓" : "✗"}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* ── Pagination ── */}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of{" "}
                {data.total.toLocaleString("en-IN")} employees
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm" variant="outline" className="h-7 px-2"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-2 py-1 bg-slate-100 rounded text-slate-700">
                  {page} / {totalPages}
                </span>
                <Button
                  size="sm" variant="outline" className="h-7 px-2"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <EmployeeDetailDrawer
        empCode={selectedEmp}
        month={month}
        onClose={() => setSelectedEmp(null)}
      />
    </DashboardLayout>
  );
}
