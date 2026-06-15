import { useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  CheckCircle2,
  Download,
  Search,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, isWithinInterval, parse } from "date-fns";
import { toast } from "sonner";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { EmployeeTable, type Employee } from "@/components/employees/EmployeeTable";
import { EmployeeDocuments } from "@/components/documents/EmployeeDocuments";
import { EmployeeViewDialog } from "@/components/employees/EmployeeViewDialog";
import { EmployeeEditDialog } from "@/components/employees/EmployeeEditDialog";
import { AdminPasswordResetDialog } from "@/components/admin/AdminPasswordResetDialog";
import { BulkDeleteDialog } from "@/components/employees/BulkDeleteDialog";
import { BulkAssignManagerDialog } from "@/components/employees/BulkAssignManagerDialog";
import { DateRangeExportDialog } from "@/components/export/DateRangeExportDialog";

import {
  useBulkDeleteEmployees,
  useBulkUpdateEmployeeStatus,
  useDepartments,
  useEmployeeDirectory,
  useEmployeeDirectoryMasters,
  useEmployeeStats,
} from "@/hooks/useEmployees";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useSorting } from "@/hooks/useSorting";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
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

interface EmployeeMetricCardProps {
  title: string;
  value: string | number;
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
    card: "border-[#c4dcf5] bg-gradient-to-br from-white via-white to-[#e8f2fc]",
    icon: "bg-[#e8f2fc] text-[#1B6AB5] ring-[#c4dcf5]",
  },
  amber: {
    card: "border-amber-100 bg-gradient-to-br from-white via-white to-amber-50",
    icon: "bg-amber-50 text-amber-700 ring-amber-100",
  },
};

