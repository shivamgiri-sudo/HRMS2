import { useState, type ReactNode } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  ArrowUpDown,
  Calendar,
  CalendarDays,
  CheckCircle,
  Clock,
  FileCheck,
  Filter,
  Loader2,
  Plus,
  RotateCcw,
  Tag,
  XCircle,
} from "lucide-react";
import jsPDF from "jspdf";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import autoTable from "jspdf-autotable";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  format,
  parseISO,
  isWithinInterval,
  isAfter,
  isBefore,
} from "date-fns";
import { normalizeDate } from "@/lib/utils";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  LeaveRequestCard,
  type LeaveRequest,
} from "@/components/leaves/LeaveRequestCard";
import { LeaveRequestForm } from "@/components/profile/LeaveRequestForm";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { LeaveCalendarView } from "@/components/leaves/LeaveCalendarView";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { LeaveTrends } from "@/components/leaves/LeaveTrends";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { DateRangeExportDialog } from "@/components/export/DateRangeExportDialog";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

import { usePagination } from "@/hooks/usePagination";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useSorting } from "@/hooks/useSorting";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useToast } from "@/hooks/use-toast";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useAuth } from "@/contexts/AuthContext";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useLeaveRequests, useLeaveStats } from "@/hooks/useLeaves";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { hrmsApi } from "@/lib/hrmsApi";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

import { Badge } from "@/components/ui/badge";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Card, CardContent } from "@/components/ui/card";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Textarea } from "@/components/ui/textarea";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

interface LeaveMetricCardProps {
  label: string;
  value: number;
  description: string;
  icon: ReactNode;
  tone: "amber" | "emerald" | "slate" | "sky";
}

