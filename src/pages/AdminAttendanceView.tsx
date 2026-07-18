import { useState, useCallback, useMemo } from "react";
import { Shield } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { AttendanceHubFilters } from "@/components/attendance/AttendanceHubFilters";
import { AttendanceHubTable } from "@/components/attendance/AttendanceHubTable";
import { AttendanceHubDrawer } from "@/components/attendance/AttendanceHubDrawer";
import { useHubEmployees, useDebounce, useTodaySummary } from "@/hooks/useAttendanceHub";
import type { HubEmployee, HubFilters } from "@/hooks/useAttendanceHub";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const ALLOWED_ROLES = ["super_admin", "admin", "hr", "payroll_head", "payroll_admin"] as const;

const DEFAULT_FILTERS: HubFilters = {
  search: "",
  branchId: "",
  processId: "",
  designationId: "",
  status: "",
  anomalyOnly: false,
  page: 1,
  limit: 50,
};

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function AdminAttendanceView() {
  const navigate = useNavigate();
  const { hasAnyRole } = useWorkforceAccess();
  const canAccess = hasAnyRole(...ALLOWED_ROLES);

  const [filters, setFilters] = useState<HubFilters>(DEFAULT_FILTERS);
  const [month, setMonth] = useState(currentMonthStr);
  const [selectedEmployee, setSelectedEmployee] = useState<HubEmployee | null>(null);

  // Debounce search so API isn't called on every keystroke
  const debouncedSearch = useDebounce(filters.search, 400);
  const debouncedFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch]
  );

  const { data: result, isLoading } = useHubEmployees(debouncedFilters, month);
  const { data: todaySummary } = useTodaySummary();
  const employees = result?.data ?? [];
  const total = result?.total ?? 0;

  const handleFiltersChange = useCallback((partial: Partial<HubFilters>) => {
    setFilters(prev => ({ ...prev, ...partial }));
  }, []);

  const handleMonthChange = useCallback((m: string) => {
    setMonth(m);
    setFilters(prev => ({ ...prev, page: 1 }));
  }, []);

  const handlePageChange = useCallback((p: number) => {
    setFilters(prev => ({ ...prev, page: p }));
  }, []);

  const handleCloseDrawer = useCallback(() => setSelectedEmployee(null), []);

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <div className="rounded-full bg-rose-50 p-4">
            <Shield className="h-8 w-8 text-rose-500" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Access Restricted</h2>
          <p className="text-sm text-slate-500 max-w-sm">
            You need Super Admin, HR, Payroll Head, or Payroll Admin role to access People Attendance & Earnings.
          </p>
          <Button variant="outline" onClick={() => navigate(-1)}>Go Back</Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-5 pb-12">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight text-slate-950">
              People Attendance & Earnings
            </h1>
            <p className="text-sm text-slate-500">
              Full attendance and salary intelligence. Click any row to view details.
            </p>
          </div>
          {/* Live today strip */}
          {todaySummary && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Today
              </span>
              {[
                { label: "Present", value: todaySummary.present, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                { label: "Half Day", value: todaySummary.half_day, cls: "bg-amber-50 text-amber-700 border-amber-200" },
                { label: "Absent", value: todaySummary.absent, cls: "bg-rose-50 text-rose-700 border-rose-200" },
                { label: "Missing Punch", value: todaySummary.missing_punch, cls: "bg-orange-50 text-orange-700 border-orange-200" },
                { label: "On Leave", value: todaySummary.on_leave, cls: "bg-purple-50 text-purple-700 border-purple-200" },
              ].map(s => (
                <span key={s.label} className={`text-[10px] font-semibold border rounded-lg px-2 py-1 ${s.cls}`}>
                  {s.label}: {s.value ?? 0}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        <AttendanceHubFilters
          filters={filters}
          onChange={handleFiltersChange}
          month={month}
          onMonthChange={handleMonthChange}
        />

        {/* Directory table */}
        <AttendanceHubTable
          employees={employees}
          total={total}
          page={filters.page}
          limit={filters.limit}
          isLoading={isLoading}
          month={month}
          onPageChange={handlePageChange}
          onSelect={setSelectedEmployee}
          selectedId={selectedEmployee?.id ?? null}
        />

        {/* Detail drawer */}
        <AttendanceHubDrawer
          employee={selectedEmployee}
          onClose={handleCloseDrawer}
        />
      </div>
    </DashboardLayout>
  );
}
