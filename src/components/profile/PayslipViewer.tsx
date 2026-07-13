import { Fragment, type ReactNode, useEffect, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  FileText,
  Minus,
  Plus,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { downloadMasCallnetPayslip } from "@/lib/masCallnetPayslipGeneratorV2";
import { numberToWords } from "@/lib/numberToWords";

interface PayslipViewerProps {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
}

interface SalaryStructure {
  basic_salary: number;
  hra: number | null;
  transport_allowance: number | null;
  medical_allowance: number | null;
  other_allowances: number | null;
  tax_deduction: number | null;
  other_deductions: number | null;
}

interface PayslipComponent {
  component_code: string;
  component_name: string;
  component_type: string;
  amount: number | string;
  taxable?: number;
}

interface PayslipRecord {
  id: string;
  run_month: string;
  run_status?: string;
  status?: string;
  gross_salary: number | string;
  total_deductions: number | string;
  net_salary: number | string;
  basic?: number | string;
  basic_salary?: number | string;
  hra?: number | string;
  special_allowance?: number | string;
  pf_employee?: number | string;
  esic_employee?: number | string;
  professional_tax?: number | string;
  tds?: number | string;
  lwp_deduction?: number | string;
  advance_recovery?: number | string;
  pf_employer?: number | string;
  esic_employer?: number | string;
  working_days?: number | string;
  present_days?: number | string;
  lwp_days?: number | string;
  designation_name?: string | null;
  dept_name?: string | null;
  branch_name?: string | null;
  location_name?: string | null;
  epf_number?: string | null;
  uan_number?: string | null;
  pan_number?: string | null;
  bank_account_masked?: string | null;
  esi_number?: string | null;
  payslip_ref?: string | null;
  cheque_no?: string | null;
  payment_mode?: string | null;
  payment_date?: string | null;
  earnings?: PayslipComponent[];
  deductions?: PayslipComponent[];
}

const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => ({
  value: String(currentYear - i),
  label: String(currentYear - i),
}));

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
};

const getStatusBadge = (status: string) => {
  const normalizedStatus = (status || "").toLowerCase().trim();
  switch (normalizedStatus) {
    case "paid":
    case "credited":
    case "disbursed":
      return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Paid</Badge>;
    case "processed":
    case "approved":
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Processed</Badge>;
    case "draft":
    case "pending":
      return <Badge variant="secondary">Draft</Badge>;
    default:
      // If status is not recognized but payslip has data, show as Processed
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Processed</Badge>;
  }
};