const metricToneMap = {
  amber: {
    card: "border-amber-100 bg-gradient-to-br from-white via-white to-amber-50",
    icon: "bg-amber-50 text-amber-700 ring-amber-100",
  },
  emerald: {
    card: "border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  },
  slate: {
    card: "border-slate-200 bg-white",
    icon: "bg-slate-100 text-slate-700 ring-slate-200",
  },
  sky: {
    card: "border-[#c4dcf5] bg-gradient-to-br from-white via-white to-[#e8f2fc]",
    icon: "bg-[#e8f2fc] text-[#1B6AB5] ring-[#c4dcf5]",
  },
};

const MONTHS = [
  { value: "0", label: "January" },
  { value: "1", label: "February" },
  { value: "2", label: "March" },
  { value: "3", label: "April" },
  { value: "4", label: "May" },
  { value: "5", label: "June" },
  { value: "6", label: "July" },
  { value: "7", label: "August" },
  { value: "8", label: "September" },
  { value: "9", label: "October" },
  { value: "10", label: "November" },
  { value: "11", label: "December" },
];

const LeaveMetricCard = ({
  label,
  value,
  description,
  icon,
  tone,
}: LeaveMetricCardProps) => {
  const style = metricToneMap[tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer ${style.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {label}
          </p>

          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
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
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) => {
  return (
    <Card className="border-dashed border-slate-200 bg-slate-50/70 shadow-none">
      <CardContent className="flex flex-col items-center justify-center py-14 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
          {icon}
        </div>

        <h3 className="text-base font-semibold text-slate-950">{title}</h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
          {description}
        </p>
      </CardContent>
    </Card>
  );
};

const Leaves = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isNewRequestOpen, setIsNewRequestOpen] = useState(false);

  const { isAdminOrHR, roles } = useIsAdminOrHR();

  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(
    null
  );
  const [reviewNotes, setReviewNotes] = useState("");
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(
    null
  );

  const [processedStatusFilter, setProcessedStatusFilter] = useState<
    "all" | "approved" | "rejected"
  >("all");
  const [processedTypeFilter, setProcessedTypeFilter] = useState("all");
  const [processedMonthFilter, setProcessedMonthFilter] = useState("all");
  const [processedYearFilter, setProcessedYearFilter] = useState("all");

  const canApproveLeaves = isAdminOrHR || roles.includes("manager");

  const { data: myEmployeeId, isLoading: isLoadingMyEmployee } = useQuery({
    queryKey: ["my-employee-id", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      try {
        const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/employees/me");
        return res.data?.id ?? null;
      } catch {
        return null;
      }
    },
    enabled: !!user?.id,
  });

  const { data: requests = [], isLoading } = useLeaveRequests();
  const { data: stats } = useLeaveStats();

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      requestId,
      status,
      reviewNotes,
    }: {
      requestId: string;
      status: "approved" | "rejected";
      reviewNotes: string;
    }) => {
      // Get reviewer info for notification
      let reviewerName = "HR Team";
      try {
        const meRes = await hrmsApi.get<{ success: boolean; data: any }>("/api/employees/me");
        const emp = meRes.data;
        if (emp?.first_name) reviewerName = `${emp.first_name} ${emp.last_name ?? ""}`.trim();
      } catch {
        // non-fatal
      }

      await hrmsApi.patch(`/api/leave/requests/${requestId}/review`, {
        status,
        remarks: reviewNotes.trim() || null,
      });

      // Notify employee (fire and forget)
      hrmsApi.post("/api/communication/dispatch/send", {
        template_name: "leave_status",
        recipient_employee_ids: [selectedRequest?.employeeId ?? selectedRequest?.employee_id].filter(Boolean) as string[],
        data: {
          status,
          reviewer_name: reviewerName,
          review_notes: reviewNotes.trim() || undefined,
        },
        channel: "email",
      }).catch((err) => {
        console.error("Failed to send leave status notification:", err);
      });

      return status;
    },
    onSuccess: (status) => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-stats"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });

      toast({
        title: status === "approved" ? "Leave Approved" : "Leave Rejected",
        description: `The leave request has been ${status}.`,
      });

      setSelectedRequest(null);
      setReviewNotes("");
      setActionType(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update leave request: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const handleApprove = (id: string) => {
    const request = requests.find((item) => item.id === id);

    if (request) {
      setSelectedRequest(request);
      setActionType("approve");
      setReviewNotes("");
    }
  };

  const handleReject = (id: string) => {
    const request = requests.find((item) => item.id === id);

    if (request) {
      setSelectedRequest(request);
      setActionType("reject");
      setReviewNotes("");
    }
  };

  const confirmAction = () => {
    if (!selectedRequest || !actionType) return;

    updateStatusMutation.mutate({
      requestId: selectedRequest.id,
      status: actionType === "approve" ? "approved" : "rejected",
      reviewNotes,
    });
  };

  const filterByDateRange = (
    items: LeaveRequest[],
    startDate?: Date,
    endDate?: Date
  ) => {
    if (!startDate && !endDate) return items;

    return items.filter((request) => {
      const leaveStartDate = parseISO(normalizeDate(request.startDate));

      if (startDate && endDate) {
        return isWithinInterval(leaveStartDate, {
          start: startDate,
          end: endDate,
        });
      }

      if (startDate) {
        return (
          isAfter(leaveStartDate, startDate) ||
          leaveStartDate.getTime() === startDate.getTime()
        );
      }

      if (endDate) {
        return (
          isBefore(leaveStartDate, endDate) ||
          leaveStartDate.getTime() === endDate.getTime()
        );
      }

      return true;
    });
  };

  const pendingRequests = requests.filter((request) => request.status.startsWith("pending"));
  const allProcessedRequests = requests.filter(
    (request) => request.status !== "pending"
  );

  const uniqueLeaveTypes = [
    ...new Set(allProcessedRequests.map((request) => request.type)),
  ];

  const uniqueYears = [
    ...new Set(
      allProcessedRequests
        .map((request) => parseISO(normalizeDate(request.startDate)).getFullYear())
        .filter((year) => Number.isFinite(year))
    ),
  ].sort((a, b) => b - a);

  const processedRequests = allProcessedRequests.filter((request) => {
    const statusMatch =
      processedStatusFilter === "all" || request.status === processedStatusFilter;

    const typeMatch =
      processedTypeFilter === "all" || request.type === processedTypeFilter;

    const leaveDate = parseISO(normalizeDate(request.startDate));

    const monthMatch =
      processedMonthFilter === "all" ||
      leaveDate.getMonth().toString() === processedMonthFilter;

    const yearMatch =
      processedYearFilter === "all" ||
      leaveDate.getFullYear().toString() === processedYearFilter;

    return statusMatch && typeMatch && monthMatch && yearMatch;
  });

  const pendingSorting = useSorting<LeaveRequest>(pendingRequests);
  const processedSorting = useSorting<LeaveRequest>(processedRequests);

  const pendingPagination = usePagination(pendingSorting.sortedItems, {
    initialPageSize: 10,
  });

  const processedPagination = usePagination(processedSorting.sortedItems, {
    initialPageSize: 10,
  });

  const exportToCSV = (startDate?: Date, endDate?: Date) => {
    const allRequests = [...pendingRequests, ...allProcessedRequests];
    const filteredRequests = filterByDateRange(allRequests, startDate, endDate);

    const headers = [
      "Employee",
      "Department",
      "Type",
      "Start Date",
      "End Date",
      "Days",
      "Status",
      "Reason",
    ];

    const csvContent = [
      headers.join(","),
      ...filteredRequests.map((request) =>
        [
          `"${request.employee.name}"`,
          `"${request.employee.department}"`,
          `"${request.type}"`,
          `"${request.startDate}"`,
          `"${request.endDate}"`,
          `"${request.days}"`,
          `"${request.status}"`,
          `"${request.reason || ""}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");

    link.href = URL.createObjectURL(blob);

    const dateRange =
      startDate || endDate
        ? `-${startDate ? format(startDate, "yyyy-MM-dd") : "start"}-to-${
            endDate ? format(endDate, "yyyy-MM-dd") : "end"
          }`
        : "";

    link.download = `leave-requests${dateRange}-${
      new Date().toISOString().split("T")[0]
    }.csv`;

    link.click();
    URL.revokeObjectURL(link.href);

    toast({
      title: "Export Complete",
      description: `${filteredRequests.length} leave requests exported to CSV`,
    });
  };

  const exportToPDF = (startDate?: Date, endDate?: Date) => {
    const allRequests = [...pendingRequests, ...allProcessedRequests];
    const filteredRequests = filterByDateRange(allRequests, startDate, endDate);

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text("Leave Requests Report", 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated on ${formatISTDate()}`, 14, 30);

    if (startDate || endDate) {
      doc.text(
        `Date Range: ${startDate ? format(startDate, "PP") : "Start"} - ${
          endDate ? format(endDate, "PP") : "End"
        }`,
        14,
        36
      );
      doc.text(`Total Requests: ${filteredRequests.length}`, 14, 42);
    } else {
      doc.text(
        `Total Requests: ${filteredRequests.length} | Pending: ${pendingRequests.length} | Processed: ${allProcessedRequests.length}`,
        14,
        36
      );
    }

    autoTable(doc, {
      startY: startDate || endDate ? 50 : 44,
      head: [
        [
          "Employee",
          "Department",
          "Type",
          "Start Date",
          "End Date",
          "Days",
          "Status",
        ],
      ],
      body: filteredRequests.map((request) => [
        request.employee.name,
        request.employee.department,
        request.type,
        request.startDate,
        request.endDate,
        request.days.toString(),
        request.status,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
    });

    const dateRange =
      startDate || endDate
        ? `-${startDate ? format(startDate, "yyyy-MM-dd") : "start"}-to-${
            endDate ? format(endDate, "yyyy-MM-dd") : "end"
          }`
        : "";

    doc.save(
      `leave-requests${dateRange}-${new Date().toISOString().split("T")[0]}.pdf`
    );

    toast({
      title: "Export Complete",
      description: `${filteredRequests.length} leave requests exported to PDF`,
    });
  };

  const leaveStats = [
    {
      label: "Pending",
      value: stats?.pending || 0,
      description: "Requests waiting for review.",
      icon: <Clock className="h-5 w-5" />,
      tone: "amber" as const,
    },
    {
      label: "Approved",
      value: stats?.approved || 0,
      description: "Requests approved successfully.",
      icon: <CheckCircle className="h-5 w-5" />,
      tone: "emerald" as const,
    },
    {
      label: "Rejected",
      value: stats?.rejected || 0,
      description: "Requests rejected after review.",
      icon: <XCircle className="h-5 w-5" />,
      tone: "slate" as const,
    },
    {
      label: "Total",
      value:
        (stats?.pending || 0) + (stats?.approved || 0) + (stats?.rejected || 0),
      description: "Total leave requests tracked.",
      icon: <FileCheck className="h-5 w-5" />,
      tone: "sky" as const,
    },
  ];

  const sortOptions = [
    { key: "startDate", label: "Date", icon: Calendar },
    { key: "days", label: "Duration", icon: Clock },
    { key: "type", label: "Type", icon: Tag },
  ] as const;

  const renderSortDropdown = (
    sorting: ReturnType<typeof useSorting<LeaveRequest>>
  ) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2 rounded-xl border-slate-200 bg-white text-xs shadow-sm"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          Sort by{" "}
          {sorting.sortConfig.key
            ? sortOptions.find((option) => option.key === sorting.sortConfig.key)
                ?.label
            : "..."}
          {sorting.sortConfig.direction &&
            (sorting.sortConfig.direction === "asc" ? " ↑" : " ↓")}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        {sortOptions.map((option) => {
          const Icon = option.icon;

          return (
            <DropdownMenuItem
              key={option.key}
              onClick={() =>
                sorting.requestSort(option.key as keyof LeaveRequest)
              }
              className={sorting.sortConfig.key === option.key ? "bg-accent" : ""}
            >
              <Icon className="mr-2 h-4 w-4" />
              {option.label}

              {sorting.sortConfig.key === option.key && (
                <span className="ml-2">
                  {sorting.sortConfig.direction === "asc" ? "↑" : "↓"}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderPaginationControls = (
    pagination: ReturnType<typeof usePagination<LeaveRequest>>
  ) => {
    if (pagination.totalPages <= 1) return null;

    const getPageNumbers = () => {
      const pages: (number | "ellipsis")[] = [];
      const { currentPage, totalPages } = pagination;

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

      return pages;
    };

    return (
      <div className="mt-4 flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 sm:justify-start">
          <span>Show</span>

          <Select
            value={pagination.pageSize.toString()}
            onValueChange={(value) => pagination.setPageSize(Number(value))}
          >
            <SelectTrigger className="h-8 w-[74px] rounded-lg bg-white text-xs">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {[5, 10, 20, 50].map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span>of {pagination.totalItems} requests</span>
        </div>

        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() =>
                  pagination.canGoPrevious && pagination.goToPreviousPage()
                }
                className={
                  !pagination.canGoPrevious
                    ? "pointer-events-none opacity-50"
                    : "cursor-pointer"
                }
              />
            </PaginationItem>

            {getPageNumbers().map((page, index) =>
              page === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={page}>
                  <PaginationLink
                    onClick={() => pagination.setPage(page)}
                    isActive={pagination.currentPage === page}
                    className="cursor-pointer"
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              )
            )}

            <PaginationItem>
              <PaginationNext
                onClick={() => pagination.canGoNext && pagination.goToNextPage()}
                className={
                  !pagination.canGoNext
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

  const clearProcessedFilters = () => {
    setProcessedStatusFilter("all");
    setProcessedTypeFilter("all");
    setProcessedMonthFilter("all");
    setProcessedYearFilter("all");
  };

  const hasProcessedFilters =
    processedStatusFilter !== "all" ||
    processedTypeFilter !== "all" ||
    processedMonthFilter !== "all" ||
    processedYearFilter !== "all";

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Hero Header */}
        <section className="relative overflow-hidden rounded-2xl bg-slate-950 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#1B6AB5]/20 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-[#3BAD49]/10 blur-3xl" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#5aa0dd]">
                  Leave Management
                </p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
                  Leave Requests
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                  Apply for leave, track approvals and manage team leave requests.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pending</p>
                    <p className="text-lg font-black text-[#f59e0b]">{stats?.pending ?? 0}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Approved</p>
                    <p className="text-lg font-black text-[#3BAD49]">{stats?.approved ?? 0}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rejected</p>
                    <p className="text-lg font-black text-[#E8231A]">{stats?.rejected ?? 0}</p>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  onClick={() => setIsNewRequestOpen(true)}
                  className="rounded-xl bg-[#1B6AB5] px-5 font-bold text-white shadow-lg shadow-[#1B6AB5]/25 hover:bg-[#155e9f]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New Request
                </Button>
                <DateRangeExportDialog
                  title="Export Leave Requests"
                  description="Export leave requests with optional date range filter based on start date."
                  onExportCSV={exportToCSV}
                  onExportPDF={exportToPDF}
                />
              </div>
            </div>
          </div>
        </section>

        {/* New Request Dialog */}
        <Dialog open={isNewRequestOpen} onOpenChange={setIsNewRequestOpen}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-2xl">
            <DialogHeader>
              <DialogTitle>New Leave Request</DialogTitle>
              <DialogDescription>
                Submit a leave request for approval.
              </DialogDescription>
            </DialogHeader>

            {isLoadingMyEmployee ? (
              <Skeleton className="h-72 w-full rounded-2xl" />
            ) : !myEmployeeId ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">
                We could not find an employee profile linked to your account.
                Please contact HR to link your profile.
              </div>
            ) : (
              <LeaveRequestForm employeeId={myEmployeeId} />
            )}
          </DialogContent>
        </Dialog>

        {/* Metrics */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {leaveStats.map((stat) => (
            <LeaveMetricCard
              key={stat.label}
              label={stat.label}
              value={stat.value}
              description={stat.description}
              icon={stat.icon}
              tone={stat.tone}
            />
          ))}
        </section>

        {/* Leave Requests */}
        <section className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                Leave Requests
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Review pending requests, track processed leaves and open calendar
                visibility.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5 text-sky-700" />
              {requests.length} total request{requests.length === 1 ? "" : "s"}
            </div>
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4 lg:w-[680px]">
              <TabsTrigger value="overview">My Overview</TabsTrigger>
              <TabsTrigger value="pending">
                Pending
                <Badge variant="secondary" className="ml-2">
                  {pendingRequests.length}
                </Badge>
              </TabsTrigger>

              <TabsTrigger value="processed">Processed</TabsTrigger>

              <TabsTrigger value="calendar">Calendar View</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-5">
              <LeaveTrends employeeId={myEmployeeId ?? undefined} />
            </TabsContent>

            <TabsContent value="pending" className="mt-5 space-y-4">
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-32 w-full rounded-2xl" />
                  ))}
                </div>
              ) : pendingRequests.length === 0 ? (
                <EmptyState
                  title="No Pending Requests"
                  description="All leave requests have been processed."
                  icon={<Calendar className="h-7 w-7" />}
                />
              ) : (
                <>
                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-950">
                        Pending Queue
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Requests waiting for approval or rejection.
                      </p>
                    </div>

                    {renderSortDropdown(pendingSorting)}
                  </div>

                  <div className="space-y-4">
                    {pendingPagination.paginatedItems.map((request) => {
                      const isOwnRequest =
                        myEmployeeId && request.employeeId === myEmployeeId;

                      const canApproveThisRequest =
                        canApproveLeaves && !isOwnRequest && request.status === "pending";

                      return (
                        <LeaveRequestCard
                          key={request.id}
                          request={request}
                          onApprove={
                            canApproveThisRequest ? handleApprove : undefined
                          }
                          onReject={
                            canApproveThisRequest ? handleReject : undefined
                          }
                        />
                      );
                    })}
                  </div>

                  {renderPaginationControls(pendingPagination)}
                </>
              )}
            </TabsContent>

            <TabsContent value="processed" className="mt-5 space-y-4">
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-32 w-full rounded-2xl" />
                  ))}
                </div>
              ) : allProcessedRequests.length === 0 ? (
                <EmptyState
                  title="No Processed Requests"
                  description="Approved and rejected leave requests will appear here."
                  icon={<FileCheck className="h-7 w-7" />}
                />
              ) : (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-950">
                      <Filter className="h-3.5 w-3.5 text-sky-700" />
                      Processed Filters
                    </div>

                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <Select
                          value={processedMonthFilter}
                          onValueChange={setProcessedMonthFilter}
                        >
                          <SelectTrigger className="h-10 rounded-xl bg-white text-xs">
                            <SelectValue placeholder="Month" />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectItem value="all">All Months</SelectItem>
                            {MONTHS.map((month) => (
                              <SelectItem key={month.value} value={month.value}>
                                {month.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={processedYearFilter}
                          onValueChange={setProcessedYearFilter}
                        >
                          <SelectTrigger className="h-10 rounded-xl bg-white text-xs">
                            <SelectValue placeholder="Year" />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectItem value="all">All Years</SelectItem>
                            {uniqueYears.map((year) => (
                              <SelectItem key={year} value={year.toString()}>
                                {year}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          value={processedStatusFilter}
                          onValueChange={(value) =>
                            setProcessedStatusFilter(
                              value as "all" | "approved" | "rejected"
                            )
                          }
                        >
                          <SelectTrigger className="h-10 rounded-xl bg-white text-xs">
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectItem value="all">All Status</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>

                        <Select
                          value={processedTypeFilter}
                          onValueChange={setProcessedTypeFilter}
                        >
                          <SelectTrigger className="h-10 rounded-xl bg-white text-xs">
                            <SelectValue placeholder="Leave Type" />
                          </SelectTrigger>

                          <SelectContent>
                            <SelectItem value="all">All Types</SelectItem>
                            {uniqueLeaveTypes.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {hasProcessedFilters && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 rounded-xl text-xs"
                            onClick={clearProcessedFilters}
                          >
                            <RotateCcw className="mr-2 h-3.5 w-3.5" />
                            Clear Filters
                          </Button>
                        )}

                        {renderSortDropdown(processedSorting)}
                      </div>
                    </div>
                  </div>

                  {processedRequests.length === 0 ? (
                    <EmptyState
                      title="No Matching Requests"
                      description="Try adjusting your filters to see more processed leave requests."
                      icon={<Calendar className="h-7 w-7" />}
                    />
                  ) : (
                    <>
                      <div className="space-y-4">
                        {processedPagination.paginatedItems.map((request) => (
                          <LeaveRequestCard key={request.id} request={request} />
                        ))}
                      </div>

                      {renderPaginationControls(processedPagination)}
                    </>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="calendar" className="mt-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <LeaveCalendarView />
              </div>
            </TabsContent>
          </Tabs>
        </section>

        {/* Approval Confirmation Dialog */}
        <Dialog
          open={!!selectedRequest && !!actionType}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedRequest(null);
              setActionType(null);
              setReviewNotes("");
            }
          }}
        >
          <DialogContent className="rounded-2xl">
            <DialogHeader>
              <DialogTitle>
                {actionType === "approve" ? "Approve" : "Reject"} Leave Request
              </DialogTitle>

              <DialogDescription>
                {actionType === "approve"
                  ? "Are you sure you want to approve this leave request?"
                  : "Are you sure you want to reject this leave request?"}
              </DialogDescription>
            </DialogHeader>

            {selectedRequest && (
              <div className="space-y-4">
                <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-950">
                    {selectedRequest.employee.name}
                  </p>

                  <p className="text-sm text-slate-500">
                    {selectedRequest.type} • {selectedRequest.days} day(s)
                  </p>

                  <p className="text-sm text-slate-500">
                    {selectedRequest.startDate ? format(parseISO(normalizeDate(selectedRequest.startDate)), "PPP") : "—"} -{" "}
                    {selectedRequest.endDate ? format(parseISO(normalizeDate(selectedRequest.endDate)), "PPP") : "—"}
                  </p>

                  {selectedRequest.reason && (
                    <p className="mt-2 text-sm text-slate-500">
                      <span className="font-medium text-slate-700">Reason:</span>{" "}
                      {selectedRequest.reason}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Notes Optional</label>

                  <Textarea
                    value={reviewNotes}
                    onChange={(event) => setReviewNotes(event.target.value)}
                    placeholder="Add any notes for the employee."
                    rows={3}
                    className="rounded-xl"
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  setSelectedRequest(null);
                  setActionType(null);
                  setReviewNotes("");
                }}
              >
                Cancel
              </Button>

              <Button
                onClick={confirmAction}
                disabled={updateStatusMutation.isPending}
                className={
                  actionType === "approve"
                    ? "rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                    : "rounded-xl bg-amber-600 text-white hover:bg-amber-700"
                }
              >
                {updateStatusMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}

                {actionType === "approve" ? "Approve" : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default Leaves;
