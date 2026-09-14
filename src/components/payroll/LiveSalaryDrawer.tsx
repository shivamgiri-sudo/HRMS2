import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SalaryTab } from "@/components/attendance/tabs/SalaryTab";
import type { LiveSalaryRow } from "./LiveSalaryTable";

/**
 * Click-through detail for the Current Payroll live-salary lookup — a right-side Sheet,
 * same shape as AttendanceHubDrawer, reusing SalaryTab (RunningMonthCard + payslip history)
 * directly rather than building a second "what does this employee's live salary look like"
 * view. AttendanceHubDrawer's Attendance/Regularizations/Leave tabs aren't relevant here, so
 * this only needs the header + the one tab, not the full 4-tab shell.
 */

interface Props {
  employee: LiveSalaryRow | null;
  onClose: () => void;
}

export function LiveSalaryDrawer({ employee, onClose }: Props) {
  const open = !!employee;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto p-0">
        {employee && (
          <>
            <SheetHeader className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-white to-emerald-50/60 sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 text-xl font-bold">
                  {(employee.name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="text-base font-bold text-slate-950 truncate">
                    {employee.name || employee.employee_code}
                  </SheetTitle>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="font-mono text-xs text-slate-400">{employee.employee_code}</span>
                    {employee.designation_name && (
                      <span className="text-xs text-slate-500">· {employee.designation_name}</span>
                    )}
                    {employee.branch_name && (
                      <span className="text-xs text-slate-500">· {employee.branch_name}</span>
                    )}
                    {employee.process_name && (
                      <span className="text-xs text-slate-500">· {employee.process_name}</span>
                    )}
                  </div>
                </div>
              </div>
            </SheetHeader>

            <div className="px-6 py-4">
              <SalaryTab employeeId={employee.employee_id} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
