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
import { downloadPayslip } from "@/lib/payslipPdfGenerator";
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
  allowances: number;
  deductions: number;
  netSalary: number;
  status: "paid" | "pending" | "processing";
  paidAt?: string;
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
  const canMarkProcessed = selectedRecords.some((r) => r.status === "pending");
  const canMarkPaid = selectedRecords.some((r) => r.status === "pending" || r.status === "processing");
  const canRevert = selectedRecords.some((r) => r.status === "processing" || r.status === "paid");

  const handleBulkProcessed = () => {
    const eligibleIds = selectedRecords.filter((r) => r.status === "pending").map((r) => r.runId);
    if (eligibleIds.length > 0) {
      onBulkMarkProcessed?.(eligibleIds);
      clearSelection();
    }
  };

  const handleBulkPaid = () => {
    const eligibleIds = selectedRecords.filter((r) => r.status === "pending" || r.status === "processing").map((r) => r.runId);
    if (eligibleIds.length > 0) {
      onBulkMarkPaid?.(eligibleIds);
      clearSelection();
    }
  };

  const handleBulkRevert = () => {
    const eligibleIds = selectedRecords.filter((r) => r.status === "processing" || r.status === "paid").map((r) => r.runId);
    if (eligibleIds.length > 0) {
      onBulkRevertToPending?.(eligibleIds);
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

  const downloadPayslipPDF = async (record: PayrollRecord) => {
    setDownloadingId(record.id);

    try {
      console.log("Starting payslip download for:", record.employee.name);

      // Fetch salary structure for detailed breakdown
      const structureResponse = await hrmsApi.get<SalaryStructureResponse>("/api/payroll/structures");
      const salaryStructure = structureResponse.data;

      console.log("Salary structure fetched:", salaryStructure);

      const monthName = MONTH_NAMES[record.monthNum - 1] || "";

      const payslipData = {
        employeeName: record.employee.name,
        employeeCode: record.employeeCode,
        employeeEmail: record.employee.email,
        monthName,
        year: record.year,
        status: record.status,
        paidAt: record.paidAt,
        basicSalary: record.basic,
        allowances: record.allowances,
        deductions: record.deductions,
        netSalary: record.netSalary,
        salaryBreakdown: salaryStructure ? {
          hra: salaryStructure.hra ?? undefined,
          transport_allowance: salaryStructure.transport_allowance ?? undefined,
          medical_allowance: salaryStructure.medical_allowance ?? undefined,
          other_allowances: salaryStructure.other_allowances ?? undefined,
          tax_deduction: salaryStructure.tax_deduction ?? undefined,
          other_deductions: salaryStructure.other_deductions ?? undefined,
        } : undefined,
      };

      console.log("Calling downloadPayslip with data:", payslipData);

      downloadPayslip(payslipData, `Payslip_${record.employeeCode}_${monthName}_${record.year}.pdf`);

      console.log("Payslip download completed successfully");

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
            {canMarkProcessed && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkProcessed}
                disabled={isBulkUpdating}
              >
                {isBulkUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                Mark as Processed
              </Button>
            )}
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
            {canRevert && (
              <Button
                size="sm"
                variant="outline"
                className="text-amber-600 border-amber-600/30 hover:bg-amber-500/10"
                onClick={handleBulkRevert}
                disabled={isBulkUpdating}
              >
                {isBulkUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clock className="mr-2 h-4 w-4" />}
                Revert to Pending
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
            subtitle={`${record.employeeCode} · ${record.month} ${record.year}`}
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
                <p className="mt-1 font-semibold text-[var(--status-present)]"><AmountCell amount={record.allowances} prefix="+" /></p>
              </div>
              <div>
                <p className="text-[var(--text-muted)]">Deductions</p>
                <p className="mt-1 font-semibold text-[var(--status-absent)]"><AmountCell amount={record.deductions} prefix="-" /></p>
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
                    <div>
                      <p className="font-medium text-foreground">{record.employee.name}</p>
                      <p className="text-xs text-muted-foreground">{record.employee.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{record.month}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  ₹{record.basic.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="text-right text-emerald-600">
                  +₹{record.allowances.toLocaleString('en-IN')}
                </TableCell>
                <TableCell className="text-right text-destructive">
                  -₹{record.deductions.toLocaleString('en-IN')}
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
                        {record.status === "pending" && (
                          <DropdownMenuItem onClick={() => onMarkProcessed?.(record)}>
                            <CreditCard className="mr-2 h-4 w-4" />
                            Mark as Processed
                          </DropdownMenuItem>
                        )}
                        {(record.status === "pending" || record.status === "processing") && (
                          <DropdownMenuItem onClick={() => onMarkPaid?.(record)}>
                            <CheckCircle className="mr-2 h-4 w-4" />
                            Mark as Paid
                          </DropdownMenuItem>
                        )}
                        {(record.status === "processing" || record.status === "paid") && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => onRevertToPending?.(record)}
                              className="text-amber-600"
                            >
                              <Clock className="mr-2 h-4 w-4" />
                              Revert to Pending
                            </DropdownMenuItem>
                          </>
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
