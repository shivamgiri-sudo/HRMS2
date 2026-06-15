import { useState, useMemo } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  User,
  Calendar,
  Clock,
  CreditCard,
  Package,
  Download,
  Mail,
  Briefcase,
  Building2,
  Check,
  ChevronsUpDown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currency";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

interface EmployeeOption {
  id: string;
  name: string;
  employee_code: string;
  email: string;
  designation: string;
  avatar_url: string | null;
  department_name: string | null;
  hire_date: string;
  status: string;
}

export function EmployeeReport() {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [comboOpen, setComboOpen] = useState(false);

  const year = parseInt(selectedYear);

  // Fetch all employees for dropdown
  const { data: employees, isLoading: loadingEmployees } = useQuery({
    queryKey: ["employees-for-report"],
    queryFn: async () => {
      const empRes = await hrmsApi.get<{success:boolean;data:any}>("/api/employees?limit=200");
      return (empRes.data ?? []).map((e: any): EmployeeOption => ({
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
        employee_code: e.employee_code,
        email: e.email,
        designation: e.designation,
        avatar_url: e.avatar_url,
        department_name: e.department?.name ?? null,
        hire_date: e.hire_date,
        status: e.status,
      }));
    },
  });

  const selectedEmployee = useMemo(
    () => employees?.find((e) => e.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  // Leave balances + requests for the selected employee/year
  const { data: leaveData, isLoading: loadingLeave, error: leaveError } = useQuery({
    queryKey: ["employee-report-leaves", selectedEmployeeId, year],
    queryFn: async () => {
      try {
        const [balanceRes, requestsRes, typesRes, eligibilityRes] = await Promise.all([
          hrmsApi.get<{success:boolean;data:any}>(`/api/leave/balance/${selectedEmployeeId}?year=${year}`),
          hrmsApi.get<{success:boolean;data:any}>(`/api/leave/requests?employeeId=${selectedEmployeeId}&year=${year}&limit=200`),
          hrmsApi.get<{success:boolean;data:any}>("/api/leave/types"),
          hrmsApi.get<{success:boolean;data:any}>(`/api/leave/eligibility/${selectedEmployeeId}`),
        ]);
        console.log('[EmployeeReport] Leave API responses:', { balanceRes, requestsRes, typesRes, eligibilityRes });

      const eligibleTypeIds = new Set((eligibilityRes.data || []).map((row: any) => row.id));
      const types = (typesRes.data || []).filter((type: any) => eligibleTypeIds.has(type.id));
      const allRequests = (requestsRes.data || []).filter((request: any) =>
        eligibleTypeIds.has(request.leave_type_id) &&
        new Date(request.start_date) >= new Date(`${year}-01-01`) &&
        new Date(request.start_date) <= new Date(`${year}-12-31`)
      );

      // Dynamically calculate used days from approved requests for the year
      const usedByType = new Map<string, number>();
      allRequests
        .filter((r: any) => r.status === "approved")
        .forEach((r: any) => {
          usedByType.set(
            r.leave_type_id,
            (usedByType.get(r.leave_type_id) ?? 0) + Number(r.days_count ?? 0)
          );
        });

      const balances = (types).map((t: any) => {
        const b = balanceRes.data?.find((bal: any) => bal.leave_type_id === t.id);
        const total = b?.allocated_days ?? t.max_days_per_year;
        const used = usedByType.get(t.id) ?? 0;
        return {
          type_id: t.id,
          type_name: t.leave_name,
          total,
          used,
          remaining: total - used,
        };
      });

      const requests = (allRequests || []).map((r: any) => ({
        ...r,
        type_name: types.find((t: any) => t.id === r.leave_type_id)?.leave_name || "Leave",
      }));

        return { balances, requests };
      } catch (err) {
        console.error('[EmployeeReport] Leave data error:', err);
        throw err;
      }
    },
    enabled: !!selectedEmployeeId,
  });

  // Attendance summary for the year
  const { data: attendanceData, isLoading: loadingAttendance, error: attendanceError } = useQuery({
    queryKey: ["employee-report-attendance", selectedEmployeeId, year],
    queryFn: async () => {
      try {
        const attRes = await hrmsApi.get<{success:boolean;data:any}>(
          `/api/wfm/attendance/daily?employeeId=${selectedEmployeeId}&fromDate=${year}-01-01&toDate=${year}-12-31&limit=200`
        );
        console.log('[EmployeeReport] Attendance API response:', attRes);
        const records = attRes.data ?? [];
        const totalDays = records.length;
        const totalHours = records.reduce((sum: number, r: any) => sum + (r.total_hours || 0), 0);
        const presentDays = records.filter((r: any) => r.attendance_status === "present").length;
        const lateDays = records.filter((r: any) => r.attendance_status === "late").length;
        const wfoDays = records.filter((r: any) => r.work_mode === "wfo").length;
        const wfhDays = records.filter((r: any) => r.work_mode === "wfh").length;

        return { records, totalDays, totalHours, presentDays, lateDays, wfoDays, wfhDays };
      } catch (err) {
        console.error('[EmployeeReport] Attendance data error:', err);
        throw err;
      }
    },
    enabled: !!selectedEmployeeId,
  });

  // Payroll for the year
  const { data: payrollData, isLoading: loadingPayroll } = useQuery({
    queryKey: ["employee-report-payroll", selectedEmployeeId, year],
    queryFn: async () => {
      // Get salary assignment for the employee
      const salaryRes = await hrmsApi.get<{success:boolean;data:any}>(`/api/payroll/salary-assignments/${selectedEmployeeId}`);
      const salary = salaryRes.data;

      // Generate monthly records for the year (placeholder until we have actual payslip history)
      const records = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        year,
        basic_salary: salary?.basic_amount || 0,
        total_allowances: salary?.allowances?.reduce((sum: number, a: any) => sum + (a.amount || 0), 0) || 0,
        total_deductions: salary?.deductions?.reduce((sum: number, d: any) => sum + (d.amount || 0), 0) || 0,
        net_salary: (salary?.basic_amount || 0) +
                    (salary?.allowances?.reduce((sum: number, a: any) => sum + (a.amount || 0), 0) || 0) -
                    (salary?.deductions?.reduce((sum: number, d: any) => sum + (d.amount || 0), 0) || 0),
        status: "projected",
      }));

      const totalNet = records.reduce((sum: number, r: any) => sum + Number(r.net_salary || 0), 0);
      const totalPaid = 0; // Will be calculated from actual payslips when available

      return { records, totalNet, totalPaid };
    },
    enabled: !!selectedEmployeeId,
  });

  // Currently assigned assets
  const { data: assetData, isLoading: loadingAssets } = useQuery({
    queryKey: ["employee-report-assets", selectedEmployeeId],
    queryFn: async () => {
      const assetRes = await hrmsApi.get<{success:boolean;data:any}>(`/api/assets-mgmt/employee/${selectedEmployeeId}`);
      const all = assetRes.data ?? [];
      const active = all.filter((a) => !a.returned_date);
      const returned = all.filter((a) => !!a.returned_date);
      return { all, active, returned };
    },
    enabled: !!selectedEmployeeId,
  });

  const monthLabel = (m: number) =>
    format(new Date(year, m - 1, 1), "MMMM");

  const exportPdf = () => {
    if (!selectedEmployee) return;
    const doc = new jsPDF();
    let y = 14;
    doc.setFontSize(16);
    doc.text(`Employee Report — ${selectedEmployee.name}`, 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(
      `${selectedEmployee.employee_code} • ${selectedEmployee.designation} • Year: ${year}`,
      14,
      y
    );
    doc.setTextColor(0);
    y += 8;

    if (leaveData?.balances?.length) {
      doc.setFontSize(12);
      doc.text("Leave Balance", 14, y);
      autoTable(doc, {
        startY: y + 2,
        head: [["Type", "Total", "Used", "Remaining"]],
        body: leaveData.balances.map((b) => [
          b.type_name,
          b.total,
          b.used,
          b.remaining,
        ]),
        theme: "striped",
        headStyles: { fillColor: [37, 99, 235] },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    if (attendanceData) {
      doc.setFontSize(12);
      doc.text("Attendance Summary", 14, y);
      autoTable(doc, {
        startY: y + 2,
        head: [["Days Logged", "Total Hours", "Present", "Late", "WFO", "WFH"]],
        body: [
          [
            attendanceData.totalDays,
            attendanceData.totalHours.toFixed(1),
            attendanceData.presentDays,
            attendanceData.lateDays,
            attendanceData.wfoDays,
            attendanceData.wfhDays,
          ],
        ],
        theme: "striped",
        headStyles: { fillColor: [37, 99, 235] },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    if (payrollData?.records?.length) {
      doc.setFontSize(12);
      doc.text("Payroll", 14, y);
      autoTable(doc, {
        startY: y + 2,
        head: [["Month", "Basic", "Allowances", "Deductions", "Net", "Status"]],
        body: payrollData.records.map((r) => [
          monthLabel(r.month),
          formatCurrency(Number(r.basic_salary)),
          formatCurrency(Number(r.total_allowances || 0)),
          formatCurrency(Number(r.total_deductions || 0)),
          formatCurrency(Number(r.net_salary)),
          r.status,
        ]),
        theme: "striped",
        headStyles: { fillColor: [37, 99, 235] },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    if (assetData?.all?.length) {
      doc.setFontSize(12);
      doc.text("Assets", 14, y);
      autoTable(doc, {
        startY: y + 2,
        head: [["Asset", "Code", "Category", "Assigned", "Returned"]],
        body: assetData.all.map((a: any) => [
          a.asset?.name ?? "-",
          a.asset?.asset_code ?? "-",
          a.asset?.category ?? "-",
          a.assigned_date ? format(new Date(a.assigned_date), "dd MMM yyyy") : "-",
          a.returned_date ? format(new Date(a.returned_date), "dd MMM yyyy") : "Active",
        ]),
        theme: "striped",
        headStyles: { fillColor: [37, 99, 235] },
      });
    }

    doc.save(`${selectedEmployee.employee_code}-report-${year}.pdf`);
    toast.success("Report exported");
  };

  return (
    <div className="space-y-6">
      {/* Selector Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Employee Report
          </CardTitle>
          <CardDescription>
            Select an employee to view their consolidated leave, attendance, payroll, and asset history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label className="text-sm font-medium text-foreground">Employee</label>
              <Popover open={comboOpen} onOpenChange={setComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={comboOpen}
                    className="w-full justify-between"
                    disabled={loadingEmployees}
                  >
                    {selectedEmployee
                      ? `${selectedEmployee.name} (${selectedEmployee.employee_code})`
                      : loadingEmployees
                      ? "Loading employees..."
                      : "Select an employee..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search employee..." />
                    <CommandList>
                      <CommandEmpty>No employee found.</CommandEmpty>
                      <CommandGroup>
                        {employees?.map((emp) => (
                          <CommandItem
                            key={emp.id}
                            value={`${emp.name} ${emp.employee_code} ${emp.email}`}
                            onSelect={() => {
                              setSelectedEmployeeId(emp.id);
                              setComboOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedEmployeeId === emp.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>
                                {emp.name}{" "}
                                <span className="text-xs text-muted-foreground">({emp.employee_code})</span>
                              </span>
                              <span className="text-xs text-muted-foreground">{emp.designation}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Year</label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={exportPdf}
              disabled={!selectedEmployee}
              variant="outline"
            >
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {!selectedEmployeeId ? (
        <Card>
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center text-center">
            <User className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              Select an employee above to view their consolidated report.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Profile header */}
          {selectedEmployee && (
            <Card>
              <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={selectedEmployee.avatar_url || undefined} />
                  <AvatarFallback>
                    {selectedEmployee.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">
                      {selectedEmployee.name}
                    </h3>
                    <Badge variant="outline" className="font-mono text-xs">
                      {selectedEmployee.employee_code}
                    </Badge>
                    <Badge variant="secondary">{selectedEmployee.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Briefcase className="h-3.5 w-3.5" />
                      {selectedEmployee.designation}
                    </span>
                    {selectedEmployee.department_name && (
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5" />
                        {selectedEmployee.department_name}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      {selectedEmployee.email}
                    </span>
                    {selectedEmployee.hire_date && (
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Joined {format(new Date(selectedEmployee.hire_date), "MMM yyyy")}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Leave */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Leave — {year}
              </CardTitle>
              <CardDescription>Balance and request history</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {leaveError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  Error loading leave data: {leaveError instanceof Error ? leaveError.message : 'Unknown error'}
                </div>
              )}
              {loadingLeave ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  {leaveData?.balances && leaveData.balances.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                      {leaveData.balances.map((b) => (
                        <div key={b.type_id} className="rounded-lg border bg-muted/40 p-3">
                          <p className="text-xs text-muted-foreground">{b.type_name}</p>
                          <p className="mt-1 text-2xl font-bold text-foreground">
                            {b.remaining}
                            <span className="text-sm font-normal text-muted-foreground">
                              {" "}
                              / {b.total}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">{b.used} used</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead>To</TableHead>
                          <TableHead>Days</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leaveData?.requests && leaveData.requests.length > 0 ? (
                          leaveData.requests.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell>{r.type_name}</TableCell>
                              <TableCell>
                                {format(new Date(r.start_date), "dd MMM yyyy")}
                              </TableCell>
                              <TableCell>
                                {format(new Date(r.end_date), "dd MMM yyyy")}
                              </TableCell>
                              <TableCell>{r.days_count}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    r.status === "approved"
                                      ? "default"
                                      : r.status === "rejected"
                                      ? "destructive"
                                      : "secondary"
                                  }
                                >
                                  {r.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[260px] truncate text-muted-foreground">
                                {r.reason || "-"}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground">
                              No leave requests for {year}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Attendance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Attendance — {year}
              </CardTitle>
              <CardDescription>Summary and recent records</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {attendanceError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  Error loading attendance data: {attendanceError instanceof Error ? attendanceError.message : 'Unknown error'}
                </div>
              )}
              {loadingAttendance ? (
                <Skeleton className="h-32 w-full" />
              ) : attendanceData ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <SummaryStat label="Days Logged" value={attendanceData.totalDays} />
                    <SummaryStat
                      label="Total Hours"
                      value={attendanceData.totalHours.toFixed(1)}
                    />
                    <SummaryStat label="Present" value={attendanceData.presentDays} />
                    <SummaryStat label="Late" value={attendanceData.lateDays} />
                    <SummaryStat label="WFO" value={attendanceData.wfoDays} />
                    <SummaryStat label="WFH" value={attendanceData.wfhDays} />
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Clock In</TableHead>
                        <TableHead>Clock Out</TableHead>
                        <TableHead>Hours</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendanceData.records.length > 0 ? (
                        attendanceData.records.slice(0, 15).map((r: any) => (
                          <TableRow key={r.attendance_date || r.id}>
                            <TableCell>
                              {r.attendance_date ? format(new Date(r.attendance_date), "dd MMM yyyy") : "-"}
                            </TableCell>
                            <TableCell>
                              {r.first_login ? format(new Date(r.first_login), "HH:mm") : "-"}
                            </TableCell>
                            <TableCell>
                              {r.last_logout ? format(new Date(r.last_logout), "HH:mm") : "-"}
                            </TableCell>
                            <TableCell>
                              {r.total_hours ? `${Number(r.total_hours).toFixed(2)}h` : "-"}
                            </TableCell>
                            <TableCell className="uppercase">
                              {r.work_mode || "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{r.attendance_status || "-"}</Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            No attendance records for {year}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {attendanceData.records.length > 15 && (
                    <p className="text-xs text-muted-foreground">
                      Showing latest 15 of {attendanceData.records.length} records. Export PDF for full details.
                    </p>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* Payroll */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payroll — {year}
              </CardTitle>
              <CardDescription>Monthly breakdown</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingPayroll ? (
                <Skeleton className="h-32 w-full" />
              ) : payrollData ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SummaryStat
                      label="Total Net Salary"
                      value={formatCurrency(payrollData.totalNet)}
                    />
                    <SummaryStat
                      label="Total Paid"
                      value={formatCurrency(payrollData.totalPaid)}
                    />
                    <SummaryStat label="Months" value={payrollData.records.length} />
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Basic</TableHead>
                        <TableHead className="text-right">Allowances</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollData.records.length > 0 ? (
                        payrollData.records.map((r) => (
                          <TableRow key={`${r.year}-${r.month}`}>
                            <TableCell>{monthLabel(r.month)}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(Number(r.basic_salary))}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(Number(r.total_allowances || 0))}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(Number(r.total_deductions || 0))}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatCurrency(Number(r.net_salary))}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={r.status === "paid" ? "default" : "secondary"}
                              >
                                {r.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            No payroll records for {year}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* Assets */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Assets
              </CardTitle>
              <CardDescription>Currently assigned and historical assignments</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAssets ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Serial</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>Returned</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assetData?.all && assetData.all.length > 0 ? (
                      assetData.all.map((a: any) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.asset?.name ?? "-"}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {a.asset?.asset_code ?? "-"}
                          </TableCell>
                          <TableCell>{a.asset?.category ?? "-"}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {a.asset?.serial_number ?? "-"}
                          </TableCell>
                          <TableCell>
                            {a.assigned_date
                              ? format(new Date(a.assigned_date), "dd MMM yyyy")
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {a.returned_date ? (
                              format(new Date(a.returned_date), "dd MMM yyyy")
                            ) : (
                              <Badge variant="default">Active</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No asset assignments
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}
