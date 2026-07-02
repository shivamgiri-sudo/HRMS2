import { useMemo, useState, type ReactNode } from "react";
import {
  CreditCard,
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
  useGeneratePayroll,
  usePayrollRecords,
  usePayrollRunSummaries,
  usePayrollStats,
  useUpdatePayrollStatus,
  type PayrollRecord,
} from "@/hooks/usePayroll";
import { useCanAccessPayroll } from "@/hooks/useUserRole";
import { usePagination } from "@/hooks/usePagination";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historyMonth, setHistoryMonth] = useState("all");
  const [historyYear, setHistoryYear] = useState("all");
  const [historyStatus, setHistoryStatus] = useState("all");

  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PayrollRecord | null>(
    null
  );

  const { toast } = useToast();
  const { canAccessPayroll, isLoading: roleLoading } = useCanAccessPayroll();

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  const currentMonthFilters = useMemo(() => ({
    month: monthFilter === "current" ? currentMonth : undefined,
    year:  monthFilter === "current" ? currentYear  : undefined,
  }), [monthFilter, currentMonth, currentYear]);
  const { data: recordsPage, isLoading } = usePayrollRecords(currentMonthFilters);
  const records = recordsPage?.records ?? [];

  // Lightweight run summaries — used for availableYears/Months without fetching all 19k lines
  const { data: runSummaries = [], isLoading: isLoadingHistory } = usePayrollRunSummaries();

  // History records: fetch with selected year/month filters (paginated to avoid full table scan)
  const historyFilters = useMemo(() => ({
    month: historyMonth !== "all" ? parseInt(historyMonth) : undefined,
    year:  historyYear  !== "all" ? parseInt(historyYear)  : undefined,
    limit: 200,
  }), [historyMonth, historyYear]);
  const { data: historyPage } = usePayrollRecords(historyFilters);
  const allRecords = useMemo(() => historyPage?.records ?? [], [historyPage?.records]);

  const { data: stats } = usePayrollStats();

  const generatePayroll = useGeneratePayroll();
  const updateStatus = useUpdatePayrollStatus();
  const bulkUpdateStatus = useBulkUpdatePayrollStatus();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    runSummaries.forEach((r) => {
      const yr = Number(String(r.run_month).split("-")[0]);
      if (yr) years.add(yr);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [runSummaries]);

  const availableMonths = useMemo(() => {
    return runSummaries
      .map((r) => r.run_month)
      .filter(Boolean)
      .sort()
      .reverse();
  }, [runSummaries]);

  const filteredRecords = records.filter((record) => {
    const search = searchQuery.trim().toLowerCase();

    if (!search) return true;

    return (
      record.employee.name.toLowerCase().includes(search) ||
      record.employee.email.toLowerCase().includes(search) ||
      record.employeeCode.toLowerCase().includes(search) ||
      record.month.toLowerCase().includes(search) ||
      record.status.toLowerCase().includes(search)
    );
  });

  const filteredHistoryRecords = useMemo(() => {
    return allRecords.filter((record) => {
      const search = historySearchQuery.trim().toLowerCase();

      const matchesSearch =
        !search ||
        record.employee.name.toLowerCase().includes(search) ||
        record.employee.email.toLowerCase().includes(search) ||
        record.employeeCode.toLowerCase().includes(search) ||
        record.month.toLowerCase().includes(search) ||
        record.status.toLowerCase().includes(search);

      const matchesMonth =
        historyMonth === "all" || record.monthNum === parseInt(historyMonth);

      const matchesYear =
        historyYear === "all" || record.year === parseInt(historyYear);

      const matchesStatus =
        historyStatus === "all" || record.status === historyStatus;

      return matchesSearch && matchesMonth && matchesYear && matchesStatus;
    });
  }, [allRecords, historySearchQuery, historyMonth, historyYear, historyStatus]);

  const {
    currentPage,
    pageSize,
    totalPages,
    totalItems,
    paginatedItems: paginatedHistoryRecords,
    setPage,
    setPageSize,
    canGoNext,
    canGoPrevious,
  } = usePagination(filteredHistoryRecords, { initialPageSize: 10 });

  const getFilteredByDateRange = (
    startDate: Date | undefined,
    endDate: Date | undefined
  ) => {
    const baseData =
      filteredHistoryRecords.length > 0 ? filteredHistoryRecords : allRecords;

    if (!startDate && !endDate) {
      return baseData;
    }

    return baseData.filter((record) => {
      const recordDate = new Date(record.year, record.monthNum - 1, 1);

      if (startDate && endDate) {
        return recordDate >= startDate && recordDate <= endDate;
      }

      if (startDate) {
        return recordDate >= startDate;
      }

      if (endDate) {
        return recordDate <= endDate;
      }

      return true;
    });
  };

  const exportToCSV = (
    startDate: Date | undefined,
    endDate: Date | undefined
  ) => {
    const dataToExport = getFilteredByDateRange(startDate, endDate);

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
      "Month",
      "Year",
      "Basic Salary",
      "Allowances",
      "Deductions",
      "Net Salary",
      "Status",
    ];

    const csvContent = [
      headers.join(","),
      ...dataToExport.map((record) =>
        [
          `"${record.employeeCode}"`,
          `"${record.employee.name}"`,
          `"${record.employee.email}"`,
          `"${record.month}"`,
          `"${record.year}"`,
          `"${record.basic}"`,
          `"${record.allowances}"`,
          `"${record.deductions}"`,
          `"${record.netSalary}"`,
          `"${record.status}"`,
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

  const exportToPDF = (
    startDate: Date | undefined,
    endDate: Date | undefined
  ) => {
    const dataToExport = getFilteredByDateRange(startDate, endDate);

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
          "Email",
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
        record.employee.email,
        record.month,
        record.year,
        formatCurrency(record.basic),
        formatCurrency(record.allowances),
        formatCurrency(record.deductions),
        formatCurrency(record.netSalary),
        record.status.charAt(0).toUpperCase() + record.status.slice(1),
      ]),
      styles: { fontSize: 8 },
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
      { id: record.id, status: "processed" },
      {
        onSuccess: () => {
          toast({
            title: "Status Updated",
            description: `Payroll for ${record.employee.name} marked as processed.`,
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

  const handleMarkPaid = (record: PayrollRecord) => {
    updateStatus.mutate(
      { id: record.id, status: "paid" },
      {
        onSuccess: () => {
          toast({
            title: "Status Updated",
            description: `Payroll for ${record.employee.name} marked as paid.`,
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

  const handleRevertToPending = (record: PayrollRecord) => {
    updateStatus.mutate(
      { id: record.id, status: "draft" },
      {
        onSuccess: () => {
          toast({
            title: "Status Updated",
            description: `Payroll for ${record.employee.name} reverted to pending.`,
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

  const currentPayrollNet = records.reduce(
    (sum, record) => sum + record.netSalary,
    0
  );

  const currentPaid = records.filter((record) => record.status === "paid").length;
  const currentProcessing = records.filter(
    (record) => record.status === "processing"
  ).length;
  const currentPending = records.filter(
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

  const renderHistoryPagination = () => {
    if (totalPages <= 1) return null;

    const pages: (number | "ellipsis")[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);

      if (currentPage > 3) pages.push("ellipsis");

      for (
        let i = Math.max(2, currentPage - 1);
        i <= Math.min(totalPages - 1, currentPage + 1);
        i++
      ) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) pages.push("ellipsis");

      pages.push(totalPages);
    }

    return (
      <div className="mt-4 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 sm:justify-start">
          <span>
            Showing {(currentPage - 1) * pageSize + 1} to{" "}
            {Math.min(currentPage * pageSize, totalItems)} of {totalItems}
          </span>

          <Select
            value={pageSize.toString()}
            onValueChange={(value) => setPageSize(Number(value))}
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
                onClick={() => canGoPrevious && setPage(currentPage - 1)}
                className={
                  !canGoPrevious
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>

            {pages.map((page, index) =>
              page === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={page}>
                  <PaginationLink
                    onClick={() => setPage(page)}
                    isActive={currentPage === page}
                    className="cursor-pointer"
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <PaginationNext
                onClick={() => canGoNext && setPage(currentPage + 1)}
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

  const hasCurrentFilters = searchQuery.trim() || monthFilter !== "current";
  const hasHistoryFilters =
    historySearchQuery.trim() ||
    historyMonth !== "all" ||
    historyYear !== "all" ||
    historyStatus !== "all";

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

              <TabsList className="grid w-full grid-cols-4 lg:w-[640px]">
                <TabsTrigger value="current">Current Payroll</TabsTrigger>
                <TabsTrigger value="history">Payroll History</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="salary">Salary Structure</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="current" className="mt-0 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                    <Input
                      placeholder="Search employee name, email, code, month or status..."
                      className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm shadow-sm"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </div>

                  <Select value={monthFilter} onValueChange={setMonthFilter}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="current">Current Month</SelectItem>
                      <SelectItem value="all">All Records</SelectItem>
                    </SelectContent>
                  </Select>

                  {hasCurrentFilters && (
                    <button
                      type="button"
                      className="inline-flex h-11 items-center justify-center gap-1 rounded-xl px-3 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-900"
                      onClick={() => {
                        setSearchQuery("");
                        setMonthFilter("current");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((item) => (
                    <Skeleton key={item} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : filteredRecords.length === 0 ? (
                <EmptyState
                  title="No Payroll Records"
                  description={
                    records.length === 0
                      ? "Generate payroll to see records here."
                      : "No records match your current search criteria."
                  }
                  action={
                    records.length === 0 ? (
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
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <PayrollTable
                    records={filteredRecords}
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
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-0 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-3 xl:grid-cols-[1fr_160px_160px_160px_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                    <Input
                      placeholder="Search payroll history..."
                      className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm shadow-sm"
                      value={historySearchQuery}
                      onChange={(event) =>
                        setHistorySearchQuery(event.target.value)
                      }
                    />
                  </div>

                  <Select value={historyMonth} onValueChange={setHistoryMonth}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="all">All Months</SelectItem>
                      {months.map((month) => (
                        <SelectItem key={month.value} value={month.value}>
                          {month.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={historyYear} onValueChange={setHistoryYear}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="all">All Years</SelectItem>
                      {availableYears.map((year) => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={historyStatus} onValueChange={setHistoryStatus}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="processing">Processing</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>

                  {hasHistoryFilters && (
                    <button
                      type="button"
                      className="inline-flex h-11 items-center justify-center gap-1 rounded-xl px-3 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-900"
                      onClick={() => {
                        setHistorySearchQuery("");
                        setHistoryMonth("all");
                        setHistoryYear("all");
                        setHistoryStatus("all");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {isLoadingHistory ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((item) => (
                    <Skeleton key={item} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : filteredHistoryRecords.length === 0 ? (
                <EmptyState
                  title="No Records Found"
                  description={
                    allRecords.length === 0
                      ? "No payroll history is available yet."
                      : "No payroll records match your filter criteria."
                  }
                />
              ) : (
                <>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <PayrollTable
                      records={paginatedHistoryRecords}
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

                  {renderHistoryPagination()}
                </>
              )}
            </TabsContent>

            <TabsContent value="analytics" className="mt-0">
              <PayrollAnalytics availableMonths={availableMonths} />
            </TabsContent>

            <TabsContent value="salary" className="mt-0">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <SalaryStructureManager />
              </div>
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

export default Payroll;