export function PayslipViewer({ employeeId, employeeName, employeeCode }: PayslipViewerProps) {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState(String(currentDate.getFullYear()));
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [showNewPayslipAlert, setShowNewPayslipAlert] = useState(false);
  const [salaryVisible, setSalaryVisible] = useState(false);

  // Fetch employee CTC
  const { data: employeeData } = useQuery<{ ctc: number | null }>({
    queryKey: ["employee-ctc", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: { ctc: number | null } }>(
        `/api/employees/${employeeId}/ctc`
      );
      return res.data ?? { ctc: null };
    },
    enabled: !!employeeId,
  });

  const renderSensitive = (value: ReactNode, className = "") => (
    <>
      <span
        aria-hidden={!salaryVisible}
        className={`${className} inline-block ${
          salaryVisible ? "" : "select-none blur-[6px]"
        }`}
      >
        {salaryVisible ? value : "₹ 00,000.00"}
      </span>
      {!salaryVisible && <span className="sr-only">Salary amount hidden</span>}
    </>
  );

  const handleYearChange = (year: string) => {
    setSelectedYear(year);
    setSalaryVisible(false);
    setExpandedRecord(null);
  };

  // Fetch payroll records for the employee
  const { data: payrollRecords, isLoading, isError } = useQuery<PayslipRecord[]>({
    queryKey: ["my-payslips", employeeId, selectedYear],
    queryFn: async () => {
      if (!employeeId) return [];
      const res = await hrmsApi.get<{ success: boolean; data: PayslipRecord[] }>(
        `/api/payroll/payslip/my?year=${selectedYear}`
      );
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });

  // Check for new payslips and show alert
  useEffect(() => {
    if (payrollRecords && payrollRecords.length > 0) {
      const latestRecord = payrollRecords[0];
      const viewedKey = `payslip-viewed-${latestRecord.id}`;
      const hasViewed = localStorage.getItem(viewedKey);

      // Show alert if payslip is paid/processed and not yet viewed
      if ((latestRecord.run_status === 'paid' || latestRecord.run_status === 'processed') && !hasViewed) {
        setShowNewPayslipAlert(true);
      }
    }
  }, [payrollRecords]);

  const handleDismissAlert = (recordId: string) => {
    localStorage.setItem(`payslip-viewed-${recordId}`, 'true');
    setShowNewPayslipAlert(false);
  };

  // Derive salary structure from the most recent payslip record with component breakdown
  const salaryStructure: SalaryStructure | null = payrollRecords && payrollRecords.length > 0
    ? {
        basic_salary: Number(payrollRecords[0].basic ?? 0),
        hra: payrollRecords[0].hra != null ? Number(payrollRecords[0].hra) : null,
        transport_allowance: null,
        medical_allowance: null,
        other_allowances: payrollRecords[0].special_allowance != null ? Number(payrollRecords[0].special_allowance) : null,
        tax_deduction: payrollRecords[0].tds != null ? Number(payrollRecords[0].tds) : null,
        other_deductions: (() => {
          const pf = Number(payrollRecords[0].pf_employee ?? 0);
          const esic = Number(payrollRecords[0].esic_employee ?? 0);
          const pt = Number(payrollRecords[0].professional_tax ?? 0);
          return (pf + esic + pt) > 0 ? (pf + esic + pt) : null;
        })(),
      }
    : null;

  const getAllowanceBreakdown = () => {
    if (!payrollRecords || payrollRecords.length === 0) return [];
    const latestRecord = payrollRecords[0];

    // Use component breakdown if available, otherwise fall back to aggregated columns
    if (latestRecord.earnings && latestRecord.earnings.length > 0) {
      const hasPerTypeIncentives = latestRecord.earnings.some((c) => c.component_code.startsWith("INCEN_"));
      return latestRecord.earnings
        .filter((component) => {
          if (component.component_code === "BASIC") return false;
          if (hasPerTypeIncentives && component.component_code === "INCENTIVE") return false;
          if (Number(component.amount) === 0) return false;
          return true;
        })
        .map((component) => ({
          label: component.component_name,
          amount: Number(component.amount ?? 0),
        }));
    }

    // Fallback to old structure
    const items = [];
    if (salaryStructure?.hra) items.push({ label: "House Rent Allowance (HRA)", amount: salaryStructure.hra });
    if (salaryStructure?.transport_allowance) items.push({ label: "Transport Allowance", amount: salaryStructure.transport_allowance });
    if (salaryStructure?.medical_allowance) items.push({ label: "Medical Allowance", amount: salaryStructure.medical_allowance });
    if (salaryStructure?.other_allowances) items.push({ label: "Other Allowances", amount: salaryStructure.other_allowances });
    return items;
  };

  const getDeductionBreakdown = () => {
    if (!payrollRecords || payrollRecords.length === 0) return [];
    const latestRecord = payrollRecords[0];

    // Use component breakdown if available
    if (latestRecord.deductions && latestRecord.deductions.length > 0) {
      return latestRecord.deductions
        .filter((component) => Number(component.amount) > 0)
        .map((component) => ({
          label: component.component_name,
          amount: Number(component.amount ?? 0),
        }));
    }

    // Fallback to old structure
    const items = [];
    if (salaryStructure?.tax_deduction) items.push({ label: "Tax Deduction", amount: salaryStructure.tax_deduction });
    if (salaryStructure?.other_deductions) items.push({ label: "Other Deductions", amount: salaryStructure.other_deductions });
    return items;
  };

  const handleDownloadPayslip = async (record: PayslipRecord) => {
    // run_month is "YYYY-MM" format
    const [recYear, recMonthNum] = (record.run_month || "").split("-");
    const monthName = MONTHS.find((m) => m.value === String(Number(recMonthNum)))?.label || record.run_month || "";

    // Helper to get component amount by code (case-insensitive)
    const getEarning = (code: string) => {
      const comp = (record.earnings || []).find((e) => e.component_code.toUpperCase() === code.toUpperCase());
      return Number(comp?.amount ?? 0);
    };
    const getDeduction = (code: string) => {
      const comp = (record.deductions || []).find((d) => d.component_code.toUpperCase() === code.toUpperCase());
      return Number(comp?.amount ?? 0);
    };

    // Earnings — component array with flat-field fallback
    const basic = getEarning('BASIC') || Number(record.basic ?? record.basic_salary ?? 0);
    const hra = getEarning('HRA') || Number(record.hra ?? 0);
    const bonus = getEarning('BONUS');
    const conv = getEarning('CONVEYANCE') || getEarning('CONV');
    const pa = getEarning('PA') || getEarning('PERSONAL_ALLOWANCE');
    const ma = getEarning('MA') || getEarning('MEDICAL_ALLOWANCE');
    const sa = getEarning('SPECIAL') || getEarning('SPECIAL_ALLOWANCE');
    const arrear = getEarning('ARREAR');
    const incentive = getEarning('INCENTIVE');
    const knownEarnings = basic + hra + bonus + conv + pa + ma + sa + arrear + incentive;
    const oa = Math.max(Number(record.gross_salary ?? 0) - knownEarnings, 0);

    // Deductions — component array with flat-field fallback
    const pf = getDeduction('PF_EMPLOYEE') || getDeduction('PF_EMP') || Number(record.pf_employee ?? 0);
    const esic = getDeduction('ESIC_EMPLOYEE') || getDeduction('ESIC_EMP') || Number(record.esic_employee ?? 0);
    const pt = getDeduction('PROFESSIONAL_TAX') || getDeduction('PT') || Number(record.professional_tax ?? 0);
    const tds = getDeduction('TDS') || Number(record.tds ?? 0);
    const loan = getDeduction('LOAN') || getDeduction('LOAN_RECOVERY');
    const adDed = getDeduction('ADVANCE') || getDeduction('ADVANCE_RECOVERY') || Number(record.advance_recovery ?? 0);
    // LWP is already reflected in reduced gross (pro-rata), not a cash deduction from net
    const knownDeductions = pf + esic + pt + tds + loan + adDed;
    const otherDed = Math.max(Number(record.total_deductions ?? 0) - knownDeductions, 0);

    await downloadMasCallnetPayslip({
      companyName: "Mas Callnet India Pvt Ltd",
      monthYear: `${monthName} - ${recYear}`,
      empName: employeeName,
      empCode: employeeCode,
      designation: record.designation_name || "N/A",
      department: record.dept_name || "N/A",
      epfNo: record.epf_number || "",
      uanNo: record.uan_number || "",
      panNo: record.pan_number || "",
      bankAccount: record.bank_account_masked || "",
      location: record.branch_name || record.location_name || "N/A",
      esiNo: record.esi_number || "",
      wDays: Number(record.working_days ?? 30),
      earnedDays: Number(record.present_days ?? record.working_days ?? 30),
      lwpDays: Number(record.lwp_days ?? 0),
      totalDaysInMonth: Number(record.working_days ?? 30),
      basic, hra, bonus, conv, pa, ma, sa, oa, arrear, incentive,
      pf, esic, pt, tds, lwpDeduction: 0, loan, adDed, otherDed,
      employerPf: Number(record.pf_employer ?? 0),
      employerEsic: Number(record.esic_employer ?? 0),
      grossSalary: Number(record.gross_salary ?? 0),
      incomeTax: tds,
      chequeNo: record.cheque_no || "",
      paymentMode: record.payment_mode || "",
      paymentDate: record.payment_date || "",
      netSalary: Number(record.net_salary ?? 0),
      netSalaryWords: numberToWords(Math.floor(Number(record.net_salary ?? 0))),
    }, `Payslip_${employeeCode}_${monthName}_${recYear}.pdf`);
  };

  const allowanceBreakdown = getAllowanceBreakdown();
  const deductionBreakdown = getDeductionBreakdown();
  const latestRecord = payrollRecords?.[0];
  const latestGross = Number(latestRecord?.gross_salary ?? 0);
  const latestDeductions = Number(latestRecord?.total_deductions ?? 0);
  const latestNet = Number(latestRecord?.net_salary ?? 0);

  return (
    <Card className="overflow-hidden border-0 bg-transparent shadow-none">
      <CardHeader className="rounded-3xl bg-[#073f78] px-6 py-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-white/15">
              <Wallet className="size-6 text-green-200" />
            </div>
            <div>
              <CardTitle className="text-2xl font-black text-white">My Payslips</CardTitle>
              <CardDescription className="mt-1 text-sm text-blue-100">
                Salary summary, statutory deductions and downloadable statements
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              className="rounded-xl border border-white/20 bg-white/15 font-bold text-white hover:bg-white/25 hover:text-white"
              onClick={() => setSalaryVisible((visible) => !visible)}
              aria-pressed={salaryVisible}
            >
              {salaryVisible ? <EyeOff className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
              {salaryVisible ? "Hide salary" : "View salary"}
            </Button>
            <Select value={selectedYear} onValueChange={handleYearChange}>
              <SelectTrigger className="w-[140px] rounded-xl border-white/20 bg-white text-slate-900">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((year) => (
                  <SelectItem key={year.value} value={year.value}>
                    {year.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 px-0 pt-6">
        {/* CTC Card - Prominent Display */}
        {employeeData?.ctc && (
          <Card className="rounded-3xl border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 shadow-md">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-800">
                    <TrendingUp className="size-4" />
                    Annual CTC (Cost to Company)
                  </div>
                  <p className="mt-2 text-3xl font-black tabular-nums text-amber-900">
                    {renderSensitive(formatCurrency(employeeData.ctc))}
                  </p>
                  <p className="mt-1 text-xs text-amber-700">
                    Monthly: {renderSensitive(formatCurrency(employeeData.ctc / 12))}
                  </p>
                </div>
                <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-200/50">
                  <Wallet className="size-8 text-amber-700" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            {
              label: "Latest gross salary",
              value: latestRecord ? formatCurrency(latestGross) : "Not available",
              icon: Plus,
              tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
            },
            {
              label: "Total deductions",
              value: latestRecord ? formatCurrency(latestDeductions) : "Not available",
              icon: Minus,
              tone: "border-rose-200 bg-rose-50 text-rose-800",
            },
            {
              label: "Net salary",
              value: latestRecord ? formatCurrency(latestNet) : "Not available",
              icon: Wallet,
              tone: "border-blue-200 bg-blue-50 text-[#073f78]",
            },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className={`rounded-2xl border p-5 shadow-sm ${tone}`}>
              <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider">
                <Icon className="size-4" />
                {label}
              </div>
              <p className="mt-3 text-xl font-black tabular-nums">{renderSensitive(value)}</p>
            </div>
          ))}
        </section>

        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 shrink-0 text-[#1B6AB5]" />
            <p className="text-pretty">
              Salary values are hidden by default for shoulder-surfing protection. Use View salary only in a private setting.
            </p>
          </div>
          <div className="flex items-center gap-2 font-bold text-slate-700">
            <CalendarCheck className="size-4 text-[#3BAD49]" />
            {payrollRecords?.length ?? 0} statement{payrollRecords?.length === 1 ? "" : "s"} in {selectedYear}
          </div>
        </div>

        {isError && (
          <Alert variant="destructive" className="rounded-2xl">
            <FileText className="h-4 w-4" />
            <AlertTitle>Payslips could not be loaded</AlertTitle>
            <AlertDescription>
              Please retry. Contact payroll support if the issue continues.
            </AlertDescription>
          </Alert>
        )}

        {/* New Payslip Alert */}
        {showNewPayslipAlert && payrollRecords && payrollRecords.length > 0 && (
          <Alert className="rounded-2xl border-blue-200 bg-blue-50">
            <Download className="h-4 w-4" />
            <AlertTitle>New Payslip Available!</AlertTitle>
            <AlertDescription className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Your salary for {(() => {
                  const [, monthNum] = (payrollRecords[0].run_month || "").split("-");
                  return MONTHS.find((m) => m.value === String(Number(monthNum)))?.label || "";
                })()} has been disbursed.
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    handleDownloadPayslip(payrollRecords[0]);
                    handleDismissAlert(payrollRecords[0].id);
                  }}
                  size="sm"
                  className="rounded-xl bg-[#073f78] hover:bg-[#0a4d90]"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download Now
                </Button>
                <Button
                  onClick={() => handleDismissAlert(payrollRecords[0].id)}
                  variant="outline"
                  size="sm"
                >
                  Dismiss
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Salary Structure Breakdown Card */}
        {salaryStructure && (
          <Card className="rounded-3xl border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-black text-slate-950">Current salary breakdown</CardTitle>
              <CardDescription>Earnings and deductions from your latest processed statement</CardDescription>
              {latestRecord?.designation_name && (
                <p className="mt-1 text-xs text-slate-500">
                  <span className="font-semibold">Designation:</span> {latestRecord.designation_name}
                  {latestRecord.dept_name ? ` · ${latestRecord.dept_name}` : ""}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2">
                {/* Earnings */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-600">
                    <Plus className="h-4 w-4" />
                    <span className="font-semibold">Earnings</span>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
                    <table className="w-full text-sm">
                      <tbody>
                        <tr className="border-b border-emerald-100">
                          <td className="py-1.5 text-muted-foreground">Basic Salary</td>
                          <td className="py-1.5 text-right font-mono font-semibold">
                            {renderSensitive(formatCurrency(salaryStructure.basic_salary))}
                          </td>
                        </tr>
                        {allowanceBreakdown.map((item) => (
                          <tr key={item.label} className="border-b border-emerald-100">
                            <td className="py-1.5 text-muted-foreground">{item.label}</td>
                            <td className="py-1.5 text-right font-mono font-semibold text-green-600">
                              {renderSensitive(`+${formatCurrency(item.amount)}`)}
                            </td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td className="py-1.5">Gross Salary</td>
                          <td className="py-1.5 text-right font-mono">
                            {renderSensitive(
                              payrollRecords && payrollRecords.length > 0
                                ? formatCurrency(Number(payrollRecords[0].gross_salary ?? 0))
                                : formatCurrency(
                                    salaryStructure.basic_salary +
                                      (salaryStructure.hra || 0) +
                                      (salaryStructure.transport_allowance || 0) +
                                      (salaryStructure.medical_allowance || 0) +
                                      (salaryStructure.other_allowances || 0)
                                  )
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Deductions */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-red-600">
                    <Minus className="h-4 w-4" />
                    <span className="font-semibold">Deductions</span>
                  </div>
                  <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4">
                    {deductionBreakdown.length > 0 ? (
                      <table className="w-full text-sm">
                        <tbody>
                          {deductionBreakdown.map((item) => (
                            <tr key={item.label} className="border-b border-rose-100">
                              <td className="py-1.5 text-muted-foreground">{item.label}</td>
                              <td className="py-1.5 text-right font-mono font-semibold text-red-600">
                                {renderSensitive(`-${formatCurrency(item.amount)}`)}
                              </td>
                            </tr>
                          ))}
                          <tr className="font-semibold">
                            <td className="py-1.5">Total Deductions</td>
                            <td className="py-1.5 text-right font-mono text-red-600">
                              {renderSensitive(`-${formatCurrency(Number(payrollRecords?.[0]?.total_deductions ?? 0))}`)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-muted-foreground text-sm">No deductions configured</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Net Salary */}
              <div className="mt-5 rounded-2xl border-2 border-blue-200 bg-blue-50 p-5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-lg">Net Salary (Monthly)</span>
                  <span className="text-2xl font-black tabular-nums text-[#073f78]">
                    {renderSensitive(
                      payrollRecords && payrollRecords.length > 0
                        ? formatCurrency(Number(payrollRecords[0].net_salary ?? 0))
                        : formatCurrency(
                            salaryStructure.basic_salary +
                              (salaryStructure.hra || 0) +
                              (salaryStructure.transport_allowance || 0) +
                              (salaryStructure.medical_allowance || 0) +
                              (salaryStructure.other_allowances || 0) -
                              (salaryStructure.tax_deduction || 0) -
                              (salaryStructure.other_deductions || 0)
                          )
                    )}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payslip History */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : payrollRecords && payrollRecords.length > 0 ? (
          <div className="space-y-3">
            <div>
              <h3 className="text-lg font-black text-slate-950">Payslip history</h3>
              <p className="mt-1 text-sm text-slate-500">
                Select a month to inspect earnings and deductions before downloading.
              </p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Basic Salary</TableHead>
                    <TableHead className="text-right">Allowances</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net Salary</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollRecords.map((record, idx) => {
                    const [, recMonNum] = (record.run_month || "").split("-");
                    const monthName = MONTHS.find((m) => m.value === String(Number(recMonNum)))?.label || record.run_month || "";
                    const isDuplicate = payrollRecords.some((r, i) => i !== idx && r.run_month === record.run_month);
                    const basicSal = Number(record.basic ?? record.basic_salary ?? 0);
                    const totalAllowances = Number(record.gross_salary ?? 0) - basicSal;
                    const isExpanded = expandedRecord === record.id;
                    return (
                      <Fragment key={record.id}>
                        <TableRow className="cursor-pointer hover:bg-blue-50/50" onClick={() => setExpandedRecord(isExpanded ? null : record.id)}>
                          <TableCell>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">
                            {monthName}
                            {isDuplicate && record.payslip_ref && (
                              <span className="ml-1.5 text-xs text-slate-400">({record.payslip_ref})</span>
                            )}
                            {isDuplicate && !record.payslip_ref && (
                              <span className="ml-1.5 text-xs text-slate-400">(Run {idx + 1})</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {renderSensitive(formatCurrency(basicSal))}
                          </TableCell>
                          <TableCell className="text-right text-green-600">
                            {renderSensitive(`+${formatCurrency(totalAllowances > 0 ? totalAllowances : 0)}`)}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            {renderSensitive(`-${formatCurrency(Number(record.total_deductions) || 0)}`)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {renderSensitive(formatCurrency(Number(record.net_salary) || 0))}
                          </TableCell>
                          <TableCell>{getStatusBadge(record.run_status || record.status || "processed")}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadPayslip(record);
                              }}
                              disabled={!record.net_salary || Number(record.net_salary) === 0}
                              title={!record.net_salary || Number(record.net_salary) === 0 ? "Payslip not yet processed" : "Download PDF"}
                            >
                              <Download className="h-4 w-4 mr-1" />
                              PDF
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-slate-50 p-5">
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <p className="font-medium text-green-600 flex items-center gap-1">
                                    <Plus className="h-3 w-3" /> Earnings Breakdown
                                  </p>
                                  <table className="w-full text-sm">
                                    <tbody>
                                      {record.earnings && record.earnings.length > 0 ? (
                                        record.earnings.filter((e) => Number(e.amount) > 0).map((earning) => (
                                          <tr key={earning.component_code} className="border-b last:border-0">
                                            <td className="py-1 text-muted-foreground">{earning.component_name}</td>
                                            <td className="py-1 text-right font-mono font-semibold text-green-600">
                                              {renderSensitive(`+${formatCurrency(Number(earning.amount))}`)}
                                            </td>
                                          </tr>
                                        ))
                                      ) : (
                                        <>
                                          <tr className="border-b">
                                            <td className="py-1 text-muted-foreground">Basic Salary</td>
                                            <td className="py-1 text-right font-mono">{renderSensitive(formatCurrency(Number(record.basic ?? record.basic_salary ?? 0)))}</td>
                                          </tr>
                                          {Number(record.hra ?? 0) > 0 && (
                                            <tr className="border-b">
                                              <td className="py-1 text-muted-foreground">HRA</td>
                                              <td className="py-1 text-right font-mono text-green-600">{renderSensitive(`+${formatCurrency(Number(record.hra))}`)}</td>
                                            </tr>
                                          )}
                                          {Number(record.special_allowance ?? 0) > 0 && (
                                            <tr>
                                              <td className="py-1 text-muted-foreground">Special Allowance</td>
                                              <td className="py-1 text-right font-mono text-green-600">{renderSensitive(`+${formatCurrency(Number(record.special_allowance))}`)}</td>
                                            </tr>
                                          )}
                                        </>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                                <div className="space-y-2">
                                  <p className="font-medium text-red-600 flex items-center gap-1">
                                    <Minus className="h-3 w-3" /> Deductions Breakdown
                                  </p>
                                  <table className="w-full text-sm">
                                    <tbody>
                                      {record.deductions && record.deductions.length > 0 ? (
                                        record.deductions.filter((d) => Number(d.amount) > 0).map((deduction) => (
                                          <tr key={deduction.component_code} className="border-b last:border-0">
                                            <td className="py-1 text-muted-foreground">{deduction.component_name}</td>
                                            <td className="py-1 text-right font-mono font-semibold text-red-600">
                                              {renderSensitive(`-${formatCurrency(Number(deduction.amount))}`)}
                                            </td>
                                          </tr>
                                        ))
                                      ) : (
                                        <>
                                          {Number(record.pf_employee ?? 0) > 0 && (
                                            <tr className="border-b"><td className="py-1 text-muted-foreground">PF (Employee)</td><td className="py-1 text-right font-mono text-red-600">{renderSensitive(`-${formatCurrency(Number(record.pf_employee))}`)}</td></tr>
                                          )}
                                          {Number(record.esic_employee ?? 0) > 0 && (
                                            <tr className="border-b"><td className="py-1 text-muted-foreground">ESIC</td><td className="py-1 text-right font-mono text-red-600">{renderSensitive(`-${formatCurrency(Number(record.esic_employee))}`)}</td></tr>
                                          )}
                                          {Number(record.professional_tax ?? 0) > 0 && (
                                            <tr className="border-b"><td className="py-1 text-muted-foreground">Professional Tax</td><td className="py-1 text-right font-mono text-red-600">{renderSensitive(`-${formatCurrency(Number(record.professional_tax))}`)}</td></tr>
                                          )}
                                          {Number(record.tds ?? 0) > 0 && (
                                            <tr><td className="py-1 text-muted-foreground">TDS</td><td className="py-1 text-right font-mono text-red-600">{renderSensitive(`-${formatCurrency(Number(record.tds))}`)}</td></tr>
                                          )}
                                          {Number(record.total_deductions) === 0 && (
                                            <tr><td colSpan={2} className="py-1 text-muted-foreground">No deductions</td></tr>
                                          )}
                                        </>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : isError ? null : (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white py-14 text-center">
            <FileText className="mb-4 h-12 w-12 text-slate-300" />
            <p className="text-lg font-bold text-slate-800">No payslips found</p>
            <p className="text-sm text-muted-foreground">
              There are no processed payroll records for {selectedYear}.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Note: Payslips in draft status are not available for download until they are finalized by HR/Payroll team.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
