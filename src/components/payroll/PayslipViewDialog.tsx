import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Minus, TrendingUp, TrendingDown, Minus as Flat } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEmployeeSalaryHistoryByCode } from "@/hooks/usePayroll";

interface PayrollRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employee: {
    name: string;
    email: string;
    avatar?: string;
  };
  month: string;
  monthNum: number;
  year: number;
  basic: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  status: "paid" | "pending" | "processing";
  paidAt?: string;
  designation?: string;
  department?: string;
  branch?: string;
  process?: string;
}

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

export function PayslipViewDialog({ open, onOpenChange, record }: PayslipViewDialogProps) {
  const { data: salaryStructure, isLoading } = useQuery({
    queryKey: ["salary-structure-view", record?.employeeId],
    queryFn: async () => {
      if (!record?.employeeId) return null;
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/payroll/structures");
      return res.data ?? null;
    },
    enabled: !!record?.employeeId && open,
  });

  const { data: salaryHistory = [], isLoading: historyLoading } = useEmployeeSalaryHistoryByCode(
    open ? record?.employeeCode : null
  );

  if (!record) return null;

  const getAllowanceBreakdown = () => {
    if (!salaryStructure) return [];
    const items = [];
    if (salaryStructure.hra) items.push({ label: "House Rent Allowance (HRA)", amount: Number(salaryStructure.hra) });
    if (salaryStructure.transport_allowance) items.push({ label: "Transport Allowance", amount: Number(salaryStructure.transport_allowance) });
    if (salaryStructure.medical_allowance) items.push({ label: "Medical Allowance", amount: Number(salaryStructure.medical_allowance) });
    if (salaryStructure.other_allowances) items.push({ label: "Other Allowances", amount: Number(salaryStructure.other_allowances) });
    return items;
  };

  const getDeductionBreakdown = () => {
    if (!salaryStructure) return [];
    const items = [];
    if (salaryStructure.tax_deduction) items.push({ label: "Tax Deduction", amount: Number(salaryStructure.tax_deduction) });
    if (salaryStructure.other_deductions) items.push({ label: "Other Deductions", amount: Number(salaryStructure.other_deductions) });
    return items;
  };

  const allowanceBreakdown = getAllowanceBreakdown();
  const deductionBreakdown = getDeductionBreakdown();
  const grossSalary = record.basic + record.allowances;

  // MoM delta — compare this record's month against the previous one in history
  const thisRunMonth = `${record.year}-${String(record.monthNum).padStart(2, "0")}`;
  const thisIdx = salaryHistory.findIndex((h) => h.runMonth === thisRunMonth);
  const prevPoint = thisIdx > 0 ? salaryHistory[thisIdx - 1] : null;
  const momDelta = prevPoint ? record.netSalary - prevPoint.netSalary : null;
  const momPct = prevPoint && prevPoint.netSalary > 0 ? (momDelta! / prevPoint.netSalary) * 100 : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Payslip — {record.month} {record.year}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Employee Details */}
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

          {isLoading ? (
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
                      {allowanceBreakdown.length > 0 ? (
                        allowanceBreakdown.map((item) => (
                          <tr key={item.label} className="border-b">
                            <td className="py-1.5 text-muted-foreground">{item.label}</td>
                            <td className="py-1.5 text-right font-mono font-semibold text-emerald-600">+{fmt(item.amount)}</td>
                          </tr>
                        ))
                      ) : (
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
                      {deductionBreakdown.length > 0 && deductionBreakdown.map((item) => (
                        <tr key={item.label} className="border-b">
                          <td className="py-1.5 text-muted-foreground">{item.label}</td>
                          <td className="py-1.5 text-right font-mono font-semibold text-destructive">-{fmt(item.amount)}</td>
                        </tr>
                      ))}
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

          {/* Net Salary */}
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

          {/* Salary Trend */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Salary Trend</p>
                <p className="text-xs text-slate-500 mt-0.5">Net salary across all processed months for this employee</p>
              </div>
              {salaryHistory.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {salaryHistory.length} month{salaryHistory.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {historyLoading ? (
              <Skeleton className="h-[160px] w-full rounded-xl" />
            ) : salaryHistory.length < 2 ? (
              <div className="flex h-[100px] items-center justify-center text-sm text-slate-400">
                {salaryHistory.length === 0 ? "No history available" : "Only one month on record — trend available from two months"}
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

                {/* Compact monthly table */}
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
