import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CreditCard,
  Download,
  FileText,
  IndianRupee,
  Loader2,
  Search,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";

import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  EnterprisePageHeader,
  ExceptionPanel,
  KpiCard,
  KpiCardGrid,
} from "@/components/enterprise";
import { PayrollTable } from "@/components/payroll/PayrollTable";
import { PayslipViewDialog } from "@/components/payroll/PayslipViewDialog";
import { SalaryStructureManager } from "@/components/payroll/SalaryStructureManager";
import { PayrollAnalytics } from "@/components/payroll/PayrollAnalytics";
import { DateRangeExportDialog } from "@/components/export/DateRangeExportDialog";

import {
  useBulkUpdatePayrollStatus,
  fetchPayrollRecordPage,
  useGeneratePayroll,
  usePayrollRecords,
  usePayrollRunSummaries,
  usePayrollStats,
  useUpdatePayrollStatus,
  type PayrollRecord,
} from "@/hooks/usePayroll";
import { useCanAccessPayroll, useUserRole } from "@/hooks/useUserRole";
import { useEmployeeDirectoryMasters } from "@/hooks/useEmployees";
import { useDepartments } from "@/hooks/useDepartments";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const months = [
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

const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => {
  return (
    <Card className="border-dashed border-slate-200 bg-slate-50/70 shadow-none">
      <CardContent className="flex flex-col items-center justify-center py-14 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
          <FileText className="h-7 w-7" />
        </div>

        <h3 className="text-base font-semibold text-slate-950">{title}</h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
          {description}
        </p>

        {action && <div className="mt-5">{action}</div>}
      </CardContent>
    </Card>
  );
};

const Payroll = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("current");
  const [currentStatus, setCurrentStatus] = useState("all");
  const [currentBranchId, setCurrentBranchId] = useState("all");
  const [currentDeptId, setCurrentDeptId] = useState("all");
  const [currentProcessId, setCurrentProcessId] = useState("all");

  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historyMonth, setHistoryMonth] = useState("all");
  const [historyYear, setHistoryYear] = useState("all");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [historyBranchId, setHistoryBranchId] = useState("all");
  const [historyDeptId, setHistoryDeptId] = useState("all");
  const [historyProcessId, setHistoryProcessId] = useState("all");

  const [currentPage, setCurrentPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(10);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PayrollRecord | null>(
    null
  );
  const [branchBreakdownOpen, setBranchBreakdownOpen] = useState(false);
  const [branchBreakdownRunId, setBranchBreakdownRunId] = useState<string | null>(null);

  const { toast } = useToast();
  const { canAccessPayroll, isLoading: roleLoading } = useCanAccessPayroll();
  const { data: directoryMasters } = useEmployeeDirectoryMasters();
  const { data: departments = [] } = useDepartments();

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  const debouncedSearchQuery = useDebounce(searchQuery.trim(), 300);
  const debouncedHistorySearchQuery = useDebounce(historySearchQuery.trim(), 300);

  const currentMonthFilters = useMemo(() => ({
    month: monthFilter === "current" ? currentMonth : undefined,
    year:  monthFilter === "current" ? currentYear  : undefined,
    search: debouncedSearchQuery || undefined,
    status: currentStatus !== "all" ? currentStatus : undefined,
    branchId:     currentBranchId  !== "all" ? currentBranchId  : undefined,
    departmentId: currentDeptId    !== "all" ? currentDeptId    : undefined,
    processId:    currentProcessId !== "all" ? currentProcessId : undefined,
    page: currentPage,
    limit: currentPageSize,
  }), [monthFilter, currentMonth, currentYear, debouncedSearchQuery, currentStatus, currentBranchId, currentDeptId, currentProcessId, currentPage, currentPageSize]);
  const { data: recordsPage, isLoading, error: recordsError, isPlaceholderData } = usePayrollRecords(currentMonthFilters);
  const currentRecords = recordsPage?.records ?? [];
  const currentTotalItems = recordsPage?.total ?? 0;
  const currentTotalPages = Math.max(1, Math.ceil(currentTotalItems / currentPageSize));

  // Lightweight run summaries — used for availableYears/Months without fetching all 19k lines
  const { data: runSummaries = [], isLoading: isLoadingHistory } = usePayrollRunSummaries();

  // History records: fetch with selected year/month filters (paginated to avoid full table scan)
  // When both month and year are "all", don't set them at all to fetch all historical records
  const historyFilters = useMemo(() => {
    const hasMonthFilter = historyMonth !== "all";
    const hasYearFilter = historyYear !== "all";

    return {
      month: hasMonthFilter ? parseInt(historyMonth) : undefined,
      year:  hasYearFilter ? parseInt(historyYear)  : undefined,
      status: historyStatus !== "all" ? historyStatus : undefined,
      search: debouncedHistorySearchQuery || undefined,
      branchId:     historyBranchId  !== "all" ? historyBranchId  : undefined,
      departmentId: historyDeptId    !== "all" ? historyDeptId    : undefined,
      processId:    historyProcessId !== "all" ? historyProcessId : undefined,
      page: historyPage,
      limit: historyPageSize,
    };
  }, [historyMonth, historyYear, historyStatus, debouncedHistorySearchQuery, historyBranchId, historyDeptId, historyProcessId, historyPage, historyPageSize]);
  const { data: historyRecordsPage, isLoading: isLoadingHistoryRecords } = usePayrollRecords(historyFilters);
  const historyRecords = historyRecordsPage?.records ?? [];
  const historyTotalItems = historyRecordsPage?.total ?? 0;
  const historyTotalPages = Math.max(1, Math.ceil(historyTotalItems / historyPageSize));

  const { data: stats } = usePayrollStats();

  const generatePayroll = useGeneratePayroll();
  const updateStatus = useUpdatePayrollStatus();
  const bulkUpdateStatus = useBulkUpdatePayrollStatus();

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchQuery, monthFilter, currentStatus, currentBranchId, currentDeptId, currentProcessId, currentPageSize]);

  useEffect(() => {
    setHistoryPage(1);
  }, [debouncedHistorySearchQuery, historyMonth, historyYear, historyStatus, historyBranchId, historyDeptId, historyProcessId, historyPageSize]);

  // Cascade resets: when branch changes, clear dependent filters
  useEffect(() => {
    setCurrentProcessId("all");
  }, [currentBranchId]);

  useEffect(() => {
    setHistoryProcessId("all");
  }, [historyBranchId]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Current month run — used for incentive-applied warning
  const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
  const currentMonthRun = runSummaries.find(r => r.run_month === currentMonthStr) ?? null;

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    runSummaries.forEach((r) => {
      const yr = Number(String(r.run_month).split("-")[0]);
      if (yr) years.add(yr);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [runSummaries]);

  const availableMonths = useMemo(() => {
    return Array.from(new Set(runSummaries
      .map((r) => r.run_month)
      .filter(Boolean)))
      .sort()
      .reverse();
  }, [runSummaries]);

  const loadHistoryExportRecords = async (
    startDate?: Date,
    endDate?: Date
  ) => {
    const baseFilters = {
      month: historyMonth !== "all" ? parseInt(historyMonth) : undefined,
      year: historyYear !== "all" ? parseInt(historyYear) : undefined,
      status: historyStatus !== "all" ? historyStatus : undefined,
      search: debouncedHistorySearchQuery || undefined,
      branchId:     historyBranchId  !== "all" ? historyBranchId  : undefined,
      departmentId: historyDeptId    !== "all" ? historyDeptId    : undefined,
      processId:    historyProcessId !== "all" ? historyProcessId : undefined,
    };
    const firstPage = await fetchPayrollRecordPage({
      ...baseFilters,
      page: 1,
      limit: 500,
    });
    const combined = [...firstPage.records];
    const totalPages = Math.max(1, Math.ceil(firstPage.total / firstPage.limit));

    for (let page = 2; page <= totalPages; page += 1) {
      const pageResult = await fetchPayrollRecordPage({
        ...baseFilters,
        page,
        limit: firstPage.limit,
      });
      combined.push(...pageResult.records);
    }

    if (!startDate && !endDate) {
      return combined;
    }

    return combined.filter((record) => {
      const recordDate = new Date(record.year, record.monthNum - 1, 1);
      if (startDate && endDate) return recordDate >= startDate && recordDate <= endDate;
      if (startDate) return recordDate >= startDate;
      if (endDate) return recordDate <= endDate;
      return true;
    });
  };

  const exportToCSV = async (
    startDate: Date | undefined,
    endDate: Date | undefined
  ) => {
    const dataToExport = await loadHistoryExportRecords(startDate, endDate);

    if (dataToExport.length === 0) {
      toast({
        title: "No Data",
        description: "No payroll records to export for the selected period.",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "Employee Code",
      "Employee Name",
      "Email",
      "Branch",
      "Process",
      "Department",
      "Designation",
      "Month",
      "Year",
      "Basic Salary",
      "Allowances",
      "Deductions",
      "Net Salary",
      "Status",
    ];

    const sanitizeCell = (val: string | number | null | undefined): string => {
      const s = String(val ?? "").replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(s)) return `"'${s}"`;
      return `"${s}"`;
    };

    const csvContent = [
      headers.join(","),
      ...dataToExport.map((record) =>
        [
          sanitizeCell(record.employeeCode),
          sanitizeCell(record.employee.name),
          sanitizeCell(record.employee.email),
          sanitizeCell(record.branch),
          sanitizeCell(record.process),
          sanitizeCell(record.department),
          sanitizeCell(record.designation),
          sanitizeCell(record.month),
          sanitizeCell(record.year),
          sanitizeCell(record.basic),
          sanitizeCell(record.totalAllowances),
          sanitizeCell(record.totalDeductions),
          sanitizeCell(record.netSalary),
          sanitizeCell(record.status),
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);
    link.download = `payroll-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);

    toast({
      title: "Export Complete",
      description: `${dataToExport.length} payroll records exported to CSV.`,
    });
  };

  const exportToPDF = async (
    startDate: Date | undefined,
    endDate: Date | undefined
  ) => {
    const dataToExport = await loadHistoryExportRecords(startDate, endDate);

    if (dataToExport.length === 0) {
      toast({
        title: "No Data",
        description: "No payroll records to export for the selected period.",
        variant: "destructive",
      });
      return;
    }

    const doc = new jsPDF({ orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(20);
    doc.text("Payroll Report", pageWidth / 2, 20, { align: "center" });

    doc.setFontSize(10);
    doc.text(`Generated on: ${format(new Date(), "PPP")}`, 14, 30);

    const totalNet = dataToExport.reduce(
      (sum, record) => sum + record.netSalary,
      0
    );

    if (startDate || endDate) {
      const dateRangeText = `Period: ${
        startDate ? format(startDate, "PP") : "Beginning"
      } - ${endDate ? format(endDate, "PP") : "Present"}`;

      doc.text(dateRangeText, 14, 36);
      doc.text(`Total Records: ${dataToExport.length}`, 14, 42);
      doc.text(`Total Net Salary: ${formatCurrency(totalNet)}`, 14, 48);
    } else {
      doc.text(`Total Records: ${dataToExport.length}`, 14, 36);
      doc.text(`Total Net Salary: ${formatCurrency(totalNet)}`, 14, 42);
    }

    autoTable(doc, {
      startY: startDate || endDate ? 56 : 50,
      head: [
        [
          "Emp Code",
          "Name",
          "Branch",
          "Process",
          "Month",
          "Year",
          "Basic",
          "Allowances",
          "Deductions",
          "Net Salary",
          "Status",
        ],
      ],
      body: dataToExport.map((record) => [
        record.employeeCode,
        record.employee.name,
        record.branch ?? "",
        record.process ?? "",
        record.month,
        record.year,
        formatCurrency(record.basic),
        formatCurrency(record.totalAllowances),
        formatCurrency(record.totalDeductions),
        formatCurrency(record.netSalary),
        record.status.charAt(0).toUpperCase() + record.status.slice(1),
      ]),
      styles: { fontSize: 7 },
      headStyles: { fillColor: [15, 23, 42] },
    });

    doc.save(`payroll-report-${format(new Date(), "yyyy-MM-dd")}.pdf`);

    toast({
      title: "Export Complete",
      description: `${dataToExport.length} payroll records exported to PDF.`,
    });
  };

  const handleGeneratePayroll = () => {
    generatePayroll.mutate(
      { month: currentMonth, year: currentYear },
      {
        onSuccess: (data) => {
          toast({
            title: "Payroll Generated",
            description: `Successfully generated payroll for ${data.count} employees.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Failed to Generate Payroll",
            description:
              error instanceof Error ? error.message : "An error occurred.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleView = (record: PayrollRecord) => {
    setSelectedRecord(record);
    setViewDialogOpen(true);
  };

  const handleMarkProcessed = (record: PayrollRecord) => {
    updateStatus.mutate(
      { id: record.runId, status: "processed" },
      {
        onSuccess: () => {
          toast({
            title: "Status Updated",
            description: `Payroll run for ${record.month} ${record.year} marked as processed.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Update Failed",
            description: error instanceof Error ? error.message : "Failed to update payroll status.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleMarkPaid = (record: PayrollRecord) => {
    updateStatus.mutate(
      { id: record.runId, status: "paid" },
      {
        onSuccess: () => {
          toast({
            title: "Status Updated",
            description: `Payroll run for ${record.month} ${record.year} marked as paid.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Update Failed",
            description: error instanceof Error ? error.message : "Failed to update payroll status.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleRevertToPending = (record: PayrollRecord) => {
    if (record.status === "paid") {
      toast({
        title: "Action Blocked",
        description: "Disbursed payroll cannot be reverted. Use a correction workflow instead.",
        variant: "destructive",
      });
      return;
    }
    updateStatus.mutate(
      { id: record.runId, status: "draft" },
      {
        onSuccess: () => {
          toast({
            title: "Status Updated",
            description: `Payroll run reverted to pending.`,
          });
        },
        onError: (error) => {
          toast({
            title: "Update Failed",
            description: error instanceof Error ? error.message : "Failed to update payroll status.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleBulkMarkProcessed = (ids: string[]) => {
    bulkUpdateStatus.mutate(
      { ids, status: "processed" },
      {
        onSuccess: (data) => {
          toast({
            title: "Bulk Update Successful",
            description: `${data.count} records marked as processed.`,
          });
        },
        onError: () => {
          toast({
            title: "Update Failed",
            description: "Failed to update payroll status.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleBulkMarkPaid = (ids: string[]) => {
    bulkUpdateStatus.mutate(
      { ids, status: "paid" },
      {
        onSuccess: (data) => {
          toast({
            title: "Bulk Update Successful",
            description: `${data.count} records marked as paid.`,
          });
        },
        onError: () => {
          toast({
            title: "Update Failed",
            description: "Failed to update payroll status.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleBulkRevertToPending = (ids: string[]) => {
    bulkUpdateStatus.mutate(
      { ids, status: "draft" },
      {
        onSuccess: (data) => {
          toast({
            title: "Bulk Update Successful",
            description: `${data.count} records reverted to pending.`,
          });
        },
        onError: () => {
          toast({
            title: "Update Failed",
            description: "Failed to update payroll status.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const currentPayrollNet = currentRecords.reduce(
    (sum, record) => sum + record.netSalary,
    0
  );

  const currentPaid = currentRecords.filter((record) => record.status === "paid").length;
  const currentProcessing = currentRecords.filter(
    (record) => record.status === "processing"
  ).length;
  const currentPending = currentRecords.filter(
    (record) => record.status === "pending"
  ).length;

  // Build a human-readable label for the run month shown in stats
  const statsRunLabel = (() => {
    const rm = stats?.effectiveRunMonth;
    if (!rm) return "Current month";
    const [yr, mo] = rm.split("-");
    const label = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" })
      .format(new Date(Number(yr), Number(mo) - 1, 1));
    return stats?.isFallback ? `Last run: ${label}` : label;
  })();

  const payrollStats = [
    {
      label: "Total Payroll",
      value: formatCurrency(stats?.totalPayroll || currentPayrollNet || 0),
      description: statsRunLabel,
      icon: <IndianRupee className="h-5 w-5" />,
      tone: "payroll" as const,
    },
    {
      label: "Employees",
      value: String(stats?.employeeCount || 0),
      description: "Active employees in payroll scope.",
      icon: <Users className="h-5 w-5" />,
      tone: "people" as const,
    },
    {
      label: "Average Salary",
      value: formatCurrency(stats?.avgSalary || 0),
      description: statsRunLabel,
      icon: <TrendingUp className="h-5 w-5" />,
      tone: "brand" as const,
    },
    {
      label: "Pending",
      value: String(stats?.pending || currentPending || 0),
      description: "Payroll records awaiting processing.",
      icon: <CreditCard className="h-5 w-5" />,
      tone: "warning" as const,
    },
  ];

  const renderPagination = ({
    page,
    totalPages,
    totalItems,
    pageSize,
    onPageChange,
    onPageSizeChange,
  }: {
    page: number;
    totalPages: number;
    totalItems: number;
    pageSize: number;
    onPageChange: (nextPage: number) => void;
    onPageSizeChange: (nextPageSize: number) => void;
  }) => {
    if (totalPages <= 1 && totalItems <= pageSize) return null;

    const pages: (number | "ellipsis")[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);

      if (page > 3) pages.push("ellipsis");

      for (
        let i = Math.max(2, page - 1);
        i <= Math.min(totalPages - 1, page + 1);
        i++
      ) {
        pages.push(i);
      }

      if (page < totalPages - 2) pages.push("ellipsis");

      pages.push(totalPages);
    }

    const canGoPrevious = page > 1;
    const canGoNext = page < totalPages;

    return (
      <div className="mt-4 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 sm:justify-start">
          <span>
            Showing {Math.min((page - 1) * pageSize + 1, totalItems || 1)} to{" "}
            {Math.min(page * pageSize, totalItems)} of {totalItems}
          </span>

          <Select
            value={pageSize.toString()}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="h-8 w-[88px] rounded-lg bg-white text-xs">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="5">5 / page</SelectItem>
              <SelectItem value="10">10 / page</SelectItem>
              <SelectItem value="20">20 / page</SelectItem>
              <SelectItem value="50">50 / page</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => canGoPrevious && onPageChange(page - 1)}
                className={
                  !canGoPrevious
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>

            {pages.map((pageNumber, index) =>
              pageNumber === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={pageNumber}>
                  <PaginationLink
                    onClick={() => onPageChange(pageNumber)}
                    isActive={page === pageNumber}
                    className="cursor-pointer"
                  >
                    {pageNumber}
                  </PaginationLink>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <PaginationNext
                onClick={() => canGoNext && onPageChange(page + 1)}
                className={
                  !canGoNext
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  };

  const hasCurrentFilters = !!(searchQuery.trim() || monthFilter !== "current" || currentStatus !== "all" || currentBranchId !== "all" || currentDeptId !== "all" || currentProcessId !== "all");
  const hasHistoryFilters = !!(
    historySearchQuery.trim() ||
    historyMonth !== "all" ||
    historyYear !== "all" ||
    historyStatus !== "all" ||
    historyBranchId !== "all" ||
    historyDeptId !== "all" ||
    historyProcessId !== "all"
  );

  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-5">
          <Skeleton className="h-32 rounded-2xl" />

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-32 rounded-2xl" />
            ))}
          </div>

          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (!canAccessPayroll) {
    return (
      <DashboardLayout>
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
              <ShieldAlert className="h-7 w-7" />
            </div>

            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
              Access Denied
            </h2>

            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              You do not have permission to access payroll management. Only
              administrators and HR personnel can manage payroll.
            </p>
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <EnterprisePageHeader
          eyebrow="Payroll Management"
          title="Payroll Command Center"
          description="Generate, process, pay and review monthly payroll records with a consistent enterprise workspace."
          status="info"
          secondaryActions={
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <DateRangeExportDialog
                title="Export Payroll Records"
                description="Export payroll records with optional month/year date range."
                onExportCSV={exportToCSV}
                onExportPDF={exportToPDF}
              />
            </div>
          }
          primaryAction={
              <Button
                className="h-10 rounded-[var(--r-md)] bg-[var(--brand-500)] px-4 text-xs font-semibold text-white hover:bg-[var(--brand-600)]"
                onClick={handleGeneratePayroll}
                disabled={generatePayroll.isPending}
              >
                {generatePayroll.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="mr-2 h-4 w-4" />
                )}
                {generatePayroll.isPending ? "Generating..." : "Generate Payroll"}
              </Button>
          }
        />

        <div className="w-full">
          <KpiCardGrid>
            {payrollStats.map((stat) => (
              <KpiCard
                key={stat.label}
                title={stat.label}
                value={stat.value}
                description={stat.description}
                icon={stat.icon}
                tone={stat.tone}
              />
            ))}
          </KpiCardGrid>
          {currentMonthRun && (
            <div className="mt-2 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBranchBreakdownRunId(currentMonthRun.id);
                  setBranchBreakdownOpen(true);
                }}
              >
                Branch Breakdown
              </Button>
            </div>
          )}
        </div>

        {/* Incentive-applied warning: shown when current month run has incentives locked in */}
        {currentMonthRun?.incentives_applied_at && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <div>
              <span className="font-semibold">Incentives applied to this month's run — </span>
              recalculating will wipe them. Re-apply incentives from{" "}
              <a href="/payroll/incentives" className="underline font-medium">Incentives page</a> after any recalculation.
              Applied on {new Date(currentMonthRun.incentives_applied_at).toLocaleString("en-IN")}.
            </div>
          </div>
        )}

        <ExceptionPanel
          title="Payroll status checkpoints"
          severity={currentPending > 0 ? "warning" : "info"}
          items={[
            {
              id: "pending",
              title: `${currentPending} pending`,
              description: "Payroll records awaiting processing.",
              meta: "Draft",
            },
            {
              id: "processing",
              title: `${currentProcessing} processed`,
              description: "Records currently in payroll processing.",
              meta: "Processing",
            },
            {
              id: "paid",
              title: `${currentPaid} paid`,
              description: "Completed payroll records for this view.",
              meta: "Completed",
            },
          ]}
        />

        {/* Tabs */}
        <section className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm">
          <Tabs defaultValue="current" className="w-full">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                  Payroll Workspace
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Manage current payroll, historical records and salary structures.
                </p>
              </div>

              <TabsList className="grid w-full grid-cols-6 lg:w-auto">
                <TabsTrigger value="current">Current Payroll</TabsTrigger>
                <TabsTrigger value="history">Payroll History</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="salary">Salary Structure</TabsTrigger>
                <TabsTrigger value="finance">Finance Queue</TabsTrigger>
                <TabsTrigger value="signoff">Signoff</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="current" className="mt-0 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_140px_140px]">
                  <div className="relative sm:col-span-2 xl:col-span-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search by name, email or employee code..."
                      className="h-10 rounded-xl border-slate-200 bg-white pl-10 pr-9 text-sm shadow-sm"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Select value={monthFilter} onValueChange={setMonthFilter}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">Current Month</SelectItem>
                      <SelectItem value="all">All Months</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={currentStatus} onValueChange={setCurrentStatus}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_auto]">
                  <Select value={currentBranchId} onValueChange={setCurrentBranchId}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="All Branches" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Branches</SelectItem>
                      {(directoryMasters?.branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={currentDeptId} onValueChange={setCurrentDeptId}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={currentProcessId} onValueChange={setCurrentProcessId}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="All Processes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Processes</SelectItem>
                      {(directoryMasters?.processes ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hasCurrentFilters && (
                    <button
                      type="button"
                      className="inline-flex h-10 items-center justify-center gap-1 rounded-xl px-3 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-900"
                      onClick={() => {
                        setSearchQuery("");
                        setMonthFilter("current");
                        setCurrentStatus("all");
                        setCurrentBranchId("all");
                        setCurrentDeptId("all");
                        setCurrentProcessId("all");
                        setCurrentPage(1);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {recordsError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
                  <p className="font-medium text-destructive">Failed to load payroll records</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {recordsError instanceof Error ? recordsError.message : "An unexpected error occurred. Please try again."}
                  </p>
                </div>
              ) : isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((item) => (
                    <Skeleton key={item} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : currentRecords.length === 0 ? (
                <EmptyState
                  title="No Payroll Records"
                  description={
                    !hasCurrentFilters
                      ? "Generate payroll to see records here."
                      : "No records match your current search criteria."
                  }
                  action={
                    !hasCurrentFilters ? (
                      <Button
                        className="h-10 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800"
                        onClick={handleGeneratePayroll}
                        disabled={generatePayroll.isPending}
                      >
                        {generatePayroll.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Wallet className="mr-2 h-4 w-4" />
                        )}
                        Generate Payroll
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  {searchQuery.trim() && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
                      <span className="font-semibold">{currentTotalItems}</span> result{currentTotalItems !== 1 ? 's' : ''} found for "{searchQuery.trim()}"
                    </div>
                  )}
                  <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white${isPlaceholderData ? " opacity-70 transition-opacity" : ""}`}>
                    <PayrollTable
                      records={currentRecords}
                      onView={handleView}
                      onMarkProcessed={handleMarkProcessed}
                      onMarkPaid={handleMarkPaid}
                      onRevertToPending={handleRevertToPending}
                      onBulkMarkProcessed={handleBulkMarkProcessed}
                      onBulkMarkPaid={handleBulkMarkPaid}
                      onBulkRevertToPending={handleBulkRevertToPending}
                      isBulkUpdating={bulkUpdateStatus.isPending}
                    />
                  </div>
                  {renderPagination({
                    page: currentPage,
                    totalPages: currentTotalPages,
                    totalItems: currentTotalItems,
                    pageSize: currentPageSize,
                    onPageChange: setCurrentPage,
                    onPageSizeChange: setCurrentPageSize,
                  })}
                </>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-0 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_140px_140px_140px]">
                  <div className="relative sm:col-span-2 xl:col-span-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search by name, email or employee code..."
                      className="h-10 rounded-xl border-slate-200 bg-white pl-10 pr-9 text-sm shadow-sm"
                      value={historySearchQuery}
                      onChange={(event) => setHistorySearchQuery(event.target.value)}
                    />
                    {historySearchQuery && (
                      <button
                        type="button"
                        onClick={() => setHistorySearchQuery("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Select value={historyMonth} onValueChange={setHistoryMonth}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Months</SelectItem>
                      {months.map((month) => (
                        <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={historyYear} onValueChange={setHistoryYear}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Years</SelectItem>
                      {availableYears.map((year) => (
                        <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={historyStatus} onValueChange={setHistoryStatus}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_auto]">
                  <Select value={historyBranchId} onValueChange={setHistoryBranchId}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="All Branches" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Branches</SelectItem>
                      {(directoryMasters?.branches ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={historyDeptId} onValueChange={setHistoryDeptId}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="All Departments" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={historyProcessId} onValueChange={setHistoryProcessId}>
                    <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="All Processes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Processes</SelectItem>
                      {(directoryMasters?.processes ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hasHistoryFilters && (
                    <button
                      type="button"
                      className="inline-flex h-10 items-center justify-center gap-1 rounded-xl px-3 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-900"
                      onClick={() => {
                        setHistorySearchQuery("");
                        setHistoryMonth("all");
                        setHistoryYear("all");
                        setHistoryStatus("all");
                        setHistoryBranchId("all");
                        setHistoryDeptId("all");
                        setHistoryProcessId("all");
                        setHistoryPage(1);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {isLoadingHistory || isLoadingHistoryRecords ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((item) => (
                    <Skeleton key={item} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : historyRecords.length === 0 ? (
                <EmptyState
                  title="No Records Found"
                  description={
                    !hasHistoryFilters
                      ? "No payroll history is available yet."
                      : "No payroll records match your filter criteria."
                  }
                />
              ) : (
                <>
                  {historySearchQuery.trim() && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
                      <span className="font-semibold">{historyTotalItems}</span> result{historyTotalItems !== 1 ? 's' : ''} found for "{historySearchQuery.trim()}"
                    </div>
                  )}
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <PayrollTable
                      records={historyRecords}
                      onView={handleView}
                      onMarkProcessed={handleMarkProcessed}
                      onMarkPaid={handleMarkPaid}
                      onRevertToPending={handleRevertToPending}
                      onBulkMarkProcessed={handleBulkMarkProcessed}
                      onBulkMarkPaid={handleBulkMarkPaid}
                      onBulkRevertToPending={handleBulkRevertToPending}
                      isBulkUpdating={bulkUpdateStatus.isPending}
                    />
                  </div>

                  {renderPagination({
                    page: historyPage,
                    totalPages: historyTotalPages,
                    totalItems: historyTotalItems,
                    pageSize: historyPageSize,
                    onPageChange: setHistoryPage,
                    onPageSizeChange: setHistoryPageSize,
                  })}
                </>
              )}

              {/* Salary Sheet Downloads by Run */}
              {runSummaries.length > 0 && (
                <div className="rounded-lg border bg-card p-4">
                  <h4 className="font-semibold text-sm mb-3">Salary Sheet Downloads</h4>
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="px-3 py-2 text-left">Run Month</th>
                          <th className="px-3 py-2 text-left">Status</th>
                          <th className="px-3 py-2 text-right">Employees</th>
                          <th className="px-3 py-2 text-left">Export</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runSummaries.slice(0, 24).map((run) => (
                          <tr key={run.id} className="border-t">
                            <td className="px-3 py-2 font-medium">{run.run_month}</td>
                            <td className="px-3 py-2 capitalize">{run.status}</td>
                            <td className="px-3 py-2 text-right">{run.total_employees}</td>
                            <td className="px-3 py-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const a = document.createElement("a");
                                  a.href = `/api/payroll/runs/${run.id}/salary-sheet-export`;
                                  a.download = `Salary Sheet ${run.run_month}.xlsx`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                }}
                              >
                                <Download className="h-3.5 w-3.5 mr-1" />
                                XLSX
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="analytics" className="mt-0 space-y-4">
              <LifecyclePipelineCard />
              <PayrollAnalytics availableMonths={availableMonths} />
            </TabsContent>

            <TabsContent value="salary" className="mt-0">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <SalaryStructureManager />
              </div>
            </TabsContent>

            <TabsContent value="finance" className="mt-0">
              <FinanceApprovalQueue />
            </TabsContent>

            <TabsContent value="signoff" className="mt-0 space-y-4">
              <SignoffTab />
            </TabsContent>
          </Tabs>
        </section>

        <PayslipViewDialog
          open={viewDialogOpen}
          onOpenChange={setViewDialogOpen}
          record={selectedRecord}
        />
      </div>
    </DashboardLayout>
  );
};

// ── Run Lifecycle Board ──────────────────────────────────────────────────────

function LifecyclePipelineCard() {
  const { data: roleData } = useUserRole();
  const roleKeys = roleData?.roleKeys ?? [];
  const isPayrollRoleOK = roleKeys.some((r) => ["payroll", "payroll_head", "admin", "super_admin"].includes(r));

  const { data: runsRaw } = useQuery({
    queryKey: ["payroll-all-runs"],
    queryFn: () => hrmsApi.get("/api/payroll/runs?limit=100").then((r) => r.data),
  });
  const allRuns = (runsRaw as any[]) ?? [];

  const stages = ["draft", "calculating", "reviewed", "approved", "locked", "finance-approved", "disbursed"];
  const stageCounts: Record<string, number> = {};
  stages.forEach((s) => {
    stageCounts[s] = allRuns.filter((r: any) => r.status === s).length;
  });

  const getStageColor = (stage: string) => {
    const count = stageCounts[stage];
    return count > 0 ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-500";
  };

  if (!isPayrollRoleOK) return null;

  const totalRuns = allRuns.length;
  const completedRuns = stageCounts["disbursed"];
  const activeRuns = totalRuns - completedRuns;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-base">Run Pipeline</h3>
        <p className="text-xs text-muted-foreground mt-1">Payroll run lifecycle stages</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-slate-50 p-2 border"><p className="text-muted-foreground text-xs">Total Runs</p><p className="font-semibold">{totalRuns}</p></div>
        <div className="rounded-lg bg-blue-50 p-2 border border-blue-200"><p className="text-blue-600 text-xs">In Progress</p><p className="font-semibold text-blue-700">{activeRuns}</p></div>
        <div className="rounded-lg bg-green-50 p-2 border border-green-200"><p className="text-green-600 text-xs">Completed</p><p className="font-semibold text-green-700">{completedRuns}</p></div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {stages.map((stage, idx) => (
          <div key={stage} className="flex items-center gap-1 flex-shrink-0">
            <div
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium text-center min-w-20 ${getStageColor(stage)}`}
            >
              <div className="text-[10px] capitalize font-semibold">{stage}</div>
              <div className="text-xs font-bold">{stageCounts[stage]}</div>
            </div>
            {idx < stages.length - 1 && <div className="text-muted-foreground text-lg">→</div>}
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-muted/30 p-3">
        <h4 className="font-medium text-xs mb-2">Stage Breakdown</h4>
        <table className="w-full text-xs">
          <tbody>
            {stages.map((stage) => (
              <tr key={stage} className="border-b last:border-0">
                <td className="py-1 capitalize">{stage}</td>
                <td className="py-1 text-right font-medium">{stageCounts[stage]} run{stageCounts[stage] !== 1 ? "s" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── TDS Mode Panel (draft / calculating runs only) ───────────────────────────

function TdsModePanel() {
  const { toast } = useToast();
  const { data: roleData } = useUserRole();
  const roleKeys = roleData?.roleKeys ?? [];
  const canEdit = roleKeys.some((r) =>
    ["payroll_head", "super_admin", "admin", "finance"].includes(r)
  );
  const qc = useQueryClient();

  const { data: allRunsRaw } = useQuery<any[]>({
    queryKey: ["payroll-all-runs"],
    queryFn: () => hrmsApi.get("/api/payroll/runs?limit=100").then((r: any) => r.data ?? []),
    staleTime: 30_000,
  });

  const draftRuns = (allRunsRaw ?? []).filter((r: any) =>
    ["draft", "calculating"].includes(r.status)
  );

  const tdsMut = useMutation({
    mutationFn: ({ runId, tds_mode }: { runId: string; tds_mode: string }) =>
      hrmsApi.patch(`/api/payroll/runs/${runId}/tds-mode`, { tds_mode }),
    onSuccess: (_d, vars) => {
      toast({ title: `TDS mode set to ${vars.tds_mode}` });
      void qc.invalidateQueries({ queryKey: ["payroll-all-runs"] });
    },
    onError: (e: any) =>
      toast({ title: "Failed to update TDS mode", description: e?.message, variant: "destructive" }),
  });

  if (draftRuns.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">TDS Mode — Draft Runs</CardTitle>
        <p className="text-xs text-slate-500 mt-0.5">
          Set <strong>Auto</strong> to compute TDS from the tax engine (reads DB slabs + employee declarations).
          Set <strong>Manual</strong> to enter TDS via the manual override table. Must be set before Calculate.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {draftRuns.map((run: any) => {
          const mode: string = run.tds_mode ?? "manual";
          const isPending = tdsMut.isPending && (tdsMut.variables as any)?.runId === run.id;
          return (
            <div
              key={run.id}
              className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
            >
              <div className="text-sm">
                <span className="font-medium">{run.run_month}</span>
                <span className="ml-2 text-slate-400 text-xs capitalize">{run.status}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canEdit || isPending}
                  onClick={() => tdsMut.mutate({ runId: run.id, tds_mode: "auto" })}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    mode === "auto"
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "border border-slate-200 bg-white text-slate-500 hover:border-emerald-400 hover:text-emerald-700"
                  } disabled:opacity-40`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  disabled={!canEdit || isPending}
                  onClick={() => tdsMut.mutate({ runId: run.id, tds_mode: "manual" })}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    mode === "manual"
                      ? "bg-amber-500 text-white shadow-sm"
                      : "border border-slate-200 bg-white text-slate-500 hover:border-amber-400 hover:text-amber-700"
                  } disabled:opacity-40`}
                >
                  Manual
                </button>
              </div>
            </div>
          );
        })}
        {!canEdit && (
          <p className="text-xs text-slate-400">Only Payroll Head, Finance, or Admin can change TDS mode.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Payroll Signoff Tab ──────────────────────────────────────────────────────

function SignoffTab() {
  const { toast } = useToast();
  const { data: roleData } = useUserRole();
  const roleKeys = roleData?.roleKeys ?? [];
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [remarks, setRemarks] = useState("");

  const { data: runs = [], isLoading: loadingRuns } = useQuery<any[]>({
    queryKey: ["payroll-signoff-runs"],
    queryFn: () =>
      hrmsApi
        .get<{ success: boolean; data: any[] }>("/api/payroll/signoff/runs")
        .then((r) => (r as any).data ?? []),
    staleTime: 30_000,
  });

  const { data: status } = useQuery<any>({
    queryKey: ["payroll-signoff-status", selectedRunId],
    queryFn: () =>
      hrmsApi
        .get<{ success: boolean; data: any }>(
          `/api/payroll/signoff/runs/${selectedRunId}/status`
        )
        .then((r) => (r as any).data),
    enabled: !!selectedRunId,
    staleTime: 15_000,
  });

  const { data: tdsSummary } = useQuery<{
    total_tds: number;
    employee_count_with_tds: number;
    avg_tds: number;
    regime_breakdown: { new: number; old: number };
  }>({
    queryKey: ["payroll-signoff-tds-summary", selectedRunId],
    queryFn: () =>
      hrmsApi
        .get<{ success: boolean; data: any }>(
          `/api/payroll/signoff/runs/${selectedRunId}/tds-summary`
        )
        .then((r) => (r as any).data),
    enabled: !!selectedRunId,
    staleTime: 60_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["payroll-signoff-runs"] });
    void qc.invalidateQueries({ queryKey: ["payroll-signoff-status", selectedRunId] });
    void qc.invalidateQueries({ queryKey: ["payroll-signoff-tds-summary", selectedRunId] });
  };

  const financeApproveMut = useMutation({
    mutationFn: () =>
      hrmsApi.post(`/api/payroll/signoff/runs/${selectedRunId}/finance-approve`, { remarks }),
    onSuccess: () => { toast({ title: "Finance approved" }); setRemarks(""); invalidate(); },
    onError: (e: any) =>
      toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const ceoAckMut = useMutation({
    mutationFn: () =>
      hrmsApi.post(`/api/payroll/signoff/runs/${selectedRunId}/ceo-acknowledge`, { remarks }),
    onSuccess: () => { toast({ title: "CEO acknowledged" }); setRemarks(""); invalidate(); },
    onError: (e: any) =>
      toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const revokeMut = useMutation({
    mutationFn: () =>
      hrmsApi.post(`/api/payroll/signoff/runs/${selectedRunId}/finance-revoke`, {}),
    onSuccess: () => { toast({ title: "Finance approval revoked" }); invalidate(); },
    onError: (e: any) =>
      toast({ title: "Revoke failed", description: e?.message, variant: "destructive" }),
  });

  const markDisbursedMut = useMutation({
    mutationFn: () =>
      hrmsApi.patch(`/api/payroll/runs/${selectedRunId}/status`, { status: "disbursed" }),
    onSuccess: () => { toast({ title: "Run marked as disbursed" }); invalidate(); },
    onError: (e: any) =>
      toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  const fmt = (n: number) =>
    `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const fmtDate = (d: string | null) =>
    d
      ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "—";

  return (
    <div className="space-y-4">
      <TdsModePanel />

      <div className="flex items-center gap-3">
        <Label className="whitespace-nowrap text-sm font-medium">Payroll Run</Label>
        <select
          className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-64"
          value={selectedRunId}
          onChange={(e) => setSelectedRunId(e.target.value)}
        >
          <option value="">Select run…</option>
          {loadingRuns && <option disabled>Loading…</option>}
          {runs.map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.run_month} — {r.status}
            </option>
          ))}
        </select>
      </div>

      {!selectedRunId && (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center text-slate-400 text-sm">
          Select a payroll run to review sign-off status.
        </div>
      )}

      {selectedRunId && status && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Run Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Month</span>
                  <span className="font-medium">{status.run_month}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <Badge variant="secondary">{status.status}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Net Payable</span>
                  <span className="font-semibold text-emerald-700">
                    {fmt(status.total_net_salary ?? 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">CEO Sign-off Required</span>
                  <span>{status.ceo_required ? "Yes" : "No"}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Approval Chain</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-md bg-slate-50 p-3 space-y-1">
                  <p className="font-medium text-slate-700">Finance Approval</p>
                  {status.finance_approved_at ? (
                    <p className="text-emerald-700">
                      ✓ Approved on {fmtDate(status.finance_approved_at)}
                      {status.finance_remarks ? ` — "${status.finance_remarks}"` : ""}
                    </p>
                  ) : (
                    <p className="text-amber-600">Pending</p>
                  )}
                </div>
                {status.ceo_required && (
                  <div className="rounded-md bg-slate-50 p-3 space-y-1">
                    <p className="font-medium text-slate-700">CEO Acknowledgement</p>
                    {status.ceo_acknowledged_at ? (
                      <p className="text-emerald-700">
                        ✓ Acknowledged on {fmtDate(status.ceo_acknowledged_at)}
                        {status.ceo_remarks ? ` — "${status.ceo_remarks}"` : ""}
                      </p>
                    ) : (
                      <p className="text-amber-600">Pending</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {tdsSummary && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">TDS Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-slate-500 text-xs">Total TDS</p>
                    <p className="font-semibold text-slate-900">{fmt(tdsSummary.total_tds)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">Employees with TDS</p>
                    <p className="font-semibold text-slate-900">{tdsSummary.employee_count_with_tds}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">Avg TDS / Employee</p>
                    <p className="font-semibold text-slate-900">{fmt(tdsSummary.avg_tds)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-xs">Regime</p>
                    <p className="font-semibold text-slate-900">
                      {tdsSummary.regime_breakdown.new}N / {tdsSummary.regime_breakdown.old}O
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-sm">Remarks (optional)</Label>
                <Input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Add approval remarks…"
                  className="mt-1"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {!status.finance_approved_at &&
                  roleKeys.some((r) => ["finance", "super_admin", "payroll_head", "admin"].includes(r)) && (
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={() => financeApproveMut.mutate()}
                      disabled={financeApproveMut.isPending}
                    >
                      {financeApproveMut.isPending ? "Approving…" : "Finance Approve"}
                    </Button>
                  )}
                {status.ceo_required &&
                  !status.ceo_acknowledged_at &&
                  status.finance_approved_at &&
                  roleKeys.some((r) => ["ceo", "super_admin"].includes(r)) && (
                    <Button
                      size="sm"
                      onClick={() => ceoAckMut.mutate()}
                      disabled={ceoAckMut.isPending}
                    >
                      {ceoAckMut.isPending ? "Acknowledging…" : "CEO Acknowledge"}
                    </Button>
                  )}
                {status.finance_approved_at && roleKeys.includes("super_admin") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-300 hover:bg-red-50"
                    onClick={() => revokeMut.mutate()}
                    disabled={revokeMut.isPending}
                  >
                    {revokeMut.isPending ? "Revoking…" : "Revoke Finance Approval"}
                  </Button>
                )}
                {status.status === "locked" &&
                  !!status.finance_approved_at &&
                  (!status.ceo_required || !!status.ceo_acknowledged_at) &&
                  roleKeys.some((r) => ["finance", "super_admin", "payroll_head", "admin"].includes(r)) && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => markDisbursedMut.mutate()}
                      disabled={markDisbursedMut.isPending}
                    >
                      {markDisbursedMut.isPending ? "Marking…" : "Mark as Disbursed"}
                    </Button>
                  )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Finance Approval Queue ───────────────────────────────────────────────────

const fmtCurrency = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(v ?? 0));
const fmtDateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

function FinanceApprovalQueue() {
  const { data: roleData } = useUserRole();
  const roleKeys = roleData?.roleKeys ?? [];
  const isFinance = roleKeys.some((r) => ["finance", "admin", "super_admin"].includes(r));
  const { toast } = useToast();
  const [approvalModal, setApprovalModal] = useState<{ runId: string; runMonth: string } | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const { data: runsRaw, refetch: refetchRuns } = useQuery({
    queryKey: ["payroll-runs-locked"],
    queryFn: () => hrmsApi.get("/api/payroll/runs?status=locked").then((r) => r.data),
    enabled: isFinance,
  });
  const runs = (runsRaw as any[]) ?? [];

  const approveMut = useMutation({
    mutationFn: (runId: string) =>
      hrmsApi.post(`/api/payroll/runs/${runId}/finance-approve`, {}),
    onSuccess: () => {
      toast({ title: "Success", description: "Run approved and marked for disbursement" });
      setApprovalModal(null);
      setConfirmChecked(false);
      void refetchRuns();
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e?.response?.data?.message ?? "Approval failed", variant: "destructive" }),
  });

  if (!isFinance) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
        Finance role required to view this queue
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-0">
      <div className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold mb-2">Runs Awaiting Finance Approval</h3>
        <p className="text-sm text-muted-foreground mb-4">Runs locked and ready for disbursement authorization</p>

        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No runs pending finance approval
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Run Month</th>
                  <th className="px-3 py-2 text-right">Employees</th>
                  <th className="px-3 py-2 text-right">Total Gross (₹)</th>
                  <th className="px-3 py-2 text-left">Last Updated</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run: any) => (
                  <tr key={run.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{run.run_month}</td>
                    <td className="px-3 py-2 text-right">{run.employee_count ?? 0}</td>
                    <td className="px-3 py-2 text-right">₹{fmtCurrency(run.total_gross)}</td>
                    <td className="px-3 py-2 text-sm">{fmtDateTime(run.updated_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => {
                            setApprovalModal({ runId: run.id, runMonth: run.run_month });
                            setConfirmChecked(false);
                          }}
                        >
                          Review & Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          title="Download Salary Sheet XLSX"
                          onClick={() => {
                            const url = `/api/payroll/runs/${run.id}/salary-sheet-export`;
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `Salary Sheet ${run.run_month}.xlsx`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                          }}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Salary Sheet
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {approvalModal && (
        <Dialog open={!!approvalModal} onOpenChange={() => setApprovalModal(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Approve Run for Disbursement</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-muted p-3 text-sm space-y-2">
                <div>
                  <span className="font-medium">Run Month:</span> {approvalModal.runMonth}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="confirm-cb"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)}
                  className="mt-1"
                />
                <label htmlFor="confirm-cb" className="text-sm">
                  I have verified all disbursement details and payment methods are correct
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setApprovalModal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                disabled={!confirmChecked || approveMut.isPending}
                onClick={() => approveMut.mutate(approvalModal.runId)}
              >
                {approveMut.isPending ? "Approving..." : "Approve & Mark Disbursed"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// E1.1: Branch Breakdown Dialog Component
function BranchBreakdownDialog({
  open,
  onOpenChange,
  runId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string | null;
}) {
  const { data: breakdown, isLoading } = useQuery({
    queryKey: ["payroll-branch-breakdown", runId],
    queryFn: async () => {
      if (!runId) return [];
      const response = await hrmsApi.get(`/api/payroll/runs/${runId}/branch-breakdown`);
      return response.data.data ?? [];
    },
    enabled: open && !!runId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Branch Breakdown</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-4 py-2 font-semibold">Branch</th>
                  <th className="px-4 py-2 font-semibold text-right">Employee Count</th>
                  <th className="px-4 py-2 font-semibold text-right">Total Gross</th>
                  <th className="px-4 py-2 font-semibold text-right">Total Net</th>
                </tr>
              </thead>
              <tbody>
                {breakdown?.map((row: any, idx: number) => (
                  <tr key={idx} className="border-b">
                    <td className="px-4 py-2">{row.branch_name}</td>
                    <td className="px-4 py-2 text-right">{row.employee_count}</td>
                    <td className="px-4 py-2 text-right">
                      ₹{Number(row.total_gross).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      ₹{Number(row.total_net).toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default Payroll;
