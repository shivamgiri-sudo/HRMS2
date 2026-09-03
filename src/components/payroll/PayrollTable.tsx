import { hrmsApi } from "@/lib/hrmsApi";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AmountCell, MobileRecordCard, StatusBadgeV2 } from "@/components/enterprise";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Download, Eye, MoreVertical, CheckCircle, Clock, CreditCard, CalendarCheck, Loader2, X } from "lucide-react";
import { useState } from "react";
import { downloadMasCallnetPayslip } from "@/lib/masCallnetPayslipGeneratorV2";
import { numberToWords } from "@/lib/numberToWords";
import { useToast } from "@/hooks/use-toast";

type SalaryStructureResponse = {
  success: boolean;
  data: Partial<Record<
    | "hra"
    | "transport_allowance"
    | "medical_allowance"
    | "other_allowances"
    | "tax_deduction"
    | "other_deductions",
    number
  >> | null;
};

export interface PayrollRecord {
  id: string;
  lineId: string;
  runId: string;
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
  totalAllowances: number;
  grossSalary: number;
  totalDeductions: number;
  netSalary: number;
  status: "paid" | "pending" | "processing" | "cancelled";
  paidAt?: string;
  branch?: string;
  process?: string;
  department?: string;
  designation?: string;
  // Extended fields from salary_prep_line
  hra?: number;
  specialAllowance?: number;
  pfEmployee?: number;
  esicEmployee?: number;
  professionalTax?: number;
  tdsAmount?: number;
  lwpDeduction?: number;
  advanceRecovery?: number;
  workingDays?: number;
  presentDays?: number;
  lwpDays?: number;
  incentiveTotal?: number;
  otherDeductions?: number;
  earningComponents?: Array<{ component_code: string; component_name: string; component_type: string; amount: number }>;
  deductionComponents?: Array<{ component_code: string; component_name: string; component_type: string; amount: number }>;
  employerCostComponents?: Array<{ component_code: string; component_name: string; component_type: string; amount: number }>;
}

interface PayrollTableProps {
  records: PayrollRecord[];
  onView?: (record: PayrollRecord) => void;
  onDownload?: (record: PayrollRecord) => void;
  onMarkProcessed?: (record: PayrollRecord) => void;
  onMarkPaid?: (record: PayrollRecord) => void;
  onRevertToPending?: (record: PayrollRecord) => void;
  onBulkMarkProcessed?: (ids: string[]) => void;
  onBulkMarkPaid?: (ids: string[]) => void;
  onBulkRevertToPending?: (ids: string[]) => void;
  isBulkUpdating?: boolean;
}

const statusStyles = {
  paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  processing: "bg-primary/10 text-primary border-primary/20",
};

const statusIcons = {
  paid: <CheckCircle className="mr-1 h-3 w-3" />,
  pending: <Clock className="mr-1 h-3 w-3" />,
  processing: <CreditCard className="mr-1 h-3 w-3" />,
};

