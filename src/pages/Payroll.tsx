import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { PayrollTable } from "@/components/payroll/PayrollTable";
import { PayslipViewDialog } from "@/components/payroll/PayslipViewDialog";
import { SalaryStructureManager } from "@/components/payroll/SalaryStructureManager";
import { PayrollAnalytics } from "@/components/payroll/PayrollAnalytics";
import { DateRangeExportDialog } from "@/components/export/DateRangeExportDialog";

import {
  useBulkUpdatePayrollStatus,
  useGeneratePayroll,
  usePayrollRecords,
  usePayrollStats,
  useUpdatePayrollStatus,
  type PayrollRecord,
  type PayrollRecordFilters,
} from "@/hooks/usePayroll";
import { useReportMasters } from "@/hooks/useReportMasters";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

import { Badge } from "@/components/ui/badge";
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

interface PayrollMetricCardProps {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
  tone: "sky" | "emerald" | "indigo" | "amber";
}

const metricToneMap = {
  sky: {
    card: "border-sky-100 bg-gradient-to-br from-white via-white to-sky-50",
    icon: "bg-sky-50 text-sky-700 ring-sky-100",
  },
  emerald: {
    card: "border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  indigo: {
    card: "border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50",
    icon: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  },
  amber: {
    card: "border-amber-100 bg-gradient-to-br from-white via-white to-amber-50",
    icon: "bg-amber-50 text-amber-700 ring-amber-100",
  },
};

