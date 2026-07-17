import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Calendar, Wallet, ClipboardList, TreePalm } from "lucide-react";
import type { HubEmployee } from "@/hooks/useAttendanceHub";
import { AttendanceTab } from "./tabs/AttendanceTab";
import { SalaryTab } from "./tabs/SalaryTab";
import { RegularizationsTab } from "./tabs/RegularizationsTab";
import { LeaveTab } from "./tabs/LeaveTab";

const STATUS_COLORS: Record<string, string> = {
  active:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive:    "bg-slate-100 text-slate-600 border-slate-200",
  "on notice": "bg-amber-50 text-amber-700 border-amber-200",
  onboarding:  "bg-blue-50 text-blue-700 border-blue-200",
};

interface Props {
  employee: HubEmployee | null;
  onClose: () => void;
}

export function AttendanceHubDrawer({ employee, onClose }: Props) {
  const open = !!employee;
  const statusKey = (employee?.employment_status ?? "").toLowerCase();
  const statusCls = STATUS_COLORS[statusKey] ?? STATUS_COLORS.inactive;

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl overflow-y-auto p-0"
      >
        {employee && (
          <>
            {/* Employee header */}
            <SheetHeader className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-white to-[#f0f7ff] sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700 text-xl font-bold">
                  {(employee.full_name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base font-bold text-slate-950 truncate">
                    {employee.full_name}
                  </SheetTitle>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="font-mono text-xs text-slate-400">{employee.employee_code}</span>
                    {employee.designation_name && (
                      <span className="text-xs text-slate-500">· {employee.designation_name}</span>
                    )}
                    {employee.branch_name && (
                      <span className="text-xs text-slate-500">· {employee.branch_name}</span>
                    )}
                    <Badge className={`text-[10px] border capitalize ${statusCls} hover:${statusCls}`}>
                      {statusKey || "—"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Quick stats strip */}
              <div className="flex gap-4 mt-3 text-center">
                {[
                  { label: "Present (MTD)", value: employee.present_days, warn: false },
                  { label: "LWP (MTD)", value: Number(employee.lwp_days).toFixed(1), warn: Number(employee.lwp_days) > 2 },
                  { label: "Late Marks (MTD)", value: employee.late_marks, warn: Number(employee.late_marks) > 3 },
                  { label: "Missing Punches", value: employee.missing_punch_count, warn: employee.missing_punch_count > 0 },
                ].map(item => (
                  <div key={item.label} className="flex-1 rounded-xl bg-white border border-slate-200 px-2 py-2">
                    <p className={`text-base font-bold ${item.warn ? "text-rose-600" : "text-slate-800"}`}>{item.value}</p>
                    <p className="text-[9px] text-slate-400 mt-0.5 leading-tight">{item.label}</p>
                  </div>
                ))}
              </div>
            </SheetHeader>

            {/* Tabs */}
            <div className="px-6 py-4">
              <Tabs defaultValue="attendance">
                <TabsList className="mb-4 h-9 w-full justify-start gap-1 bg-slate-100 p-1 rounded-xl">
                  <TabsTrigger value="attendance" className="flex items-center gap-1.5 text-xs rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <Calendar className="h-3.5 w-3.5" />
                    Attendance
                  </TabsTrigger>
                  <TabsTrigger value="salary" className="flex items-center gap-1.5 text-xs rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <Wallet className="h-3.5 w-3.5" />
                    Salary
                  </TabsTrigger>
                  <TabsTrigger value="regularizations" className="flex items-center gap-1.5 text-xs rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <ClipboardList className="h-3.5 w-3.5" />
                    Regularizations
                  </TabsTrigger>
                  <TabsTrigger value="leave" className="flex items-center gap-1.5 text-xs rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <TreePalm className="h-3.5 w-3.5" />
                    Leave
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="attendance">
                  <AttendanceTab employeeId={employee.id} />
                </TabsContent>
                <TabsContent value="salary">
                  <SalaryTab employeeId={employee.id} />
                </TabsContent>
                <TabsContent value="regularizations">
                  <RegularizationsTab employeeId={employee.id} />
                </TabsContent>
                <TabsContent value="leave">
                  <LeaveTab employeeId={employee.id} />
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
