import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { EmployeeSalaryDetailSheet } from "@/components/payroll/EmployeeSalaryDetailSheet";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Download,
  Search,
  RefreshCw,
  Flag,
  ChevronRight,
} from "lucide-react";

// Backend snake_case response shapes
interface VerifyRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  designation_name?: string;
  process_name?: string;
  branch_name?: string;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  flag_count: number;
  verification_status: "pending" | "verified" | "flagged";
  is_estimate: boolean;
}

interface VerifyRegisterResponse {
  success: boolean;
  month: string;
  run_id: string | null;
  is_estimate: boolean;
  data: VerifyRow[];
  total: number;
  page: number;
  limit: number;
}

interface SummaryResponse {
  success: boolean;
  total: number;
  verified: number;
  flagged: number;
  open_flags: number;
  pending: number;
  salary_verification_done: boolean;
}

interface ProcessOption {
  process_id: string;
  process_name: string;
  branch_id: string;
  branch_name: string;
}

interface ProcessListResponse {
  success: boolean;
  data: ProcessOption[];
}

type VerifyFilter = "all" | "pending" | "verified" | "flagged";

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function getISTMonth(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ProcessSalaryVerify() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();

  const [month, setMonth] = useState(getISTMonth());
  const [selectedProcessId, setSelectedProcessId] = useState<string>("");
  const [filter, setFilter] = useState<VerifyFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const canBulkVerify = roleKeys.some((r) =>
    ["wfm", "process_manager", "branch_head", "super_admin", "admin"].includes(r)
  );

  const { data: processListResp } = useQuery<ProcessListResponse>({
    queryKey: ["salary-verify-processes", month],
    queryFn: () => hrmsApi.get<ProcessListResponse>(`/api/payroll/salary-verification/processes?month=${month}`),
    staleTime: 5 * 60 * 1000,
  });
  const processOptions = processListResp?.data ?? [];

  const effectiveProcessId = selectedProcessId || processOptions[0]?.process_id || "";
  const effectiveProcess = processOptions.find((p) => p.process_id === effectiveProcessId);

  const { data: registerResp, isLoading: registerLoading, refetch } = useQuery<VerifyRegisterResponse>({
    queryKey: ["salary-verify-register", month, effectiveProcessId],
    queryFn: () =>
      hrmsApi.get<VerifyRegisterResponse>(
        `/api/payroll/salary-verification/employees?month=${month}${effectiveProcessId ? `&processId=${effectiveProcessId}` : ""}`
      ),
    staleTime: 2 * 60 * 1000,
  });

  const { data: summary } = useQuery<SummaryResponse>({
    queryKey: ["salary-verify-summary", month, effectiveProcessId],
    queryFn: () =>
      hrmsApi.get<SummaryResponse>(
        `/api/payroll/salary-verification/summary?month=${month}${effectiveProcessId ? `&processId=${effectiveProcessId}` : ""}`
      ),
    staleTime: 2 * 60 * 1000,
  });

  const bulkVerifyMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/payroll/salary-verification/verify-bulk", {
        runMonth: month,
        processId: effectiveProcessId || undefined,
        branchId: effectiveProcess?.branch_id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-verify-register", month] });
      qc.invalidateQueries({ queryKey: ["salary-verify-summary", month] });
    },
  });

  const rows = registerResp?.data ?? [];

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === "pending") r = r.filter((x) => x.verification_status === "pending");
    else if (filter === "verified") r = r.filter((x) => x.verification_status === "verified");
    else if (filter === "flagged") r = r.filter((x) => x.verification_status === "flagged");
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (x) =>
          x.full_name.toLowerCase().includes(q) ||
          x.employee_code.toLowerCase().includes(q)
      );
    }
    return r;
  }, [rows, filter, search]);

  const exportUrl = `/api/payroll/salary-verification/export?month=${month}${effectiveProcessId ? `&processId=${effectiveProcessId}` : ""}&format=xlsx`;

  const allNonFlaggedCount = rows.filter(
    (r) => r.verification_status === "pending"
  ).length;

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-violet-700 to-indigo-800 text-white px-6 py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">Salary Verification Register</h1>
              <p className="text-violet-200 text-sm mt-0.5">
                Review and verify employee salary details before payroll sign-off
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="bg-white/10 border-white/30 text-white hover:bg-white/20"
                onClick={() => refetch()}
              >
                <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
              </Button>
              <a
                href={exportUrl}
                download={`salary-verify-${month}.xlsx`}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-white/10 border border-white/30 text-white hover:bg-white/20 transition-colors"
              >
                <Download className="h-4 w-4" /> Export
              </a>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-36 bg-white/10 border-white/30 text-white [color-scheme:dark]"
            />
            {processOptions.length > 1 && (
              <Select value={effectiveProcessId} onValueChange={setSelectedProcessId}>
                <SelectTrigger className="w-52 bg-white/10 border-white/30 text-white">
                  <SelectValue placeholder="Select process…" />
                </SelectTrigger>
                <SelectContent>
                  {processOptions.map((p) => (
                    <SelectItem key={p.process_id} value={p.process_id}>
                      {p.process_name} — {p.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total",    val: summary?.total    ?? 0, color: "text-slate-700",   bg: "bg-slate-50 border-slate-200",    icon: "👥" },
            { label: "Verified", val: summary?.verified ?? 0, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: "✓"  },
            { label: "Flagged",  val: summary?.flagged  ?? 0, color: "text-amber-700",   bg: "bg-amber-50 border-amber-200",    icon: "⚑"  },
            { label: "Pending",  val: summary?.pending  ?? 0, color: "text-red-700",     bg: "bg-red-50 border-red-200",        icon: "○"  },
          ].map(({ label, val, color, bg }) => (
            <div key={label} className={`rounded-xl border ${bg} px-4 py-3 transition-all duration-150 hover:shadow-sm`}>
              <div className={`text-2xl font-bold ${color}`}>{val}</div>
              <div className="text-sm text-slate-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Verification progress strip */}
        {(summary?.total ?? 0) > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white/95 px-5 py-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Verification Progress</p>
              <p className="text-sm font-bold text-slate-900">
                {summary?.verified ?? 0} / {summary?.total ?? 0}
                <span className="text-xs font-normal text-slate-500 ml-1">
                  ({Math.round(((summary?.verified ?? 0) / Math.max(summary?.total ?? 1, 1)) * 100)}% complete)
                </span>
              </p>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
              {(summary?.verified ?? 0) > 0 && (
                <div
                  className="h-full bg-emerald-500 transition-all duration-700"
                  style={{ width: `${Math.round(((summary?.verified ?? 0) / Math.max(summary?.total ?? 1, 1)) * 100)}%` }}
                />
              )}
              {(summary?.flagged ?? 0) > 0 && (
                <div
                  className="h-full bg-amber-400 transition-all duration-700"
                  style={{ width: `${Math.round(((summary?.flagged ?? 0) / Math.max(summary?.total ?? 1, 1)) * 100)}%` }}
                />
              )}
            </div>
            <div className="flex items-center gap-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Verified</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Flagged</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />Pending</span>
              {summary?.salary_verification_done && (
                <span className="ml-auto flex items-center gap-1 font-semibold text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Ready for Sign-off
                </span>
              )}
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search employee…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-56"
              />
            </div>
            <div className="flex rounded-lg border overflow-hidden text-sm">
              {(["all", "pending", "verified", "flagged"] as VerifyFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 capitalize transition-colors ${
                    filter === f
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {canBulkVerify && allNonFlaggedCount > 0 && (
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={bulkVerifyMutation.isPending}
              onClick={() => bulkVerifyMutation.mutate()}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              {bulkVerifyMutation.isPending
                ? "Verifying…"
                : `Verify All Non-Flagged (${allNonFlaggedCount})`}
            </Button>
          )}
        </div>

        {/* Register table */}
        <div className="rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Employee</TableHead>
                <TableHead>Process</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Deductions</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
                <TableHead className="text-center">Flags</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {registerLoading &&
                [...Array(6)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(8)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

              {!registerLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-slate-500">
                    No employees match the current filter.
                  </TableCell>
                </TableRow>
              )}

              {filtered.map((row) => (
                <TableRow
                  key={row.employee_id}
                  className={`cursor-pointer transition-colors ${
                    row.verification_status === "flagged"
                      ? "border-l-4 border-l-amber-400 hover:bg-amber-50/40"
                      : row.verification_status === "verified"
                        ? "border-l-4 border-l-emerald-400 hover:bg-emerald-50/20"
                        : "border-l-4 border-l-transparent hover:bg-indigo-50/40"
                  }`}
                  onClick={() => {
                    setSelectedEmployeeId(row.employee_id);
                    setSheetOpen(true);
                  }}
                >
                  <TableCell>
                    <div className="font-medium text-slate-800">{row.full_name}</div>
                    <div className="text-xs text-slate-500">{row.employee_code}</div>
                    {row.designation_name && (
                      <div className="text-xs text-slate-400">{row.designation_name}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-slate-700">{row.process_name}</div>
                    <div className="text-xs text-slate-400">{row.branch_name}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-slate-700">
                    ₹{fmt(row.gross_salary)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-red-700">
                    ₹{fmt(row.total_deductions)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold text-emerald-800">
                    ₹{fmt(row.net_salary)}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.flag_count > 0 ? (
                      <Badge className="bg-amber-100 text-amber-700 gap-1">
                        <Flag className="h-3 w-3" /> {row.flag_count}
                      </Badge>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {row.verification_status === "verified" ? (
                      <Badge className="bg-emerald-100 text-emerald-700 gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Done
                      </Badge>
                    ) : row.verification_status === "flagged" ? (
                      <Badge className="bg-amber-50 text-amber-600 gap-1">
                        <AlertTriangle className="h-3 w-3" /> Flagged
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-500 gap-1">
                        <Clock className="h-3 w-3" /> Pending
                      </Badge>
                    )}
                    {row.is_estimate && (
                      <div className="text-[10px] text-slate-400 mt-0.5">Estimate</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <EmployeeSalaryDetailSheet
        employeeId={selectedEmployeeId}
        month={month}
        runId={registerResp?.run_id ?? undefined}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        roleKeys={roleKeys}
        processId={effectiveProcessId || undefined}
        branchId={effectiveProcess?.branch_id}
      />
    </DashboardLayout>
  );
}
