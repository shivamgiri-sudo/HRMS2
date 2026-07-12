import { useState, useEffect } from "react";
import {
  Clock,
  IndianRupee,
  Search,
  Users,
  TrendingUp,
  Filter,
  Download,
  CalendarDays,
  Settings2,
  ShieldCheck,
  ShieldOff,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { format } from "date-fns";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { OvertimeUpdateDialog } from "@/components/payroll/OvertimeUpdateDialog";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";

interface PayrollLine {
  id: string;
  run_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  employee_email: string;
  employee_avatar?: string;
  working_days: number;
  present_days: number;
  lwp_days: number;
  overtime_hours: number;
  overtime_amount: number;
  gross_salary: number;
  net_salary: number;
  total_deductions: number;
  run_month: string;
  run_status: string;
}

interface Run {
  id: string;
  run_month: string;
  status: string;
  total_employees: number;
  total_gross: number;
  total_net: number;
}

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

const currentDate = new Date();
const currentMonth = currentDate.getMonth() + 1;
const currentYear = currentDate.getFullYear();

interface OTProcessConfig {
  id: string;
  process_code: string;
  process_name: string;
  overtime_allowed: string;
  overtime_rate_multiplier: string;
  overtime_monthly_cap_hours: string;
}

export default function PayrollOvertimeManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedMonth, setSelectedMonth] = useState(currentMonth.toString());
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [overtimeDialogOpen, setOvertimeDialogOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<PayrollLine | null>(null);
  const [showOTConfig, setShowOTConfig] = useState(false);

  const runMonth = `${selectedYear}-${selectedMonth.padStart(2, "0")}`;

  // Fetch payroll runs for the selected month
  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ["payroll-runs", runMonth],
    queryFn: async () => {
      const response = await hrmsApi.get<{ data: Run[] }>(`/api/payroll/runs?runMonth=${runMonth}`);
      return response.data;
    },
  });

  // Fetch lines for the selected run
  const { data: lines, isLoading: linesLoading, refetch: refetchLines } = useQuery({
    queryKey: ["payroll-lines", selectedRun],
    queryFn: async () => {
      if (!selectedRun) return [];
      const response = await hrmsApi.get<{ data: PayrollLine[] }>(`/api/payroll/runs/${selectedRun}/lines`);
      return response.data;
    },
    enabled: !!selectedRun,
  });

  // Auto-select first run when month changes
  useEffect(() => {
    if (runs && runs.length > 0 && !selectedRun) {
      setSelectedRun(runs[0].id);
    }
  }, [runs, selectedRun]);

  // Filter lines by search query
  const filteredLines = lines?.filter((line) => {
    const query = searchQuery.toLowerCase();
    return (
      line.employee_code.toLowerCase().includes(query) ||
      line.employee_name.toLowerCase().includes(query) ||
      line.employee_email.toLowerCase().includes(query)
    );
  });

  // Calculate statistics
  const stats = {
    totalEmployees: filteredLines?.length || 0,
    totalOvertimeHours: filteredLines?.reduce((sum, line) => sum + line.overtime_hours, 0) || 0,
    totalOvertimeAmount: filteredLines?.reduce((sum, line) => sum + line.overtime_amount, 0) || 0,
    avgOvertimeHours:
      filteredLines && filteredLines.length > 0
        ? filteredLines.reduce((sum, line) => sum + line.overtime_hours, 0) / filteredLines.length
        : 0,
  };

  const handleEditOvertime = (line: PayrollLine) => {
    setSelectedLine(line);
    setOvertimeDialogOpen(true);
  };

  const handleOvertimeSuccess = () => {
    refetchLines();
    toast({
      title: "Overtime Updated",
      description: "Overtime has been successfully updated.",
    });
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
    }).format(amount);

  const selectedRunData = runs?.find((r) => r.id === selectedRun);
  const isEditable = selectedRunData?.status === "draft";

  // ─── OT Process Configuration ─────────────────────────────────────────────
  const { data: otProcessConfigs, isLoading: otConfigLoading } = useQuery({
    queryKey: ["overtime-process-configs"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: OTProcessConfig[] }>("/api/payroll/overtime/config/processes");
      return res.data;
    },
  });

  const toggleOTMutation = useMutation({
    mutationFn: async ({ processId, enabled, rateMultiplier, capHours }: {
      processId: string; enabled?: boolean; rateMultiplier?: number; capHours?: number;
    }) => {
      await hrmsApi.patch(`/api/payroll/overtime/config/process/${processId}`, {
        overtime_allowed: enabled,
        overtime_rate_multiplier: rateMultiplier,
        overtime_monthly_cap_hours: capHours,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overtime-process-configs"] });
      toast({ title: "OT Configuration Updated", description: "Process overtime settings saved." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update", variant: "destructive" });
    },
  });

  return (
    <DashboardLayout
      title="Overtime Management"
      description="Manage employee overtime hours and amounts for payroll"
    >
      <div className="space-y-6">
        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-1 gap-3">
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[150px]">
                    <CalendarDays className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((month) => (
                      <SelectItem key={month.value} value={month.value}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Year" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => currentYear - i).map((year) => (
                      <SelectItem key={year} value={year.toString()}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {runs && runs.length > 1 && (
                  <Select value={selectedRun || ""} onValueChange={setSelectedRun}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select run" />
                    </SelectTrigger>
                    <SelectContent>
                      {runs.map((run) => (
                        <SelectItem key={run.id} value={run.id}>
                          Run {format(new Date(run.run_month + "-01"), "MMM yyyy")} ({run.status})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="relative w-full md:w-[300px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Statistics */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalEmployees}</div>
              <p className="text-xs text-muted-foreground">
                In selected payroll run
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total OT Hours</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalOvertimeHours.toFixed(1)}h</div>
              <p className="text-xs text-muted-foreground">
                Across all employees
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total OT Amount</CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(stats.totalOvertimeAmount).replace("₹", "₹")}
              </div>
              <p className="text-xs text-muted-foreground">
                Total overtime payout
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg OT per Employee</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.avgOvertimeHours.toFixed(1)}h</div>
              <p className="text-xs text-muted-foreground">
                Average overtime hours
              </p>
            </CardContent>
          </Card>
        </div>

        {/* OT Process Configuration Panel */}
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setShowOTConfig((v) => !v)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Process Overtime Configuration</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {otProcessConfigs?.filter((p) => p.overtime_allowed === "true").length ?? 0} / {otProcessConfigs?.length ?? 0} enabled
                </Badge>
              </div>
              {showOTConfig ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Overtime must be explicitly enabled per process. Employees in disabled processes cannot have OT recorded.
            </p>
          </CardHeader>
          {showOTConfig && (
            <CardContent>
              {otConfigLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : !otProcessConfigs || otProcessConfigs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No processes found.</p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Process</TableHead>
                        <TableHead className="text-center w-[120px]">OT Allowed</TableHead>
                        <TableHead className="text-center w-[120px]">Rate (x)</TableHead>
                        <TableHead className="text-center w-[140px]">Monthly Cap (h)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {otProcessConfigs.map((proc) => {
                        const allowed = proc.overtime_allowed === "true";
                        return (
                          <TableRow key={proc.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {allowed ? (
                                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                                ) : (
                                  <ShieldOff className="h-4 w-4 text-slate-300" />
                                )}
                                <span className="font-medium">{proc.process_name}</span>
                                <span className="text-xs text-muted-foreground">({proc.process_code})</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Switch
                                checked={allowed}
                                onCheckedChange={(checked) =>
                                  toggleOTMutation.mutate({ processId: proc.id, enabled: checked })
                                }
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Input
                                type="number"
                                step="0.5"
                                min="1"
                                max="5"
                                className="w-20 h-7 text-center text-sm mx-auto"
                                defaultValue={proc.overtime_rate_multiplier}
                                disabled={!allowed}
                                onBlur={(e) => {
                                  const val = parseFloat(e.target.value);
                                  if (!isNaN(val) && val > 0 && val !== parseFloat(proc.overtime_rate_multiplier)) {
                                    toggleOTMutation.mutate({ processId: proc.id, rateMultiplier: val });
                                  }
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Input
                                type="number"
                                step="1"
                                min="0"
                                max="500"
                                className="w-20 h-7 text-center text-sm mx-auto"
                                defaultValue={proc.overtime_monthly_cap_hours}
                                disabled={!allowed}
                                onBlur={(e) => {
                                  const val = parseFloat(e.target.value);
                                  if (!isNaN(val) && val >= 0 && val !== parseFloat(proc.overtime_monthly_cap_hours)) {
                                    toggleOTMutation.mutate({ processId: proc.id, capHours: val });
                                  }
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Status Alert */}
        {selectedRunData && !isEditable && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-amber-900">
                <Filter className="h-4 w-4" />
                <span className="text-sm font-medium">
                  This payroll run is <Badge variant="outline">{selectedRunData.status}</Badge> and cannot be edited.
                  Only draft runs can have overtime updated.
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Employee Overtime Table */}
        <Card>
          <CardHeader>
            <CardTitle>Employee Overtime Details</CardTitle>
          </CardHeader>
          <CardContent>
            {linesLoading || runsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !filteredLines || filteredLines.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {searchQuery
                  ? "No employees match your search"
                  : "No payroll data found for the selected month"}
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="text-right">Working Days</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">LWP</TableHead>
                      <TableHead className="text-right">OT Hours</TableHead>
                      <TableHead className="text-right">OT Amount</TableHead>
                      <TableHead className="text-right">Gross Salary</TableHead>
                      <TableHead className="text-right">Net Salary</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={line.employee_avatar} />
                              <AvatarFallback>
                                {line.employee_name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">{line.employee_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {line.employee_code}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{line.working_days}</TableCell>
                        <TableCell className="text-right">{line.present_days}</TableCell>
                        <TableCell className="text-right">
                          {line.lwp_days > 0 ? (
                            <Badge variant="outline" className="text-xs text-amber-600">
                              {line.lwp_days}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {line.overtime_hours > 0 ? (
                            <span className="font-semibold text-blue-600">
                              {line.overtime_hours}h
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0h</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {line.overtime_amount > 0 ? (
                            <span className="font-semibold text-blue-600">
                              {formatCurrency(line.overtime_amount)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">₹0.00</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCurrency(line.gross_salary)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {formatCurrency(line.net_salary)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditOvertime(line)}
                            disabled={!isEditable}
                          >
                            <Clock className="mr-1 h-3 w-3" />
                            Edit OT
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Overtime Update Dialog */}
      {selectedLine && (
        <OvertimeUpdateDialog
          open={overtimeDialogOpen}
          onOpenChange={setOvertimeDialogOpen}
          lineId={selectedLine.id}
          employeeCode={selectedLine.employee_code}
          employeeName={selectedLine.employee_name}
          currentOvertimeHours={selectedLine.overtime_hours}
          currentOvertimeAmount={selectedLine.overtime_amount}
          currentGross={selectedLine.gross_salary}
          currentNet={selectedLine.net_salary}
          onSuccess={handleOvertimeSuccess}
        />
      )}
    </DashboardLayout>
  );
}
