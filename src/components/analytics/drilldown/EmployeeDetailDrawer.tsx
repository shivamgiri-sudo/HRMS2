import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDrillDown } from "./DrillDownProvider";

/**
 * Shape actually returned by `GET /api/employees/:id`
 * (backend/src/modules/employees/employee.controller.ts:getEmployee, backed by
 * employee.service.ts's `SELECT * FROM employees WHERE id = ?`).
 *
 * IMPORTANT: this is a flat `SELECT *` on `employees` with no joins. There is no
 * `branch_name` / `cost_centre_name` / `process_name` anywhere in the response --
 * only the raw FK ids (`branch_id`, `department_id`, `process_id`, and `cost_centre_id`,
 * which exists on the table per schema-snapshot.json but isn't in the typed
 * `Employee` interface since that type predates it). Verified against
 * `backend/src/modules/employees/employee.types.ts` and the controller/service source
 * directly -- do not reintroduce the friendly-name fields without an actual join.
 */
export interface EmployeeDetail {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string | null;
  full_name?: string;
  employment_type?: string | null;
  employment_status?: string | null;
  date_of_joining?: string | null;
  salary_start_date?: string | null;
  date_of_exit?: string | null;
  branch_id?: string | null;
  department_id?: string | null;
  process_id?: string | null;
  cost_centre_id?: string | null;
  reporting_manager_id?: string | null;
  active_status?: number;
  [key: string]: unknown;
}

/**
 * Formats an ISO date string as DD/MM/YYYY per the CLAUDE.md Drill-Down Mandate.
 * Exported as a pure function so it's testable without mounting the component, and so a
 * null/undefined/garbage value from the API can never crash the drawer -- it falls back to "—".
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Fetches the single-employee detail record from the dedicated `GET /api/employees/:id`
 * endpoint -- never the list report payload EmployeeListPanel already holds, per the
 * CLAUDE.md Drill-Down Mandate ("fetches ... from a dedicated GET /api/<module>/:id endpoint --
 * never reuse the list payload"). Extracted as a plain async function so it -- and the
 * `res.data` unwrapping -- can be exercised directly in a test without mounting the component.
 */
export async function fetchEmployeeDetail(id: string): Promise<EmployeeDetail | undefined> {
  const res = await hrmsApi.get<{ data?: EmployeeDetail }>(`/api/employees/${id}`);
  return res.data;
}

export function EmployeeDetailDrawer() {
  const { selectedEmployeeId, deselectEmployee } = useDrillDown();

  const q = useQuery({
    queryKey: ["employee-detail", selectedEmployeeId],
    enabled: !!selectedEmployeeId,
    retry: false,
    queryFn: () => fetchEmployeeDetail(selectedEmployeeId!),
  });

  const emp = q.data;
  const displayName = emp ? (emp.full_name || `${emp.first_name} ${emp.last_name ?? ""}`.trim()) : "Employee";

  return (
    <Sheet open={!!selectedEmployeeId} onOpenChange={o => !o && deselectEmployee()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{displayName}</SheetTitle>
          {emp && <SheetDescription>{emp.employee_code}</SheetDescription>}
        </SheetHeader>

        {q.isLoading ? (
          <div className="mt-4 space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded" />)}
          </div>
        ) : q.error ? (
          <p className="mt-4 text-sm text-rose-700">
            {(q.error as Error).message || "Failed to load employee detail."}
          </p>
        ) : emp ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Employment</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Status</dt><dd className="text-slate-900">{emp.employment_status ?? "—"}</dd>
                <dt className="text-slate-500">Type</dt><dd className="text-slate-900">{emp.employment_type ?? "—"}</dd>
              </dl>
            </div>
            <div>
              {/*
                The endpoint has no joined branch/cost-centre/process names (see the
                EmployeeDetail comment above) -- only raw ids. Showing the ids rather than
                inventing names keeps this honest until a join or a lookup is added.
              */}
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Assignment</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Branch ID</dt><dd className="text-slate-900">{emp.branch_id ?? "—"}</dd>
                <dt className="text-slate-500">Department ID</dt><dd className="text-slate-900">{emp.department_id ?? "—"}</dd>
                <dt className="text-slate-500">Process ID</dt><dd className="text-slate-900">{emp.process_id ?? "—"}</dd>
                <dt className="text-slate-500">Cost Centre ID</dt><dd className="text-slate-900">{emp.cost_centre_id ?? "—"}</dd>
              </dl>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Tenure</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Joined</dt><dd className="text-slate-900">{formatDate(emp.date_of_joining)}</dd>
                <dt className="text-slate-500">Salary Start</dt><dd className="text-slate-900">{formatDate(emp.salary_start_date)}</dd>
                <dt className="text-slate-500">Exited</dt><dd className="text-slate-900">{formatDate(emp.date_of_exit)}</dd>
              </dl>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