const EmployeeMetricCard = ({
  title,
  value,
  description,
  icon,
  tone,
}: EmployeeMetricCardProps) => {
  const style = metricToneMap[tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer ${style.card}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {title}
          </p>

          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            {value}
          </h3>
        </div>

        <div className={`rounded-xl p-2.5 ring-1 ${style.icon}`}>
          {icon}
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
};

const Employees = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [processFilter, setProcessFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [documentsEmployee, setDocumentsEmployee] = useState<Employee | null>(null);
  const [viewEmployee, setViewEmployee] = useState<Employee | null>(null);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [resetPasswordEmployee, setResetPasswordEmployee] = useState<Employee | null>(null);

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [employeesToDelete, setEmployeesToDelete] = useState<Employee[]>([]);
  const [bulkAssignManagerOpen, setBulkAssignManagerOpen] = useState(false);
  const [employeesToAssignManager, setEmployeesToAssignManager] = useState<Employee[]>([]);

  const deferredSearch = useDeferredValue(searchQuery.trim());
  const recordStatus = statusFilter === "active" || statusFilter === "onboarding"
    ? "active"
    : statusFilter === "all"
      ? "all"
      : "inactive";
  const employmentStatus = statusFilter === "onboarding"
    ? "Onboarding"
    : statusFilter === "inactive"
      ? "Inactive"
      : statusFilter === "offboarded"
        ? "Terminated"
        : undefined;
  const { data: directoryData, isLoading: isLoadingEmployees } = useEmployeeDirectory({
    page: currentPage,
    limit: pageSize,
    recordStatus,
    status: employmentStatus,
    search: deferredSearch || undefined,
    departmentId: departmentFilter === "all" ? undefined : departmentFilter,
    processId: processFilter === "all" ? undefined : processFilter,
    branchId: branchFilter === "all" ? undefined : branchFilter,
  });
  const employees = directoryData?.employees ?? [];
  const directoryTotal = directoryData?.total ?? 0;
  const { data: departments = [] } = useDepartments();
  const { data: directoryMasters } = useEmployeeDirectoryMasters();
  const { data: employeeStats } = useEmployeeStats();
  const { isAdminOrHR, isLoading: isLoadingRole, roleKeys } = useIsAdminOrHR();
  const canResetEmployeePassword =
    roleKeys.includes("super_admin") || roleKeys.includes("admin") || roleKeys.includes("wfm");

  const bulkDeleteMutation = useBulkDeleteEmployees();
  const bulkStatusMutation = useBulkUpdateEmployeeStatus();

  const filteredEmployees = employees;
  const processes = directoryMasters?.processes ?? [];
  const branches = directoryMasters?.branches ?? [];

  const {
    sortedItems: sortedEmployees,
    sortConfig,
    requestSort,
  } = useSorting<Employee>(filteredEmployees);

  const totalPages = Math.max(1, Math.ceil(directoryTotal / pageSize));
  const totalItems = directoryTotal;
  const paginatedEmployees = sortedEmployees;
  const canGoNext = currentPage < totalPages;
  const canGoPrevious = currentPage > 1;

  const isLoading = isLoadingEmployees || isLoadingRole;

  const activeEmployees = employeeStats?.active ?? 0;

  useEffect(() => {
    setCurrentPage(1);
    setSelectedEmployeeIds([]);
  }, [deferredSearch, departmentFilter, processFilter, branchFilter, statusFilter, pageSize]);

  const filterByDateRange = (
    items: Employee[],
    startDate?: Date,
    endDate?: Date
  ) => {
    if (!startDate && !endDate) return items;

    return items.filter((emp) => {
      const joinDate = parse(emp.joinDate, "MMM d, yyyy", new Date());

      if (isNaN(joinDate.getTime())) return true;

      if (startDate && endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        return isWithinInterval(joinDate, { start: startDate, end: endOfDay });
      }

      if (startDate) {
        return joinDate >= startDate;
      }

      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        return joinDate <= endOfDay;
      }

      return true;
    });
  };

  const exportToCSV = (startDate?: Date, endDate?: Date) => {
    const dataToExport = filterByDateRange(sortedEmployees, startDate, endDate);

    const headers = [
      "Employee No.",
      "Name",
      "Email",
      "Department",
      "Designation",
      "Status",
      "Join Date",
    ];

    const csvContent = [
      headers.join(","),
      ...dataToExport.map((emp) =>
        [
          `"${emp.employeeCode}"`,
          `"${emp.name}"`,
          `"${emp.email}"`,
          `"${emp.department}"`,
          `"${emp.designation}"`,
          `"${emp.status}"`,
          `"${emp.joinDate}"`,
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

    link.download = `employee-directory${dateRange}-${
      new Date().toISOString().split("T")[0]
    }.csv`;

    link.click();

    toast.success(`${dataToExport.length} employees exported to CSV`);
  };

  const exportToPDF = (startDate?: Date, endDate?: Date) => {
    const dataToExport = filterByDateRange(sortedEmployees, startDate, endDate);

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text("Employee Directory", 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, 30);

    if (startDate || endDate) {
      doc.text(
        `Date Range: ${startDate ? format(startDate, "PP") : "Start"} - ${
          endDate ? format(endDate, "PP") : "End"
        }`,
        14,
        36
      );
      doc.text(`Total Employees: ${dataToExport.length}`, 14, 42);
    } else {
      doc.text(`Total Employees: ${dataToExport.length}`, 14, 36);
    }

    autoTable(doc, {
      startY: startDate || endDate ? 50 : 44,
      head: [
        [
          "Emp. No.",
          "Name",
          "Email",
          "Department",
          "Designation",
          "Status",
          "Join Date",
        ],
      ],
      body: dataToExport.map((emp) => [
        emp.employeeCode,
        emp.name,
        emp.email,
        emp.department,
        emp.designation,
        emp.status,
        emp.joinDate,
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
      `employee-directory${dateRange}-${new Date().toISOString().split("T")[0]}.pdf`
    );

    toast.success(`${dataToExport.length} employees exported to PDF`);
  };

  const handleBulkAction = (action: string, ids: string[]) => {
    const selectedEmployees = employees.filter((employee) => ids.includes(employee.id));

    switch (action) {
      case "export": {
        const headers = [
          "Employee No.",
          "Name",
          "Email",
          "Department",
          "Designation",
          "Status",
          "Join Date",
        ];

        const csvContent = [
          headers.join(","),
          ...selectedEmployees.map((emp) =>
            [
              `"${emp.employeeCode}"`,
              `"${emp.name}"`,
              `"${emp.email}"`,
              `"${emp.department}"`,
              `"${emp.designation}"`,
              `"${emp.status}"`,
              `"${emp.joinDate}"`,
            ].join(",")
          ),
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");

        link.href = URL.createObjectURL(blob);
        link.download = `selected-employees-${
          new Date().toISOString().split("T")[0]
        }.csv`;
        link.click();

        toast.success(`${selectedEmployees.length} employees exported`);
        setSelectedEmployeeIds([]);
        break;
      }

      case "email": {
        const emails = selectedEmployees.map((employee) => employee.email).join(", ");
        navigator.clipboard.writeText(emails);
        toast.success(`${selectedEmployees.length} email addresses copied to clipboard`);
        break;
      }

      case "activate":
        bulkStatusMutation.mutate(
          { employeeIds: ids, status: "active" },
          {
            onSuccess: ({ updatedCount }) => {
              toast.success(
                `${updatedCount} employee${updatedCount > 1 ? "s" : ""} set to active`
              );
              setSelectedEmployeeIds([]);
            },
            onError: (error) => {
              toast.error(error.message);
            },
          }
        );
        break;

      case "deactivate":
        bulkStatusMutation.mutate(
          { employeeIds: ids, status: "inactive" },
          {
            onSuccess: ({ updatedCount }) => {
              toast.success(
                `${updatedCount} employee${
                  updatedCount > 1 ? "s" : ""
                } set to inactive`
              );
              setSelectedEmployeeIds([]);
            },
            onError: (error) => {
              toast.error(error.message);
            },
          }
        );
        break;

      case "delete":
        setEmployeesToDelete(selectedEmployees);
        setBulkDeleteOpen(true);
        break;

      case "assign-manager":
        setEmployeesToAssignManager(selectedEmployees);
        setBulkAssignManagerOpen(true);
        break;

      default:
        break;
    }
  };

  const hasActiveFilters = searchQuery.trim() || departmentFilter !== "all" || processFilter !== "all" || branchFilter !== "all" || statusFilter !== "active";

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Hero Header */}
        <section className="relative overflow-hidden rounded-2xl bg-slate-950 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[#1B6AB5]/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-10 left-1/4 h-48 w-48 rounded-full bg-[#3BAD49]/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#5aa0dd]">
                People & Workforce
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
                Employee Directory
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                Manage employee profiles, departments, roles and employment records.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total</p>
                  <p className="text-lg font-black text-white">{employeeStats?.total ?? directoryTotal}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Active</p>
                  <p className="text-lg font-black text-[#3BAD49]">{activeEmployees}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Departments</p>
                  <p className="text-lg font-black text-[#5aa0dd]">{departments.length}</p>
                </div>
              </div>
            </div>
            {isAdminOrHR && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  asChild
                  className="rounded-xl bg-[#1B6AB5] px-5 font-bold text-white shadow-lg shadow-[#1B6AB5]/25 hover:bg-[#155e9f]"
                >
                  <Link to="/onboarding">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add Employee
                  </Link>
                </Button>
                <DateRangeExportDialog
                  onExportCSV={exportToCSV}
                  onExportPDF={exportToPDF}
                />
              </div>
            )}
          </div>
        </section>

        {/* Metrics */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {isLoading ? (
            <>
              {[1, 2, 3, 4].map((item) => (
                <Skeleton key={item} className="h-32 rounded-2xl" />
              ))}
            </>
          ) : (
            <>
              <EmployeeMetricCard
                title={isAdminOrHR ? "Employees" : "Team Members"}
                value={employeeStats?.total ?? directoryTotal}
                description={
                  isAdminOrHR
                    ? "Total employee records available."
                    : "Total visible team records."
                }
                icon={<Users className="h-5 w-5" />}
                tone="sky"
              />

              <EmployeeMetricCard
                title="Active"
                value={activeEmployees}
                description="Employees currently marked active."
                icon={<UserCheck className="h-5 w-5" />}
                tone="emerald"
              />

              <EmployeeMetricCard
                title="Departments"
                value={departments.length}
                description="Departments configured in HRMS."
                icon={<Building2 className="h-5 w-5" />}
                tone="indigo"
              />

              <EmployeeMetricCard
                title="Selected"
                value={selectedEmployeeIds.length}
                description={
                  selectedEmployeeIds.length > 0
                    ? "Selected for bulk action."
                    : "No employee selected."
                }
                icon={<CheckCircle2 className="h-5 w-5" />}
                tone="amber"
              />
            </>
          )}
        </section>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_200px_200px_180px_160px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

              <Input
                placeholder="Search by name, official email or employee number..."
                className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm shadow-sm"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm text-slate-900 shadow-sm [&>span]:text-slate-900">
                <SelectValue placeholder="Department" />
              </SelectTrigger>

              <SelectContent className="bg-white text-slate-900">
                <SelectItem value="all" className="text-slate-900">All Departments</SelectItem>

                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id} className="text-slate-900">
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={processFilter} onValueChange={setProcessFilter}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm text-slate-900 shadow-sm [&>span]:text-slate-900">
                <SelectValue placeholder="Process" />
              </SelectTrigger>
              <SelectContent className="bg-white text-slate-900">
                <SelectItem value="all" className="text-slate-900">All Processes</SelectItem>
                {processes.map((process) => (
                  <SelectItem key={process.id} value={process.id} className="text-slate-900">
                    {process.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm text-slate-900 shadow-sm [&>span]:text-slate-900">
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent className="bg-white text-slate-900">
                <SelectItem value="all" className="text-slate-900">All Branches</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id} className="text-slate-900">
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white text-sm text-slate-900 shadow-sm [&>span]:text-slate-900">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-white text-slate-900">
                <SelectItem value="all" className="text-slate-900">Active & Inactive</SelectItem>
                <SelectItem value="active" className="text-slate-900">Active</SelectItem>
                <SelectItem value="inactive" className="text-slate-900">Inactive</SelectItem>
                <SelectItem value="onboarding" className="text-slate-900">Onboarding</SelectItem>
                <SelectItem value="offboarded" className="text-slate-900">Offboarded</SelectItem>
              </SelectContent>
            </Select>
          </div>

        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1 font-medium">
            {directoryTotal} matching employee
            {directoryTotal === 1 ? "" : "s"}
          </span>

          {departmentFilter !== "all" && (
            <span className="rounded-full bg-sky-50 px-3 py-1 font-medium text-sky-700">
              Department: {departments.find((department) => department.id === departmentFilter)?.name ?? departmentFilter}
            </span>
          )}
          {processFilter !== "all" && <span className="rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-700">Process: {processes.find((process) => process.id === processFilter)?.name ?? processFilter}</span>}
          {branchFilter !== "all" && <span className="rounded-full bg-violet-50 px-3 py-1 font-medium text-violet-700">Branch: {branches.find((branch) => branch.id === branchFilter)?.name ?? branchFilter}</span>}
          {statusFilter !== "active" && <span className="rounded-full bg-amber-50 px-3 py-1 font-medium capitalize text-amber-700">Status: {statusFilter}</span>}

          {searchQuery.trim() && (
            <span className="rounded-full bg-[#e8f2fc] px-3 py-1 font-medium text-[#1B6AB5]">
              Search: {searchQuery}
            </span>
          )}

          {hasActiveFilters && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              onClick={() => {
                setSearchQuery("");
                setDepartmentFilter("all");
                setProcessFilter("all");
                setBranchFilter("all");
                setStatusFilter("active");
              }}
            >
              <X className="h-3 w-3" />
              Clear Filters
            </button>
          )}
        </div>

        {/* Table */}
        <section className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-950">
                Employee List
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                View, edit, sort and manage employee records.
              </p>
            </div>

            {selectedEmployeeIds.length > 0 && (
              <div className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-100">
                {selectedEmployeeIds.length} selected
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((item) => (
                <Skeleton key={item} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : filteredEmployees.length === 0 ? (
            <Card className="border-dashed border-slate-200 bg-slate-50/70 shadow-none">
              <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                  <Users className="h-7 w-7" />
                </div>

                <h3 className="text-base font-semibold text-slate-950">
                  No Employees Found
                </h3>

                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  {employees.length === 0
                    ? isAdminOrHR
                      ? "Start by adding your first employee."
                      : "No team members are available to display."
                    : "No employees match your current search or filter criteria."}
                </p>

                {employees.length === 0 && isAdminOrHR && (
                  <Button
                    asChild
                    className="mt-5 bg-slate-950 text-white hover:bg-slate-800 rounded-2xl px-5 py-2.5 font-semibold cursor-pointer transition-colors"
                  >
                    <Link to="/onboarding">
                      <UserPlus className="mr-2 h-4 w-4" />
                      Add Employee
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <EmployeeTable
                  employees={paginatedEmployees}
                  onView={(employee) => setViewEmployee(employee)}
                  onEdit={isAdminOrHR ? (employee) => setEditEmployee(employee) : undefined}
                  onManageDocuments={
                    isAdminOrHR ? (employee) => setDocumentsEmployee(employee) : undefined
                  }
                  onResetPassword={canResetEmployeePassword ? (employee) => setResetPasswordEmployee(employee) : undefined}
                  isAdminOrHR={isAdminOrHR}
                  canResetPassword={canResetEmployeePassword}
                  sortKey={sortConfig.key}
                  sortDirection={sortConfig.direction}
                  onSort={requestSort}
                  selectedIds={selectedEmployeeIds}
                  onSelectionChange={setSelectedEmployeeIds}
                  onBulkAction={handleBulkAction}
                />
              </div>

              {totalPages > 1 && (
                <div className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row">
                  <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 sm:justify-start">
                    <span>
                      Showing {(currentPage - 1) * pageSize + 1} to{" "}
                      {Math.min(currentPage * pageSize, totalItems)} of {totalItems}
                    </span>

                    <Select
                      value={pageSize.toString()}
                      onValueChange={(value) => setPageSize(Number(value))}
                    >
                      <SelectTrigger className="h-8 w-[74px] rounded-lg bg-white text-xs">
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                      </SelectContent>
                    </Select>

                    <span>per page</span>
                  </div>

                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => canGoPrevious && setCurrentPage((page) => page - 1)}
                          className={
                            !canGoPrevious
                              ? "pointer-events-none opacity-50"
                              : "cursor-pointer"
                          }
                        />
                      </PaginationItem>

                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number;

                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }

                        return (
                          <PaginationItem key={pageNum}>
                            <PaginationLink
                              onClick={() => setCurrentPage(pageNum)}
                              isActive={currentPage === pageNum}
                              className="cursor-pointer"
                            >
                              {pageNum}
                            </PaginationLink>
                          </PaginationItem>
                        );
                      })}

                      <PaginationItem>
                        <PaginationNext
                          onClick={() => canGoNext && setCurrentPage((page) => page + 1)}
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
              )}
            </div>
          )}
        </section>

        {/* View Profile Dialog */}
        <EmployeeViewDialog
          employee={viewEmployee}
          open={!!viewEmployee}
          onOpenChange={(open) => !open && setViewEmployee(null)}
        />

        {/* Edit Employee Dialog */}
        <EmployeeEditDialog
          employee={editEmployee}
          open={!!editEmployee}
          onOpenChange={(open) => !open && setEditEmployee(null)}
        />

        {/* Admin Password Reset Dialog */}
        <AdminPasswordResetDialog
          employee={resetPasswordEmployee}
          open={!!resetPasswordEmployee}
          onOpenChange={(open) => !open && setResetPasswordEmployee(null)}
        />

        {/* Documents Dialog */}
        <Dialog
          open={!!documentsEmployee}
          onOpenChange={(open) => !open && setDocumentsEmployee(null)}
        >
          <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto rounded-2xl">
            <DialogHeader>
              <DialogTitle>Documents - {documentsEmployee?.name}</DialogTitle>
            </DialogHeader>

            {documentsEmployee && (
              <EmployeeDocuments employeeId={documentsEmployee.id} />
            )}
          </DialogContent>
        </Dialog>

        {/* Bulk Delete Confirmation Dialog */}
        <BulkDeleteDialog
          open={bulkDeleteOpen}
          onOpenChange={(open) => {
            if (!bulkDeleteMutation.isPending) {
              setBulkDeleteOpen(open);
            }
          }}
          employees={employeesToDelete}
          isDeleting={bulkDeleteMutation.isPending}
          onConfirm={() => {
            const idsToDelete = employeesToDelete.map((employee) => employee.id);

            bulkDeleteMutation.mutate(idsToDelete, {
              onSuccess: ({ deletedCount }) => {
                toast.success(
                  `${deletedCount} employee${
                    deletedCount > 1 ? "s" : ""
                  } deleted successfully`
                );
                setSelectedEmployeeIds([]);
                setEmployeesToDelete([]);
                setBulkDeleteOpen(false);
              },
              onError: (error) => {
                toast.error(`Failed to delete employees: ${error.message}`);
              },
            });
          }}
        />

        {/* Bulk Assign Manager Dialog */}
        <BulkAssignManagerDialog
          open={bulkAssignManagerOpen}
          onOpenChange={setBulkAssignManagerOpen}
          employees={employeesToAssignManager}
          onSuccess={() => {
            setSelectedEmployeeIds([]);
            setEmployeesToAssignManager([]);
          }}
        />
      </div>
    </DashboardLayout>
  );
};

export default Employees;
