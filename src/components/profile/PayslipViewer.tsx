import { useState, useEffect } from "react";
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
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Download, FileText, Wallet, ChevronDown, ChevronUp, Plus, Minus } from "lucide-react";
import { downloadMasCallnetPayslip } from "@/lib/masCallnetPayslipGenerator";

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
  switch (status) {
    case "paid":
      return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Paid</Badge>;
    case "processed":
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Processed</Badge>;
    default:
      return <Badge variant="secondary">Draft</Badge>;
  }
};

export function PayslipViewer({ employeeId, employeeName, employeeCode }: PayslipViewerProps) {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState(String(currentDate.getFullYear()));
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [showNewPayslipAlert, setShowNewPayslipAlert] = useState(false);

  // Fetch payroll records for the employee
  const { data: payrollRecords, isLoading } = useQuery({
    queryKey: ["my-payslips", employeeId, selectedYear],
    queryFn: async () => {
      if (!employeeId) return [];
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
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
      return latestRecord.earnings.map((e: any) => ({
        label: e.component_name,
        amount: Number(e.amount ?? 0),
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
      return latestRecord.deductions.map((d: any) => ({
        label: d.component_name,
        amount: Number(d.amount ?? 0),
      }));
    }

    // Fallback to old structure
    const items = [];
    if (salaryStructure?.tax_deduction) items.push({ label: "Tax Deduction", amount: salaryStructure.tax_deduction });
    if (salaryStructure?.other_deductions) items.push({ label: "Other Deductions", amount: salaryStructure.other_deductions });
    return items;
  };

  const handleDownloadPayslip = (record: any) => {
    // run_month is "YYYY-MM" format
    const [recYear, recMonthNum] = (record.run_month || "").split("-");
    const monthName = MONTHS.find((m) => m.value === String(Number(recMonthNum)))?.label || record.run_month || "";

    // Helper to get component amount by code from earnings array
    const getEarning = (code: string) => {
      const comp = (record.earnings || []).find((e: any) => e.component_code === code);
      return Number(comp?.amount ?? 0);
    };

    // Helper to get deduction amount by code
    const getDeduction = (code: string) => {
      const comp = (record.deductions || []).find((d: any) => d.component_code === code);
      return Number(comp?.amount ?? 0);
    };

    downloadMasCallnetPayslip({
      // Header
      companyName: "Mas Callnet India Pvt. Ltd",
      monthYear: `${monthName} - ${recYear}`,

      // Employee details - now from actual database
      empName: employeeName,
      empCode: employeeCode,
      designation: record.designation_name || "N/A",
      department: record.dept_name || "N/A",
      epfNo: record.epf_number || "",
      location: record.branch_name || record.location_name || "N/A",
      esiNo: record.esi_number || "",
      wDays: Number(record.working_days ?? 30),
      earnedDays: Number(record.present_days ?? record.working_days ?? 30),

      // Earnings - from component breakdown
      basic: getEarning('BASIC'),
      hra: getEarning('HRA'),
      bonus: getEarning('BONUS'),
      conv: getEarning('CONVEYANCE') || getEarning('CONV'),
      pa: getEarning('PA') || getEarning('PERSONAL_ALLOWANCE'),
      ma: getEarning('MA') || getEarning('MEDICAL_ALLOWANCE'),
      sa: getEarning('SPECIAL') || getEarning('SPECIAL_ALLOWANCE'),
      oa: getEarning('OTHER') || getEarning('OTHER_ALLOWANCE'),
      arrear: getEarning('ARREAR'),
      incentive: getEarning('INCENTIVE'),

      // Deductions - from component breakdown
      pf: getDeduction('PF_EMP') || getDeduction('PF_EMPLOYEE'),
      esic: getDeduction('ESIC_EMP') || getDeduction('ESIC_EMPLOYEE'),
      loan: getDeduction('LOAN') || getDeduction('LOAN_RECOVERY'),
      adDed: getDeduction('ADVANCE') || getDeduction('ADVANCE_RECOVERY'),
      otherDed: getDeduction('PT') || getDeduction('PROFESSIONAL_TAX') + (getDeduction('TDS') || 0),

      // Form 16 Summary (optional - set to 0 for now)
      grossSalary: Number(record.gross_salary ?? 0),
      exemptionUs10: 0,
      balance: 0,
      deductionUs24: 0,
      grossTotalIncome: 0,
      aggOffChapVi: 0,
      totalIncome: 0,
      taxOnTotal: 0,
      taxPayableEduCess: 0,
      incomeTax: getDeduction('TDS'),

      // Payment details
      chequeNo: record.cheque_number || `S${Date.now().toString().slice(-8)}`,
      netSalary: Number(record.net_salary ?? 0),
    }, `Payslip_${employeeCode}_${monthName}_${recYear}.pdf`);
  };

  const allowanceBreakdown = getAllowanceBreakdown();
  const deductionBreakdown = getDeductionBreakdown();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>My Payslips</CardTitle>
              <CardDescription>View and download your salary statements</CardDescription>
            </div>
          </div>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[120px]">
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
      </CardHeader>
      <CardContent className="space-y-6">
        {/* New Payslip Alert */}
        {showNewPayslipAlert && payrollRecords && payrollRecords.length > 0 && (
          <Alert className="bg-primary/10 border-primary">
            <Download className="h-4 w-4" />
            <AlertTitle>New Payslip Available!</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>
                Your salary for {(() => {
                  const [, monthNum] = (payrollRecords[0].run_month || "").split("-");
                  return MONTHS.find((m) => m.value === String(Number(monthNum)))?.label || "";
                })()} has been disbursed.
              </span>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    handleDownloadPayslip(payrollRecords[0]);
                    handleDismissAlert(payrollRecords[0].id);
                  }}
                  size="sm"
                  className="ml-4"
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
          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Salary Structure Breakdown</CardTitle>
              <CardDescription>Your current salary components</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2">
                {/* Earnings */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-600">
                    <Plus className="h-4 w-4" />
                    <span className="font-semibold">Earnings</span>
                  </div>
                  <div className="space-y-2 rounded-lg border bg-background p-4">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Basic Salary</span>
                      <span className="font-medium">{formatCurrency(salaryStructure.basic_salary)}</span>
                    </div>
                    {allowanceBreakdown.map((item) => (
                      <div key={item.label} className="flex justify-between">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-medium text-green-600">+{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                    <Separator />
                    <div className="flex justify-between font-semibold">
                      <span>Gross Salary</span>
                      <span>
                        {payrollRecords && payrollRecords.length > 0
                          ? formatCurrency(Number(payrollRecords[0].gross_salary ?? 0))
                          : formatCurrency(
                              salaryStructure.basic_salary +
                                (salaryStructure.hra || 0) +
                                (salaryStructure.transport_allowance || 0) +
                                (salaryStructure.medical_allowance || 0) +
                                (salaryStructure.other_allowances || 0)
                            )
                        }
                      </span>
                    </div>
                  </div>
                </div>

                {/* Deductions */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-red-600">
                    <Minus className="h-4 w-4" />
                    <span className="font-semibold">Deductions</span>
                  </div>
                  <div className="space-y-2 rounded-lg border bg-background p-4">
                    {deductionBreakdown.length > 0 ? (
                      <>
                        {deductionBreakdown.map((item) => (
                          <div key={item.label} className="flex justify-between">
                            <span className="text-muted-foreground">{item.label}</span>
                            <span className="font-medium text-red-600">-{formatCurrency(item.amount)}</span>
                          </div>
                        ))}
                        <Separator />
                        <div className="flex justify-between font-semibold">
                          <span>Total Deductions</span>
                          <span className="text-red-600">
                            -{formatCurrency(
                              (salaryStructure.tax_deduction || 0) +
                                (salaryStructure.other_deductions || 0)
                            )}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p className="text-muted-foreground text-sm">No deductions configured</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Net Salary */}
              <div className="mt-4 rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-lg">Net Salary (Monthly)</span>
                  <span className="font-bold text-xl text-primary">
                    {payrollRecords && payrollRecords.length > 0
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
                    }
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
            <h3 className="font-semibold">Payslip History</h3>
            <div className="rounded-md border">
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
                  {payrollRecords.map((record) => {
                    const [, recMonNum] = (record.run_month || "").split("-");
                    const monthName = MONTHS.find((m) => m.value === String(Number(recMonNum)))?.label || record.run_month || "";
                    const basicSal = Number(record.basic ?? record.basic_salary ?? 0);
                    const totalAllowances = Number(record.gross_salary ?? 0) - basicSal;
                    const isExpanded = expandedRecord === record.id;
                    return (
                      <>
                        <TableRow key={record.id} className="cursor-pointer" onClick={() => setExpandedRecord(isExpanded ? null : record.id)}>
                          <TableCell>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{monthName}</TableCell>
                          <TableCell className="text-right">{formatCurrency(basicSal)}</TableCell>
                          <TableCell className="text-right text-green-600">
                            +{formatCurrency(totalAllowances > 0 ? totalAllowances : 0)}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            -{formatCurrency(Number(record.total_deductions) || 0)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(Number(record.net_salary) || 0)}</TableCell>
                          <TableCell>{getStatusBadge(record.run_status || record.status || "processed")}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadPayslip(record);
                              }}
                              disabled={record.run_status === "draft"}
                            >
                              <Download className="h-4 w-4 mr-1" />
                              PDF
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={8} className="bg-muted/30 p-4">
                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <p className="font-medium text-green-600 flex items-center gap-1">
                                    <Plus className="h-3 w-3" /> Earnings Breakdown
                                  </p>
                                  <div className="space-y-1 text-sm">
                                    {record.earnings && record.earnings.length > 0 ? (
                                      record.earnings.map((earning: any) => (
                                        <div key={earning.component_code} className="flex justify-between">
                                          <span className="text-muted-foreground">{earning.component_name}</span>
                                          <span className="text-green-600">+{formatCurrency(Number(earning.amount))}</span>
                                        </div>
                                      ))
                                    ) : (
                                      <>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Basic Salary</span>
                                          <span>{formatCurrency(Number(record.basic ?? record.basic_salary ?? 0))}</span>
                                        </div>
                                        {record.hra > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">HRA</span>
                                            <span className="text-green-600">+{formatCurrency(Number(record.hra))}</span>
                                          </div>
                                        )}
                                        {record.special_allowance > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Special Allowance</span>
                                            <span className="text-green-600">+{formatCurrency(Number(record.special_allowance))}</span>
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <p className="font-medium text-red-600 flex items-center gap-1">
                                    <Minus className="h-3 w-3" /> Deductions Breakdown
                                  </p>
                                  <div className="space-y-1 text-sm">
                                    {record.deductions && record.deductions.length > 0 ? (
                                      record.deductions.map((deduction: any) => (
                                        <div key={deduction.component_code} className="flex justify-between">
                                          <span className="text-muted-foreground">{deduction.component_name}</span>
                                          <span className="text-red-600">-{formatCurrency(Number(deduction.amount))}</span>
                                        </div>
                                      ))
                                    ) : (
                                      <>
                                        {record.pf_employee > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">PF (Employee)</span>
                                            <span className="text-red-600">-{formatCurrency(Number(record.pf_employee))}</span>
                                          </div>
                                        )}
                                        {record.esic_employee > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">ESIC</span>
                                            <span className="text-red-600">-{formatCurrency(Number(record.esic_employee))}</span>
                                          </div>
                                        )}
                                        {record.professional_tax > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Professional Tax</span>
                                            <span className="text-red-600">-{formatCurrency(Number(record.professional_tax))}</span>
                                          </div>
                                        )}
                                        {record.tds > 0 && (
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">TDS</span>
                                            <span className="text-red-600">-{formatCurrency(Number(record.tds))}</span>
                                          </div>
                                        )}
                                        {Number(record.total_deductions) === 0 && (
                                          <p className="text-muted-foreground text-sm">No deductions</p>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">No Payslips Found</p>
            <p className="text-sm text-muted-foreground">
              There are no payroll records for {selectedYear}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