export function PayrollTable({ 
  records, 
  onView, 
  onDownload,
  onMarkProcessed,
  onMarkPaid,
  onRevertToPending,
  onBulkMarkProcessed,
  onBulkMarkPaid,
  onBulkRevertToPending,
  isBulkUpdating = false,
}: PayrollTableProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === records.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(records.map((r) => r.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const selectedRecords = records.filter((r) => selectedIds.has(r.id));
  const canMarkPaid = selectedRecords.some((r) => r.status === "pending" || r.status === "processing");

  const handleBulkPaid = () => {
    const eligibleIds = selectedRecords.filter((r) => r.status === "pending" || r.status === "processing").map((r) => r.lineId);
    if (eligibleIds.length > 0) {
      onBulkMarkPaid?.(eligibleIds);
      clearSelection();
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  /** Sum of `full.employer_costs` (component_type='employer_cost') rows matching one code. */
  const employerCostByCode = (full: any, code: string): number =>
    (Array.isArray(full?.employer_costs) ? full.employer_costs : [])
      .filter((c: any) => String(c.component_code ?? "").toUpperCase() === code)
      .reduce((t: number, c: any) => t + Number(c.amount || 0), 0);

  const downloadPayslipPDF = async (record: PayrollRecord) => {
    setDownloadingId(record.id);

    try {
      const monthName = MONTH_NAMES[record.monthNum - 1] || "";

      // Fetch full payslip data from the API (same source as profile payslips)
      // Falls back to record fields if no salary_payslip record exists yet
      let full: any = null;
      try {
        const res = await hrmsApi.get<{ success: boolean; data: any }>(
          `/api/payroll/payslip/${record.runId}/${record.employeeId}`
        );
        full = res.data;
      } catch {
        // No payslip generated yet — use flat record fields as fallback
        full = null;
      }

      const earnings   = full?.earnings   || record.earningComponents   || [];
      const deductions = full?.deductions || record.deductionComponents || [];
      const getEarning = (code: string) => {
        const comp = earnings.find((e: any) => e.component_code?.toUpperCase() === code.toUpperCase());
        return Number(comp?.amount ?? 0);
      };
      const getDeduction = (code: string) => {
        const comp = deductions.find((d: any) => d.component_code?.toUpperCase() === code.toUpperCase());
        return Number(comp?.amount ?? 0);
      };

      const basic = getEarning('BASIC') || Number(full?.basic ?? record.basic ?? 0);
      const hra   = getEarning('HRA')   || Number(full?.hra ?? record.hra ?? 0);
      const bonus = getEarning('BONUS');
      const conv  = getEarning('CONVEYANCE') || getEarning('CONV');
      const pa    = getEarning('PA') || getEarning('PERSONAL_ALLOWANCE') || getEarning('PORTFOLIO');
      const ma    = getEarning('MA') || getEarning('MEDICAL_ALLOWANCE') || getEarning('MEDICAL');
      const sa    = getEarning('SPECIAL') || getEarning('SPECIAL_ALLOWANCE');
      const arrear    = getEarning('ARREAR');
      const incentive = getEarning('INCENTIVE');

      // Sum by name whatever component has no slot above, rather than inferring it
      // as gross-minus-known — that silently absorbed any new head (SHSH, PLI, ...)
      // and any arithmetic error into one unexplained "Other Allowance" figure.
      const SLOTTED_E = new Set(['BASIC', 'HRA', 'BONUS', 'CONV', 'CONVEYANCE', 'PA',
        'PERSONAL_ALLOWANCE', 'PORTFOLIO', 'MA', 'MEDICAL_ALLOWANCE', 'MEDICAL',
        'SPECIAL', 'SPECIAL_ALLOWANCE', 'ARREAR', 'INCENTIVE']);
      const unslottedEarnings = (earnings as any[])
        .filter((e) => !SLOTTED_E.has(String(e.component_code ?? '').toUpperCase()))
        .reduce((t, e) => t + Number(e.amount || 0), 0);
      const knownEarnings = basic + hra + bonus + conv + pa + ma + sa + arrear + incentive;
      const oa = Math.max(Number(full?.gross_salary ?? record.grossSalary ?? 0) - knownEarnings - unslottedEarnings, 0) + unslottedEarnings;

      const pf    = getDeduction('PF_EMPLOYEE') || getDeduction('PF_EMP') || Number(full?.pf_employee ?? record.pfEmployee ?? 0);
      const esic  = getDeduction('ESIC_EMPLOYEE') || getDeduction('ESIC_EMP') || Number(full?.esic_employee ?? record.esicEmployee ?? 0);
      const pt    = getDeduction('PROFESSIONAL_TAX') || getDeduction('PT') || Number(full?.professional_tax ?? record.professionalTax ?? 0);
      const tds   = getDeduction('TDS') || Number(full?.tds ?? record.tdsAmount ?? 0);
      const loan  = getDeduction('LOAN') || getDeduction('LOAN_RECOVERY') || getDeduction('LOAN_EMI');
      const adDed = getDeduction('ADVANCE') || getDeduction('ADVANCE_RECOVERY') || getDeduction('ADV') || Number(full?.advance_recovery ?? record.advanceRecovery ?? 0);
      const SLOTTED_D = new Set(['PF_EMPLOYEE', 'PF_EMP', 'ESIC_EMPLOYEE', 'ESIC_EMP',
        'PROFESSIONAL_TAX', 'PT', 'TDS', 'LOAN', 'LOAN_RECOVERY', 'LOAN_EMI',
        'ADVANCE', 'ADVANCE_RECOVERY', 'ADV']);
      const unslottedDeductions = (deductions as any[])
        .filter((d) => !SLOTTED_D.has(String(d.component_code ?? '').toUpperCase()))
        .reduce((t, d) => t + Number(d.amount || 0), 0);
      const knownDeductions = pf + esic + pt + tds + loan + adDed;
      const otherDed = Math.max(unslottedDeductions, Number(full?.total_deductions ?? record.totalDeductions ?? 0) - knownDeductions, 0);

      const netSalary = Number(full?.net_salary ?? full?.net_pay ?? record.netSalary ?? 0);

      await downloadMasCallnetPayslip({
        companyName: "Mas Callnet India Pvt Ltd",
        monthYear: `${monthName} - ${record.year}`,
        empName: record.employee.name,
        empCode: record.employeeCode,
        designation: full?.designation || record.designation || "N/A",
        department: full?.department || record.department || "N/A",
        epfNo: full?.epf_number || "",
        uanNo: full?.uan_number || "",
        panNo: full?.pan_number || "",
        bankAccount: full?.bank_account_masked || "",
        location: full?.branch_name || full?.location_name || record.branch || "N/A",
        esiNo: full?.esi_number || "",
        wDays: Number(full?.working_days ?? record.workingDays ?? 30),
        earnedDays: Number(full?.present_days ?? record.presentDays ?? full?.working_days ?? 30),
        lwpDays: Number(full?.lwp_days ?? record.lwpDays ?? 0),
        totalDaysInMonth: Number(full?.working_days ?? record.workingDays ?? 30),
        basic, hra, bonus, conv, pa, ma, sa, oa, arrear, incentive,
        pf, esic, pt, tds, lwpDeduction: Number(full?.lwp_deduction ?? 0), loan, adDed, otherDed,
        // full?.employer_costs (component_type='employer_cost') carries EPF admin
        // charges as a component distinct from pf_employer — the flat field this
        // was built from never included it, so it never reached this PDF. The
        // template has no dedicated admin-charge slot; folding it into the PF
        // employer figure is the closest honest placement (both are EPFO remittances).
        employerPf: Number(full?.pf_employer ?? 0) + employerCostByCode(full, 'ADMIN_CHG'),
        employerEsic: Number(full?.esic_employer ?? 0),
        grossSalary: Number(full?.gross_salary ?? record.grossSalary ?? 0),
        incomeTax: tds,
        chequeNo: full?.cheque_no || "",
        paymentMode: full?.payment_mode || "",
        paymentDate: full?.payment_date || "",
        netSalary,
        netSalaryWords: numberToWords(Math.floor(netSalary)),
      }, `Payslip_${record.employeeCode}_${monthName}_${record.year}.pdf`);

      toast({
        title: "Payslip Downloaded",
        description: `PDF generated for ${record.employee.name}`,
      });
    } catch (error) {
      console.error("Payslip download error:", error);
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Could not generate payslip PDF",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };
  return (
    <div className="space-y-3">
      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {selectedIds.size} record{selectedIds.size > 1 ? "s" : ""} selected
            </span>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="mr-1 h-4 w-4" />
              Clear
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {/*
              Bulk "Mark as Processed" and "Revert to Pending" removed for first release
              (owner ruling 2026-08-16) — same reason as the per-row items below: both sent
              a run status the backend deliberately stopped accepting, so every click 400'd.
            */}
            {canMarkPaid && (
              <Button
                size="sm"
                onClick={handleBulkPaid}
                disabled={isBulkUpdating}
              >
                {isBulkUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                Mark as Paid
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:hidden">
        {records.map((record) => (
          <MobileRecordCard
            key={record.id}
            title={record.employee.name}
            subtitle={[record.employeeCode, record.month + " " + record.year, record.branch, record.process].filter(Boolean).join(" · ")}
            status={
              <StatusBadgeV2
                status={record.status === "paid" ? "success" : record.status === "processing" ? "info" : "pending"}
                label={record.status.charAt(0).toUpperCase() + record.status.slice(1)}
              />
            }
            actions={
              <>
                <Button variant="outline" size="sm" className="rounded-[var(--r-md)]" onClick={() => onView?.(record)}>
                  <Eye className="mr-2 h-4 w-4" />
                  View
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-[var(--r-md)]"
                  onClick={() => downloadPayslipPDF(record)}
                  disabled={downloadingId === record.id}
                >
                  {downloadingId === record.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  Payslip
                </Button>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 rounded-[var(--r-md)] bg-[var(--surface-1)] p-3 text-xs">
              <div>
                <p className="text-[var(--text-muted)]">Basic</p>
                <p className="mt-1 font-semibold text-[var(--text-primary)]"><AmountCell amount={record.basic} /></p>
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Allowances</p>
                <p className="mt-1 font-semibold text-[var(--status-present)]"><AmountCell amount={record.totalAllowances} prefix="+" /></p>
                {(record.incentiveTotal ?? 0) > 0 && (
                  <p className="text-[10px] text-emerald-500">incl. ₹{(record.incentiveTotal ?? 0).toLocaleString('en-IN')} incentive</p>
                )}
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Deductions</p>
                <p className="mt-1 font-semibold text-[var(--status-absent)]"><AmountCell amount={record.totalDeductions} prefix="-" /></p>
                {(record.otherDeductions ?? 0) > 0 && (
                  <p className="text-[10px] text-red-400">incl. ₹{(record.otherDeductions ?? 0).toLocaleString('en-IN')} custom</p>
                )}
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Net Salary</p>
                <p className="mt-1 font-semibold text-[var(--text-primary)]"><AmountCell amount={record.netSalary} /></p>
              </div>
            </div>
          </MobileRecordCard>
        ))}
      </div>

      <div className="hidden rounded-xl border border-border bg-card md:block">
        <Table className="smarthr-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={selectedIds.size === records.length && records.length > 0}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead className="w-[220px]">Employee</TableHead>
              <TableHead>Month</TableHead>
              <TableHead className="text-right">Basic</TableHead>
              <TableHead className="text-right">Allowances</TableHead>
              <TableHead className="text-right">Deductions</TableHead>
              <TableHead className="text-right">Net Salary</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id} data-state={selectedIds.has(record.id) ? "selected" : undefined} className="hover:bg-gray-50 transition-colors cursor-pointer">
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(record.id)}
                    onCheckedChange={() => toggleSelection(record.id)}
                    aria-label={`Select ${record.employee.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={record.employee.avatar} />
                      <AvatarFallback>
                        {record.employee.name.split(" ").map((n) => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{record.employee.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{record.employeeCode} · {record.employee.email}</p>
                      {(record.branch || record.process) && (
                        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                          {[record.branch, record.process].filter(Boolean).join(" › ")}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{record.month}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  ₹{record.basic.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="text-right text-emerald-600">
                  <div>+₹{record.totalAllowances.toLocaleString('en-IN')}</div>
                  {(record.incentiveTotal ?? 0) > 0 && (
                    <div className="text-[10px] font-medium text-emerald-500 mt-0.5">
                      incl. ₹{(record.incentiveTotal ?? 0).toLocaleString('en-IN')} incentive
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right text-destructive">
                  <div>-₹{record.totalDeductions.toLocaleString('en-IN')}</div>
                  {(record.otherDeductions ?? 0) > 0 && (
                    <div className="text-[10px] font-medium text-red-400 mt-0.5">
                      incl. ₹{(record.otherDeductions ?? 0).toLocaleString('en-IN')} custom ded.
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right font-semibold text-foreground">
                  ₹{record.netSalary.toLocaleString('en-IN')}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <StatusBadgeV2
                      status={record.status === "paid" ? "success" : record.status === "processing" ? "info" : "pending"}
                      label={record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                    />
                    {record.paidAt && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center text-xs text-muted-foreground cursor-help">
                            <CalendarCheck className="mr-1 h-3 w-3" />
                            {record.paidAt}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Paid on {record.paidAt}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onView?.(record)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => downloadPayslipPDF(record)}
                      disabled={downloadingId === record.id}
                    >
                      {downloadingId === record.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/*
                          "Mark as Processed" and "Revert to Pending" removed for first release
                          (owner ruling 2026-08-16).

                          Both sent a run status the backend deliberately stopped accepting.
                          useUpdatePayrollStatus maps "processed" to `reviewed` and "draft" to
                          `processing`, and updateRunStatusSchema accepts only
                          approved | locked | disbursed — so every click 400'd. They were not
                          remapped to a working status because that would invent payroll
                          semantics: "processed" is not "approved", and reopening a computed
                          run needs its own controlled correction workflow rather than a casual
                          status write.

                          "Mark as Paid" stays, and is now subject to the Finance sign-off and
                          separation-of-duties rules in payroll.service.ts updateRunStatus.
                        */}
                        {(record.status === "pending" || record.status === "processing") && (
                          <DropdownMenuItem onClick={() => onMarkPaid?.(record)}>
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Mark as Paid
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