const PayrollMetricCard = ({
  label,
  value,
  description,
  icon,
  tone,
}: PayrollMetricCardProps) => {
  const style = metricToneMap[tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer ${style.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {label}
          </p>

          <h3 className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-950">
            {value}
          </h3>
        </div>

        <div className={`rounded-xl p-2.5 ring-1 ${style.icon}`}>{icon}</div>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
};

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

const PAGE_SIZE = 50;

const Payroll = () => {
  // Shared dimension filters
  const [filterBranchId,     setFilterBranchId]     = useState("");
  const [filterDepartmentId, setFilterDepartmentId] = useState("");
  const [filterProcessId,    setFilterProcessId]     = useState("");

  // Current tab
  const [currentSearch,     setCurrentSearch]     = useState("");
  const [currentSearchDbcd, setCurrentSearchDbcd] = useState("");
  const [currentPage,       setCurrentPage]       = useState(1);
  const [monthFilter,       setMonthFilter]       = useState("current");

  // History tab
  const [historySearch,     setHistorySearch]     = useState("");
  const [historySearchDbcd, setHistorySearchDbcd] = useState("");
  const [historyPage,       setHistoryPage]       = useState(1);
  const [historyMonth,      setHistoryMonth]      = useState("all");
  const [historyYear,       setHistoryYear]       = useState("all");
  const [historyStatus,     setHistoryStatus]     = useState("all");

  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<PayrollRecord | null>(
    null
  );

  const { toast } = useToast();
  const { isAdminOrHR, isLoading: roleLoading } = useIsAdminOrHR();

  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  // Debounce effects
  useEffect(() => {
    const t = setTimeout(() => setCurrentSearchDbcd(currentSearch), 300);
    return () => clearTimeout(t);
  }, [currentSearch]);

  useEffect(() => {
    const t = setTimeout(() => setHistorySearchDbcd(historySearch), 300);
    return () => clearTimeout(t);
  }, [historySearch]);

  useEffect(() => { setCurrentPage(1); }, [currentSearchDbcd, filterBranchId, filterDepartmentId, filterProcessId]);
  useEffect(() => { setHistoryPage(1); }, [historySearchDbcd, historyMonth, historyYear, historyStatus, filterBranchId, filterDepartmentId, filterProcessId]);

  // Masters + runs list
  const { data: masters } = useReportMasters();
  const branchOptions     = masters?.branches    ?? [];
  const departmentOptions = masters?.departments ?? [];
  const processOptions    = masters?.processes   ?? [];

  const { data: runsList = [] } = useQuery({
    queryKey: ["payroll-runs-list"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: any[] }>("/api/payroll/runs?limit=24")
      .then((r) => r.data ?? []),
  });

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    runsList.forEach((r: any) => {
      const y = parseInt(String(r.run_month ?? "").split("-")[0]);
      if (y) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [runsList]);

  // Server-side filtered records
  const currentFilters: PayrollRecordFilters = {
    month:        monthFilter === "current" ? currentMonth : undefined,
    year:         monthFilter === "current" ? currentYear  : undefined,
    search:       currentSearchDbcd  || undefined,
    branchId:     filterBranchId     || undefined,
    departmentId: filterDepartmentId || undefined,
    processId:    filterProcessId    || undefined,
    page:  currentPage,
    limit: PAGE_SIZE,
  };
  const { data: currentData, isLoading } = usePayrollRecords(currentFilters);
  const records      = currentData?.records ?? [];
  const currentTotal = currentData?.total   ?? 0;

  const historyFilters: PayrollRecordFilters = {
    ...(historyMonth !== "all" && historyYear !== "all"
      ? { month: parseInt(historyMonth), year: parseInt(historyYear) }
      : {}),
    status:       historyStatus !== "all" ? historyStatus : undefined,
    search:       historySearchDbcd  || undefined,
    branchId:     filterBranchId     || undefined,
    departmentId: filterDepartmentId || undefined,
    processId:    filterProcessId    || undefined,
    page:  historyPage,
    limit: PAGE_SIZE,
  };
  const { data: historyData, isLoading: isLoadingHistory } = usePayrollRecords(historyFilters);
  const allRecords   = historyData?.records ?? [];
  const historyTotal = historyData?.total   ?? 0;

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

  const getFilteredByDateRange = (
    startDate: Date | undefined,
    endDate: Date | undefined
  ) => {
    const baseData =
      allRecords;

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
      { id: record.runId, status: "processed" },
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
      { id: record.runId, status: "paid" },
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
      { id: record.runId, status: "draft" },
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

  const payrollStats = [
    {
      label: "Total Payroll",
      value: formatCurrency(stats?.totalPayroll || currentPayrollNet || 0),
      description: "Current month net salary total.",
      icon: <IndianRupee className="h-5 w-5" />,
      tone: "sky" as const,
    },
    {
      label: "Employees",
      value: String(stats?.employeeCount || 0),
      description: `${stats?.salaryAssignedEmployees || 0} have active salary assignments.`,
      icon: <Users className="h-5 w-5" />,
      tone: "emerald" as const,
    },
    {
      label: "Average Salary",
      value: formatCurrency(stats?.avgSalary || 0),
      description: "Average salary for current payroll.",
      icon: <TrendingUp className="h-5 w-5" />,
      tone: "indigo" as const,
    },
    {
      label: "Pending",
      value: String(stats?.pending || currentPending || 0),
      description: "Active employees not yet included in current month payroll.",
      icon: <CreditCard className="h-5 w-5" />,
      tone: "amber" as const,
    },
  ];

  const renderPagination = (
    page: number,
    total: number,
    setPage: (p: number) => void
  ) => {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) return null;

    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("ellipsis");
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
      if (page < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }

    const start = (page - 1) * PAGE_SIZE + 1;
    const end   = Math.min(page * PAGE_SIZE, total);

    return (
      <div className="mt-4 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row">
        <span className="text-xs text-slate-500">
          Showing {start}–{end} of {total}
        </span>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => page > 1 && setPage(page - 1)}
                className={page <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            {pages.map((p, idx) =>
              p === "ellipsis" ? (
                <PaginationItem key={`e-${idx}`}><PaginationEllipsis /></PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink onClick={() => setPage(p)} isActive={page === p} className="cursor-pointer">{p}</PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                onClick={() => page < totalPages && setPage(page + 1)}
                className={page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  };

  const hasCurrentFilters = !!(currentSearch.trim() || monthFilter !== "current" || filterBranchId || filterDepartmentId || filterProcessId);
  const hasHistoryFilters = !!(historySearch.trim() || historyMonth !== "all" || historyYear !== "all" || historyStatus !== "all" || filterBranchId || filterDepartmentId || filterProcessId);

  const DimFilterBar = () => (
    <div className="grid gap-3 sm:grid-cols-3">
      <Select value={filterBranchId || "__all"} onValueChange={(v) => setFilterBranchId(v === "__all" ? "" : v)}>
        <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
          <SelectValue placeholder="All Branches" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All Branches</SelectItem>
          {branchOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filterDepartmentId || "__all"} onValueChange={(v) => setFilterDepartmentId(v === "__all" ? "" : v)}>
        <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
          <SelectValue placeholder="All Departments" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All Departments</SelectItem>
          {departmentOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.dept_name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filterProcessId || "__all"} onValueChange={(v) => setFilterProcessId(v === "__all" ? "" : v)}>
        <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
          <SelectValue placeholder="All Processes" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All Processes</SelectItem>
          {processOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
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

  if (!isAdminOrHR) {
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
        {/* Header */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
            <div className="relative p-5 sm:p-6">
              <div className="absolute inset-y-0 left-0 w-1 bg-slate-950" />

              <div className="pl-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  Payroll Management
                </p>

                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Payroll
                </h1>

                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                  Generate, process, pay and review monthly payroll records.
                </p>
              </div>
            </div>

            <div className="flex flex-col justify-center gap-3 border-t border-slate-200 bg-slate-50 p-5 sm:flex-row sm:items-center lg:border-l lg:border-t-0">
              <DateRangeExportDialog
                title="Export Payroll Records"
                description="Export payroll records with optional month/year date range."
                onExportCSV={exportToCSV}
                onExportPDF={exportToPDF}
              />

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
                {generatePayroll.isPending ? "Generating..." : "Generate Payroll"}
              </Button>
            </div>
          </div>
        </section>

        {/* Metrics */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {payrollStats.map((stat) => (
            <PayrollMetricCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              description={stat.description}
              icon={stat.icon}
              tone={stat.tone}
            />
          ))}
        </section>

        {/* Status Strip */}
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer">
            <div>
              <p className="text-xs font-semibold text-slate-500">Pending</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {currentPending}
              </p>
            </div>

            <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50">
              Draft
            </Badge>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer">
            <div>
              <p className="text-xs font-semibold text-slate-500">Processed</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {currentProcessing}
              </p>
            </div>

            <Badge className="bg-sky-50 text-sky-700 hover:bg-sky-50">
              Processing
            </Badge>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer">
            <div>
              <p className="text-xs font-semibold text-slate-500">Paid</p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {currentPaid}
              </p>
            </div>

            <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
              Completed
            </Badge>
          </div>
        </section>

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

              <TabsList className="grid w-full grid-cols-4 lg:w-[680px]">
                <TabsTrigger value="current">Current Payroll</TabsTrigger>
                <TabsTrigger value="history">Payroll History</TabsTrigger>
                <TabsTrigger value="salary">Salary Structure</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="current" className="mt-0 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <DimFilterBar />
                <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search employee name or code..."
                      className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm shadow-sm"
                      value={currentSearch}
                      onChange={(e) => setCurrentSearch(e.target.value)}
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
                        setCurrentSearch("");
                        setMonthFilter("current");
                        setFilterBranchId("");
                        setFilterDepartmentId("");
                        setFilterProcessId("");
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
              ) : records.length === 0 ? (
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
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <PayrollTable
                      records={records}
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
                  {renderPagination(currentPage, currentTotal, setCurrentPage)}
                </>
              )}
            </TabsContent>

            <TabsContent value="history" className="mt-0 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-3">
                <DimFilterBar />
                <div className="grid gap-3 xl:grid-cols-[1fr_160px_160px_160px_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      placeholder="Search payroll history..."
                      className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm shadow-sm"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                    />
                  </div>

                  <Select value={historyMonth} onValueChange={setHistoryMonth}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
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
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm shadow-sm">
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
                        setHistorySearch("");
                        setHistoryMonth("all");
                        setHistoryYear("all");
                        setHistoryStatus("all");
                        setFilterBranchId("");
                        setFilterDepartmentId("");
                        setFilterProcessId("");
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
              ) : allRecords.length === 0 ? (
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
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <PayrollTable
                      records={allRecords}
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
                  {renderPagination(historyPage, historyTotal, setHistoryPage)}
                </>
              )}
            </TabsContent>

            <TabsContent value="salary" className="mt-0">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <SalaryStructureManager />
              </div>
            </TabsContent>

            <TabsContent value="analytics" className="mt-0">
              <PayrollAnalytics
                availableMonths={runsList
                  .map((r: any) => r.run_month)
                  .filter(Boolean) as string[]}
              />
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
