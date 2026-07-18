# People Attendance & Earnings Intelligence Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/pages/AdminAttendanceView.tsx` with a full-featured People Attendance & Earnings Intelligence Hub — a paginated employee directory with filters, per-employee drawer showing attendance (calendar + tabular), running salary breakdown, past payslip full component breakdown, regularization history, and leave balances.

**Architecture:** Single page at `/hr/attendance-lookup` (same URL, same nav entry). The page renders a filterable employee directory table; clicking any row opens a right-side drawer. The drawer fetches data lazily per tab (Attendance / Salary / Regularizations / Leave). All data comes from existing backend APIs — no new backend routes needed except one new endpoint to add `designationId` filter support to the attendance hub employee list. A small new backend route `GET /api/hr/attendance-hub/employees` wraps `listEmployees` and staples the current-month attendance summary per employee for the anomaly flag column.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/Radix (Sheet, Tabs, Badge, Skeleton, Table, Select, Dialog), TanStack Query v5 (`useQuery`), date-fns, lucide-react, hrmsApi (existing fetch wrapper), existing hooks: `useWorkforceAccess`, `useMyAttendanceSummary`.

## Global Constraints

- Role gate: `super_admin`, `admin`, `hr`, `payroll_head`, `payroll_admin`, `wfm` — same as current page
- Never expose raw salary/PII data to `employee` or `manager` roles through this page
- All DB queries use `DATE(CONVERT_TZ(record_date, '+00:00', '+05:30'))` for IST date alignment (already fixed in services)
- No new DB tables — read-only from existing tables
- Existing `AttendanceCalendar` component must remain unchanged
- Follow existing Tailwind class patterns from `AdminAttendanceView.tsx` (`toneMap`, `MetricCard` style, `rounded-2xl border` cards)
- shadcn `Sheet` component already in project at `@/components/ui/sheet`
- `hrmsApi` is the only fetch client — no raw `fetch()`
- Page title in browser tab and `<h1>`: "People Attendance & Earnings"
- Nav label stays "Attendance Lookup" (no nav change needed)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **Replace** | `src/pages/AdminAttendanceView.tsx` | Full page: directory table + filter bar + drawer shell |
| **Create** | `src/components/attendance/AttendanceHubDrawer.tsx` | Right-side Sheet drawer with 4 tabs |
| **Create** | `src/components/attendance/AttendanceHubFilters.tsx` | Filter bar: search + branch + process + designation + status + anomaly |
| **Create** | `src/components/attendance/AttendanceHubTable.tsx` | Paginated employee table with anomaly badges |
| **Create** | `src/components/attendance/tabs/AttendanceTab.tsx` | Attendance tab: calendar + tabular views + month summary strip |
| **Create** | `src/components/attendance/tabs/SalaryTab.tsx` | Salary tab: running month card + past payslips with full breakdown |
| **Create** | `src/components/attendance/tabs/RegularizationsTab.tsx` | Regularizations tab: history table |
| **Create** | `src/components/attendance/tabs/LeaveTab.tsx` | Leave balances + history tab |
| **Create** | `src/hooks/useAttendanceHub.ts` | All TanStack Query hooks for this feature |
| **Modify** | `backend/src/modules/employees/employee.validation.ts` | Add `designationId` to `employeeFiltersSchema` (it's already in service but missing from schema) |

---

## Task 1: Backend — add `designationId` to employee filters schema + new HR hub employees endpoint

**Files:**
- Modify: `backend/src/modules/employees/employee.validation.ts` lines 64–78
- Modify: `backend/src/modules/employees/employee.routes.ts` (add new HR hub route)
- Modify: `backend/src/modules/employees/employee.service.ts` (add designationId filter to listEmployees)

**Interfaces:**
- Produces: `GET /api/employees?designationId=<uuid>&branchId=<uuid>&processId=<uuid>&status=<str>&search=<str>&page=<n>&limit=<n>` returns `{ data: Employee[], total: number, page: number, limit: number }`
- Produces: `GET /api/hr/attendance-hub/employees?month=YYYY-MM&branchId=...&processId=...&designationId=...&search=...&page=1&limit=50` returns `{ data: HubEmployee[], total: number, page: number, limit: number }`

where `HubEmployee` extends `Employee` with:
```ts
{
  present_days: number;       // COUNT present for month
  lwp_days: number;           // SUM lwp_value for month
  late_marks: number;         // SUM late_mark for month
  missing_punch_count: number; // COUNT missing_punch for month
  has_anomaly: boolean;        // lwp_days > 2 OR missing_punch_count > 0
  last_salary_net: number | null;     // net_salary from latest salary_prep_line
  last_salary_month: string | null;   // run_month of that line
}
```

- [ ] **Step 1: Add `designationId` to employeeFiltersSchema**

Open `backend/src/modules/employees/employee.validation.ts`. Change the `employeeFiltersSchema` block from:
```ts
export const employeeFiltersSchema = z.object({
  status: z.string().optional(),
  recordStatus: z.enum(["active", "inactive", "all"]).default("all"),
  processId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  includeAnalytics: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
```
to:
```ts
export const employeeFiltersSchema = z.object({
  status: z.string().optional(),
  recordStatus: z.enum(["active", "inactive", "all"]).default("all"),
  processId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  designationId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  includeAnalytics: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
```

- [ ] **Step 2: Wire `designationId` filter in `employee.service.ts` `listEmployees`**

In `backend/src/modules/employees/employee.service.ts`, find the destructure at line ~165:
```ts
const { page, limit, status, processId, branchId, departmentId, search, scopeFilter } = filters;
```
Change to:
```ts
const { page, limit, status, processId, branchId, departmentId, designationId, search, scopeFilter } = filters;
```
Then after the `if (departmentId)` line, add:
```ts
if (designationId) { conds.push("e.designation_id = ?"); params.push(designationId); }
```

- [ ] **Step 3: Add the HR hub employees route**

In `backend/src/modules/employees/employee.routes.ts`, after the existing `/stats` route and before the `/` list route, insert:

```ts
// GET /api/employees/hr-hub?month=YYYY-MM&branchId=&processId=&designationId=&search=&page=&limit=
// Returns employee list enriched with current-month attendance summary and last payslip net.
// Used by People Attendance & Earnings Hub.
router.get("/hr-hub", requireRole("super_admin", "admin", "hr", "payroll_head", "payroll_admin", "wfm"), h(async (req: any, res: any) => {
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ success: false, error: "month must be YYYY-MM" });
  }
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager"],
    { branchId: "e.branch_id", processId: "e.process_id", departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id" },
    { allowAdminBypass: true, allowCeoAllRead: true }
  );

  const parsed = employeeFiltersSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { page, limit, status, processId, branchId, departmentId, designationId, search } = parsed.data;
  const offset = (page - 1) * limit;

  const conds: string[] = ["e.active_status = 1"];
  const params: unknown[] = [];
  if (status)       { conds.push("e.employment_status = ?");  params.push(status); }
  if (processId)    { conds.push("e.process_id = ?");         params.push(processId); }
  if (branchId)     { conds.push("e.branch_id = ?");          params.push(branchId); }
  if (departmentId) { conds.push("e.department_id = ?");      params.push(departmentId); }
  if (designationId){ conds.push("e.designation_id = ?");     params.push(designationId); }
  if (search)       {
    conds.push("(e.full_name LIKE ? OR e.employee_code LIKE ? OR e.official_email LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (scoped.sql && scoped.sql !== "1=1") {
    conds.push(`(${scoped.sql.replace(/^WHERE\s+/i, "").trim()})`);
    params.push(...(scoped.params ?? []));
  }
  const where = `WHERE ${conds.join(" AND ")}`;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) AS full_name,
            e.employment_status, e.date_of_joining,
            bm.branch_name, pm.process_name, dm.designation_name, dept.dept_name,
            (SELECT COUNT(*) FROM attendance_daily_record adr
               WHERE adr.employee_id = e.id
                 AND DATE(CONVERT_TZ(adr.record_date,'+00:00','+05:30')) BETWEEN ? AND ?
                 AND adr.attendance_status = 'present') AS present_days,
            (SELECT COALESCE(SUM(adr2.lwp_value),0) FROM attendance_daily_record adr2
               WHERE adr2.employee_id = e.id
                 AND DATE(CONVERT_TZ(adr2.record_date,'+00:00','+05:30')) BETWEEN ? AND ?) AS lwp_days,
            (SELECT COALESCE(SUM(adr3.late_mark),0) FROM attendance_daily_record adr3
               WHERE adr3.employee_id = e.id
                 AND DATE(CONVERT_TZ(adr3.record_date,'+00:00','+05:30')) BETWEEN ? AND ?) AS late_marks,
            (SELECT COUNT(*) FROM attendance_daily_record adr4
               WHERE adr4.employee_id = e.id
                 AND DATE(CONVERT_TZ(adr4.record_date,'+00:00','+05:30')) BETWEEN ? AND ?
                 AND adr4.attendance_status = 'missing_punch') AS missing_punch_count,
            (SELECT spl.net_salary FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               WHERE spl.employee_id = e.id
               ORDER BY spr.run_month DESC LIMIT 1) AS last_salary_net,
            (SELECT spr2.run_month FROM salary_prep_line spl2
               JOIN salary_prep_run spr2 ON spr2.id = spl2.run_id
               WHERE spl2.employee_id = e.id
               ORDER BY spr2.run_month DESC LIMIT 1) AS last_salary_month
       FROM employees e
       LEFT JOIN branch_master bm      ON bm.id  = e.branch_id
       LEFT JOIN process_master pm     ON pm.id  = e.process_id
       LEFT JOIN designation_master dm ON dm.id  = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       ${where}
       ORDER BY e.employee_code ASC
       LIMIT ${limit} OFFSET ${offset}`,
    [...params, monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd]
  );

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM employees e ${where}`, params
  );

  const data = (rows as any[]).map(r => ({
    ...r,
    has_anomaly: Number(r.lwp_days) > 2 || Number(r.missing_punch_count) > 0,
  }));

  return res.json({ success: true, data, total: Number((countRows as any)[0]?.total ?? 0), page, limit });
}));
```

You need to add the import for `buildScopeWhereClause` and `employeeFiltersSchema` at the top of that file if not already present. Check the existing imports — `buildScopeWhereClause` is imported from `../../shared/scopeAccess.js` and `employeeFiltersSchema` from `./employee.validation.js`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit 2>&1 | grep -E "employee.routes|employee.validation|employee.service" | head -20
```
Expected: no output (zero errors).

- [ ] **Step 5: Quick smoke test**

```bash
cd backend && node -e "
const mysql = require('mysql2/promise');
// Just verify the SQL shape works by checking the tables exist
async function main() {
  const db = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms', connectTimeout:10000 });
  const [r] = await db.execute('SELECT COUNT(*) AS c FROM employees WHERE active_status=1');
  console.log('Active employees:', r[0].c);
  await db.end();
}
main().catch(e => console.error(e.message));
"
```
Expected output: `Active employees: <some number>`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/employees/employee.validation.ts \
        backend/src/modules/employees/employee.routes.ts \
        backend/src/modules/employees/employee.service.ts
git commit -m "feat(employees): add designationId filter + HR hub enriched employee endpoint"
```

---

## Task 2: Frontend hooks — `useAttendanceHub.ts`

**Files:**
- Create: `src/hooks/useAttendanceHub.ts`

**Interfaces:**
- Produces: `useHubEmployees(filters, month)` — paginated employee list with anomaly flags
- Produces: `useAttendanceDailyRecords(employeeId, fromDate, toDate)` — daily records array for tabular view
- Produces: `useAttendanceSummary(employeeId, month)` — monthly summary object
- Produces: `useRunningSalary(employeeId, month)` — running salary breakdown
- Produces: `usePayslipHistory(employeeId)` — paginated past payslips
- Produces: `usePayslipDetail(runId, employeeId)` — single payslip with component breakdown
- Produces: `useRegularizationHistory(employeeId)` — list of regularizations
- Produces: `useLeaveBalance(employeeId, year)` — leave balance ledger
- Produces: `useBranchList()` — branch options for filter dropdown
- Produces: `useProcessList()` — process options for filter dropdown
- Produces: `useDesignationList()` — designation options for filter dropdown

All hooks return `{ data, isLoading, error }` from `useQuery`.

- [ ] **Step 1: Create the hooks file**

Create `src/hooks/useAttendanceHub.ts` with this exact content:

```ts
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface HubEmployee {
  id: string;
  employee_code: string;
  full_name: string;
  employment_status: string;
  date_of_joining: string;
  branch_name: string | null;
  process_name: string | null;
  designation_name: string | null;
  dept_name: string | null;
  present_days: number;
  lwp_days: number;
  late_marks: number;
  missing_punch_count: number;
  has_anomaly: boolean;
  last_salary_net: number | null;
  last_salary_month: string | null;
}

export interface HubFilters {
  search: string;
  branchId: string;
  processId: string;
  designationId: string;
  status: string;
  anomalyOnly: boolean;
  page: number;
  limit: number;
}

export interface DailyRecord {
  date: string;
  status: string;
  clock_in: string | null;
  clock_out: string | null;
  raw_minutes: number | null;
  location: string | null;
  source: string | null;
}

export interface AttendanceSummary {
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  weekOffDays: number;
  totalLwp: number;
  lateMarks: number;
  totalWorkingDays: number;
  totalHours: number;
  wfoDays: number;
  attendancePct: number;
}

export interface RunningSalary {
  earned_payable_days: number;
  eligible_weekoff_till_date: number;
  eligible_holiday_till_date: number;
  earned_salary_till_date: number;
  earned_net_till_date: number;
  projected_payable_days: number;
  projected_salary: number;
  projected_net: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
}

export interface PayslipSummary {
  run_id: string;
  run_month: string;
  gross_salary: number;
  net_salary: number;
  total_deductions: number;
  status: string;
  paid_at: string | null;
  run_status: string;
}

export interface PayslipComponent {
  component_code: string;
  component_name: string;
  component_type: "earning" | "deduction";
  amount: number;
  taxable: number;
}

export interface PayslipDetail extends PayslipSummary {
  basic: number;
  hra: number;
  special_allowance: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  tds: number;
  lwp_deduction: number;
  advance_recovery: number;
  paid_working_days: number;
  eligible_weekoff_days: number;
  eligible_holiday_days: number;
  final_payable_days: number;
  active_calendar_days: number;
  components: PayslipComponent[];
}

export interface RegularizationRecord {
  id: string;
  session_date: string;
  request_category: string;
  old_status: string | null;
  requested_status: string | null;
  reason: string;
  status: string;
  submitted_at: string;
  manager_reviewed_at: string | null;
  reviewed_at: string | null;
}

export interface LeaveBalance {
  leave_type_id: string;
  leave_type_name: string;
  allocated_days: number;
  used_days: number;
  adjusted_days: number;
  balance: number;
}

export interface SelectOption {
  id: string;
  name: string;
}

// ── Directory ──────────────────────────────────────────────────────────────

export function useHubEmployees(filters: HubFilters, month: string) {
  const params = new URLSearchParams({ month, page: String(filters.page), limit: String(filters.limit) });
  if (filters.search)       params.set("search", filters.search);
  if (filters.branchId)     params.set("branchId", filters.branchId);
  if (filters.processId)    params.set("processId", filters.processId);
  if (filters.designationId) params.set("designationId", filters.designationId);
  if (filters.status)       params.set("status", filters.status);

  return useQuery({
    queryKey: ["hub-employees", filters, month],
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/employees/hr-hub?${params}`);
      const raw: HubEmployee[] = Array.isArray(res) ? res : (res?.data ?? []);
      if (filters.anomalyOnly) return { data: raw.filter(e => e.has_anomaly), total: raw.filter(e => e.has_anomaly).length };
      return { data: raw, total: Number(res?.total ?? raw.length) };
    },
    staleTime: 60_000,
  });
}

// ── Attendance ─────────────────────────────────────────────────────────────

export function useAttendanceDailyRecords(employeeId: string | null, fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ["attendance-daily", employeeId, fromDate, toDate],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/wfm/attendance/daily?employeeId=${employeeId}&fromDate=${fromDate}&toDate=${toDate}`);
      return (res?.data ?? res ?? []) as DailyRecord[];
    },
    staleTime: 30_000,
  });
}

export function useAttendanceSummary(employeeId: string | null, month: string) {
  return useQuery({
    queryKey: ["attendance-summary", employeeId, month],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/wfm/attendance/summary/${employeeId}/${month}`);
      return (res?.data ?? res) as AttendanceSummary;
    },
    staleTime: 30_000,
  });
}

// ── Salary ─────────────────────────────────────────────────────────────────

export function useRunningSalary(employeeId: string | null, month: string) {
  return useQuery({
    queryKey: ["running-salary", employeeId, month],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/payroll/running-summary/${employeeId}?month=${month}`);
      return (res?.data ?? res?.summary ?? res) as RunningSalary;
    },
    staleTime: 60_000,
  });
}

export function usePayslipHistory(employeeId: string | null) {
  return useQuery({
    queryKey: ["payslip-history", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/payroll/payslip/my?limit=24`);
      return (res?.data ?? res ?? []) as PayslipSummary[];
    },
    staleTime: 120_000,
  });
}

export function usePayslipDetail(runId: string | null, employeeId: string | null) {
  return useQuery({
    queryKey: ["payslip-detail", runId, employeeId],
    enabled: !!runId && !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/payroll/payslip/${runId}/${employeeId}`);
      return (res?.data ?? res) as PayslipDetail;
    },
    staleTime: 300_000,
  });
}

// ── Regularizations ────────────────────────────────────────────────────────

export function useRegularizationHistory(employeeId: string | null) {
  return useQuery({
    queryKey: ["regularization-history", employeeId],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/wfm/regularizations?employeeId=${employeeId}&limit=50`);
      return (res?.data ?? res ?? []) as RegularizationRecord[];
    },
    staleTime: 60_000,
  });
}

// ── Leave ──────────────────────────────────────────────────────────────────

export function useLeaveBalance(employeeId: string | null, year: number) {
  return useQuery({
    queryKey: ["leave-balance", employeeId, year],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/leave/balance/${employeeId}?year=${year}`);
      return (res?.data ?? res ?? []) as LeaveBalance[];
    },
    staleTime: 120_000,
  });
}

// ── Master lists for filter dropdowns ─────────────────────────────────────

export function useBranchList() {
  return useQuery({
    queryKey: ["branches-list"],
    queryFn: async () => {
      const res = await hrmsApi.get<any>("/api/branches");
      const raw = Array.isArray(res) ? res : (res?.data ?? res?.branches ?? []);
      return raw.map((b: any) => ({ id: b.id, name: b.branch_name ?? b.name })) as SelectOption[];
    },
    staleTime: 300_000,
  });
}

export function useProcessList() {
  return useQuery({
    queryKey: ["processes-list"],
    queryFn: async () => {
      const res = await hrmsApi.get<any>("/api/process");
      const raw = Array.isArray(res) ? res : (res?.data ?? res?.processes ?? []);
      return raw.map((p: any) => ({ id: p.id, name: p.process_name ?? p.name })) as SelectOption[];
    },
    staleTime: 300_000,
  });
}

export function useDesignationList() {
  return useQuery({
    queryKey: ["designations-list"],
    queryFn: async () => {
      const res = await hrmsApi.get<any>("/api/designations");
      const raw = Array.isArray(res) ? res : (res?.data ?? res?.designations ?? []);
      return raw.map((d: any) => ({ id: d.id, name: d.designation_name ?? d.name })) as SelectOption[];
    },
    staleTime: 300_000,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | grep "useAttendanceHub" | head -10
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAttendanceHub.ts
git commit -m "feat(attendance-hub): add TanStack Query hooks for hub feature"
```

---

## Task 3: Filter bar component — `AttendanceHubFilters.tsx`

**Files:**
- Create: `src/components/attendance/AttendanceHubFilters.tsx`

**Interfaces:**
- Consumes: `HubFilters` from `useAttendanceHub.ts`; `useBranchList`, `useProcessList`, `useDesignationList` from `useAttendanceHub.ts`
- Produces: `<AttendanceHubFilters filters={HubFilters} onChange={(partial: Partial<HubFilters>) => void} month={string} onMonthChange={(m: string) => void} />`

- [ ] **Step 1: Create the filter bar**

Create `src/components/attendance/AttendanceHubFilters.tsx`:

```tsx
import { useRef, useEffect } from "react";
import { Search, Filter, AlertTriangle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { HubFilters, SelectOption } from "@/hooks/useAttendanceHub";
import { useBranchList, useProcessList, useDesignationList } from "@/hooks/useAttendanceHub";

interface Props {
  filters: HubFilters;
  onChange: (partial: Partial<HubFilters>) => void;
  month: string;
  onMonthChange: (m: string) => void;
}

function FilterSelect({
  placeholder,
  value,
  options,
  onValueChange,
}: {
  placeholder: string;
  value: string;
  options: SelectOption[];
  onValueChange: (v: string) => void;
}) {
  return (
    <Select value={value || "__all__"} onValueChange={v => onValueChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="h-9 min-w-[140px] text-xs border-slate-200">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map(o => (
          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AttendanceHubFilters({ filters, onChange, month, onMonthChange }: Props) {
  const { data: branches = [] } = useBranchList();
  const { data: processes = [] } = useProcessList();
  const { data: designations = [] } = useDesignationList();

  const searchRef = useRef<HTMLInputElement>(null);

  // '/' keyboard shortcut focuses search
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const hasActiveFilters = filters.branchId || filters.processId || filters.designationId || filters.status || filters.anomalyOnly;

  function clearAll() {
    onChange({ branchId: "", processId: "", designationId: "", status: "", anomalyOnly: false, page: 1 });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            ref={searchRef}
            value={filters.search}
            onChange={e => onChange({ search: e.target.value, page: 1 })}
            placeholder="Search name or code… (press / )"
            className="pl-9 h-9 text-sm border-slate-200"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => onChange({ search: "", page: 1 })}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" />
            </button>
          )}
        </div>

        {/* Month picker */}
        <input
          type="month"
          value={month}
          onChange={e => onMonthChange(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />

        <FilterSelect
          placeholder="All Branches"
          value={filters.branchId}
          options={branches}
          onValueChange={v => onChange({ branchId: v, page: 1 })}
        />
        <FilterSelect
          placeholder="All Processes"
          value={filters.processId}
          options={processes}
          onValueChange={v => onChange({ processId: v, page: 1 })}
        />
        <FilterSelect
          placeholder="All Designations"
          value={filters.designationId}
          options={designations}
          onValueChange={v => onChange({ designationId: v, page: 1 })}
        />
        <FilterSelect
          placeholder="All Statuses"
          value={filters.status}
          options={[
            { id: "Active", name: "Active" },
            { id: "Inactive", name: "Inactive" },
            { id: "On Notice", name: "On Notice" },
            { id: "Onboarding", name: "Onboarding" },
          ]}
          onValueChange={v => onChange({ status: v, page: 1 })}
        />

        {/* Anomaly toggle */}
        <button
          type="button"
          onClick={() => onChange({ anomalyOnly: !filters.anomalyOnly, page: 1 })}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            filters.anomalyOnly
              ? "border-rose-300 bg-rose-50 text-rose-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Anomalies only
        </button>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-xs text-slate-500 h-8 px-2">
            <X className="h-3 w-3 mr-1" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Compile check**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | grep "AttendanceHubFilters" | head -10
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/attendance/AttendanceHubFilters.tsx
git commit -m "feat(attendance-hub): add filter bar component with branch/process/designation/anomaly filters"
```

---

## Task 4: Employee directory table — `AttendanceHubTable.tsx`

**Files:**
- Create: `src/components/attendance/AttendanceHubTable.tsx`

**Interfaces:**
- Consumes: `HubEmployee[]`, `total: number`, `page: number`, `limit: number`, `isLoading: boolean`, `month: string`
- Produces: `<AttendanceHubTable employees={HubEmployee[]} total={number} page={number} limit={number} isLoading={boolean} month={string} onPageChange={(p:number)=>void} onSelect={(emp:HubEmployee)=>void} selectedId={string|null} />`

- [ ] **Step 1: Create the table**

Create `src/components/attendance/AttendanceHubTable.tsx`:

```tsx
import { ChevronLeft, ChevronRight, AlertTriangle, User, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { HubEmployee } from "@/hooks/useAttendanceHub";

const INR = (v: number | null | undefined) =>
  v != null ? `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—";

const STATUS_COLORS: Record<string, string> = {
  active:      "bg-emerald-50 text-emerald-700 border-emerald-200",
  inactive:    "bg-slate-100 text-slate-600 border-slate-200",
  "on notice": "bg-amber-50 text-amber-700 border-amber-200",
  onboarding:  "bg-blue-50 text-blue-700 border-blue-200",
};

interface Props {
  employees: HubEmployee[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  month: string;
  onPageChange: (p: number) => void;
  onSelect: (emp: HubEmployee) => void;
  selectedId: string | null;
}

export function AttendanceHubTable({
  employees, total, page, limit, isLoading, month,
  onPageChange, onSelect, selectedId,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const [y, m] = month.split("-");
  const monthLabel = new Date(Number(y), Number(m) - 1).toLocaleString("en-IN", { month: "short", year: "numeric" });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!employees.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 py-16 gap-3 text-center">
        <User className="h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">No employees match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Table header */}
      <div className="grid grid-cols-[2fr_1fr_1fr_repeat(3,_0.8fr)_1fr_0.6fr] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        <span>Employee</span>
        <span>Branch / Process</span>
        <span>Designation</span>
        <span>{monthLabel} Present</span>
        <span>LWP</span>
        <span>Late</span>
        <span>Last Salary</span>
        <span></span>
      </div>

      {/* Rows */}
      {employees.map(emp => {
        const statusKey = (emp.employment_status ?? "").toLowerCase();
        const statusCls = STATUS_COLORS[statusKey] ?? STATUS_COLORS.inactive;
        const isSelected = selectedId === emp.id;

        return (
          <button
            key={emp.id}
            type="button"
            onClick={() => onSelect(emp)}
            className={`w-full text-left grid grid-cols-[2fr_1fr_1fr_repeat(3,_0.8fr)_1fr_0.6fr] gap-3 items-center px-4 py-3 rounded-xl border transition-all duration-150 ${
              isSelected
                ? "border-indigo-300 bg-indigo-50 shadow-sm"
                : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"
            }`}
          >
            {/* Employee name + code */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-sm font-semibold">
                {(emp.full_name || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{emp.full_name || "—"}</p>
                <p className="text-xs text-slate-400 font-mono">{emp.employee_code}</p>
              </div>
              {emp.has_anomaly && (
                <AlertTriangle className="h-3.5 w-3.5 text-rose-500 shrink-0" title="Attendance anomaly" />
              )}
            </div>

            {/* Branch / Process */}
            <div className="min-w-0">
              <p className="text-xs text-slate-700 truncate">{emp.branch_name ?? "—"}</p>
              <p className="text-[10px] text-slate-400 truncate">{emp.process_name ?? "—"}</p>
            </div>

            {/* Designation */}
            <p className="text-xs text-slate-600 truncate">{emp.designation_name ?? "—"}</p>

            {/* Present days */}
            <p className="text-sm font-semibold text-slate-800">{emp.present_days}</p>

            {/* LWP */}
            <p className={`text-sm font-semibold ${Number(emp.lwp_days) > 2 ? "text-rose-600" : "text-slate-700"}`}>
              {Number(emp.lwp_days).toFixed(1)}
            </p>

            {/* Late marks */}
            <p className={`text-sm font-semibold ${Number(emp.late_marks) > 3 ? "text-amber-600" : "text-slate-700"}`}>
              {emp.late_marks}
            </p>

            {/* Last salary */}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-800">{INR(emp.last_salary_net)}</p>
              {emp.last_salary_month && (
                <p className="text-[10px] text-slate-400">{emp.last_salary_month}</p>
              )}
            </div>

            {/* Status badge */}
            <Badge className={`text-[10px] capitalize border ${statusCls} hover:${statusCls}`}>
              {statusKey || "—"}
            </Badge>
          </button>
        );
      })}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 px-1">
          <p className="text-xs text-slate-500">{total} employees</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-slate-600 font-medium">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Compile check**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | grep "AttendanceHubTable" | head -5
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/attendance/AttendanceHubTable.tsx
git commit -m "feat(attendance-hub): add paginated employee directory table with anomaly flags"
```

---

## Task 5: Attendance tab — `AttendanceTab.tsx`

**Files:**
- Create: `src/components/attendance/tabs/AttendanceTab.tsx`

**Interfaces:**
- Consumes: `useAttendanceDailyRecords`, `useAttendanceSummary` from `useAttendanceHub.ts`; `AttendanceCalendar` from `@/components/attendance/AttendanceCalendar`
- Produces: `<AttendanceTab employeeId={string} />`

- [ ] **Step 1: Create attendance tab**

Create `src/components/attendance/tabs/AttendanceTab.tsx`:

```tsx
import { useState } from "react";
import { format, startOfMonth, addMonths, subMonths } from "date-fns";
import { Calendar, Table, ChevronLeft, ChevronRight } from "lucide-react";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAttendanceDailyRecords, useAttendanceSummary } from "@/hooks/useAttendanceHub";

const STATUS_COLORS: Record<string, string> = {
  present:        "bg-emerald-100 text-emerald-800",
  half_day:       "bg-amber-100 text-amber-800",
  absent:         "bg-rose-100 text-rose-800",
  missing_punch:  "bg-orange-100 text-orange-800",
  week_off:       "bg-slate-100 text-slate-600",
  holiday:        "bg-blue-100 text-blue-800",
  leave_approved: "bg-purple-100 text-purple-800",
  late:           "bg-yellow-100 text-yellow-800",
};

function fmtTime(t: string | null) {
  if (!t) return "—";
  return t.slice(0, 5);
}

function fmtMins(m: number | null) {
  if (!m) return "—";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${String(min).padStart(2, "0")}m`;
}

interface Props { employeeId: string; }

export function AttendanceTab({ employeeId }: Props) {
  const [viewMode, setViewMode] = useState<"calendar" | "table">("calendar");
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfMonth(new Date()));

  const monthStr = format(currentMonth, "yyyy-MM");
  const monthStart = format(currentMonth, "yyyy-MM-01");
  const monthEnd = format(
    new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0),
    "yyyy-MM-dd"
  );
  const monthLabel = format(currentMonth, "MMMM yyyy");

  const { data: summary, isLoading: summaryLoading } = useAttendanceSummary(employeeId, monthStr);
  const { data: dailyRecords = [], isLoading: dailyLoading } = useAttendanceDailyRecords(employeeId, monthStart, monthEnd);

  return (
    <div className="space-y-4">
      {/* Month navigator + view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentMonth(m => subMonths(m, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4 text-slate-600" />
          </button>
          <span className="text-sm font-semibold text-slate-800 min-w-[130px] text-center">{monthLabel}</span>
          <button
            type="button"
            onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            disabled={format(addMonths(currentMonth, 1), "yyyy-MM") > format(new Date(), "yyyy-MM")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            className="text-xs text-indigo-600 hover:underline"
          >
            Today
          </button>
        </div>

        {/* View toggle */}
        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("calendar")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "calendar" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "table" ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"}`}
          >
            <Table className="h-3.5 w-3.5" />
            Tabular
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {summaryLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-16 flex-1 rounded-xl" />)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {[
            { label: "Present", value: summary.presentDays, cls: "bg-emerald-50 text-emerald-800 border-emerald-100" },
            { label: "Half Day", value: summary.halfDays, cls: "bg-amber-50 text-amber-800 border-amber-100" },
            { label: "Absent", value: summary.absentDays, cls: "bg-rose-50 text-rose-800 border-rose-100" },
            { label: "LWP", value: Number(summary.totalLwp).toFixed(1), cls: "bg-orange-50 text-orange-800 border-orange-100" },
            { label: "Leave", value: summary.leaveDays, cls: "bg-purple-50 text-purple-800 border-purple-100" },
            { label: "Holiday", value: summary.holidayDays, cls: "bg-blue-50 text-blue-800 border-blue-100" },
            { label: "Late Marks", value: summary.lateMarks, cls: "bg-yellow-50 text-yellow-800 border-yellow-100" },
          ].map(item => (
            <div key={item.label} className={`rounded-xl border p-3 text-center ${item.cls}`}>
              <p className="text-lg font-bold">{item.value}</p>
              <p className="text-[10px] font-medium mt-0.5 opacity-80">{item.label}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Calendar or tabular view */}
      {viewMode === "calendar" ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <AttendanceCalendar
            employeeId={employeeId}
            initialMonth={currentMonth.getMonth()}
            initialYear={currentMonth.getFullYear()}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {dailyLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
            </div>
          ) : dailyRecords.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">No attendance records for {monthLabel}.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Day</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Login</th>
                  <th className="px-4 py-3 text-left">Logout</th>
                  <th className="px-4 py-3 text-left">Hours</th>
                  <th className="px-4 py-3 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {dailyRecords.map(r => {
                  const d = new Date(r.date);
                  const dayName = d.toLocaleString("en-IN", { weekday: "short" });
                  const statusKey = r.status ?? "unknown";
                  const statusCls = STATUS_COLORS[statusKey] ?? "bg-slate-100 text-slate-600";
                  return (
                    <tr key={r.date} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.date?.slice(0, 10)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{dayName}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusCls}`}>
                          {statusKey.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{fmtTime(r.clock_in)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{fmtTime(r.clock_out)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{fmtMins(r.raw_minutes)}</td>
                      <td className="px-4 py-2.5 text-[10px] text-slate-400 capitalize">{r.source ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Compile check**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | grep "AttendanceTab" | head -5
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/attendance/tabs/AttendanceTab.tsx
git commit -m "feat(attendance-hub): attendance tab with calendar/tabular toggle and monthly summary strip"
```

---

## Task 6: Salary tab — `SalaryTab.tsx`

**Files:**
- Create: `src/components/attendance/tabs/SalaryTab.tsx`

**Interfaces:**
- Consumes: `useRunningSalary`, `usePayslipHistory`, `usePayslipDetail` from `useAttendanceHub.ts`
- Produces: `<SalaryTab employeeId={string} />`

- [ ] **Step 1: Create salary tab**

Create `src/components/attendance/tabs/SalaryTab.tsx`:

```tsx
import { useState } from "react";
import { ChevronDown, ChevronUp, Download, Loader } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRunningSalary, usePayslipHistory, usePayslipDetail } from "@/hooks/useAttendanceHub";
import type { PayslipSummary } from "@/hooks/useAttendanceHub";

const INR = (v: number | null | undefined) =>
  `₹${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function RunningMonthCard({ employeeId }: { employeeId: string }) {
  const { data: rs, isLoading } = useRunningSalary(employeeId, currentMonth);

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!rs) return <div className="rounded-2xl border border-slate-200 p-6 text-center text-sm text-slate-500">No running salary data for current month.</div>;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-white via-white to-[#e8f2fc] p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Running Month Earned</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{INR(rs.earned_salary_till_date)}</p>
          <p className="text-xs text-slate-500 mt-0.5">Net (after deductions): <span className="font-semibold text-slate-800">{INR(rs.earned_net_till_date)}</span></p>
        </div>
        <div className="rounded-xl bg-[#e8f2fc] px-3 py-1.5 text-xs font-semibold text-[#1B6AB5]">
          {currentMonth}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center border-t border-indigo-100 pt-4">
        {[
          { label: "Payable Days", value: rs.earned_payable_days },
          { label: "Eligible Weekoffs", value: rs.eligible_weekoff_till_date },
          { label: "Eligible Holidays", value: rs.eligible_holiday_till_date },
        ].map(item => (
          <div key={item.label}>
            <p className="text-base font-bold text-slate-800">{item.value}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 text-center border-t border-indigo-100 pt-3 mt-3">
        {[
          { label: "PF (Employee)", value: INR(rs.pf_employee) },
          { label: "ESIC", value: INR(rs.esic_employee) },
          { label: "Prof. Tax", value: INR(rs.professional_tax) },
        ].map(item => (
          <div key={item.label}>
            <p className="text-sm font-semibold text-slate-700">{item.value}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PayslipRow({ line, employeeId }: { line: PayslipSummary; employeeId: string }) {
  const [open, setOpen] = useState(false);
  const { data: detail, isLoading } = usePayslipDetail(open ? line.run_id : null, employeeId);

  const [yr, mo] = (line.run_month ?? "").split("-").map(Number);
  const monthLabel = MONTH_NAMES[mo] ? `${MONTH_NAMES[mo]} ${yr}` : line.run_month;

  const isPaid = line.run_status === "disbursed" || line.paid_at;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Summary row */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <p className="text-sm font-semibold text-slate-800">{monthLabel}</p>
            {isPaid && line.paid_at && (
              <p className="text-[10px] text-slate-400">Paid {line.paid_at.slice(0, 10)}</p>
            )}
          </div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isPaid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
            {isPaid ? "Paid" : line.run_status ?? "—"}
          </span>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Gross</p>
            <p className="text-sm font-semibold text-slate-800">{INR(line.gross_salary)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Deductions</p>
            <p className="text-sm font-semibold text-rose-600">{INR(line.total_deductions)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-slate-400">Net Pay</p>
            <p className="text-sm font-bold text-slate-900">{INR(line.net_salary)}</p>
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />}
        </div>
      </button>

      {/* Expanded breakdown */}
      {open && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-7 rounded-lg" />)}
            </div>
          ) : detail ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Attendance summary */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Attendance for Pay Month</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Paid Days", value: detail.paid_working_days },
                    { label: "Weekoffs", value: detail.eligible_weekoff_days },
                    { label: "Holidays", value: detail.eligible_holiday_days },
                    { label: "Payable", value: detail.final_payable_days },
                    { label: "Calendar Days", value: detail.active_calendar_days },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-2">
                      <p className="text-sm font-bold text-slate-800">{item.value ?? "—"}</p>
                      <p className="text-[9px] text-slate-400">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Earnings */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Earnings</p>
                <div className="space-y-1">
                  {(detail.components ?? [])
                    .filter(c => c.component_type === "earning" && Number(c.amount) > 0)
                    .map(c => (
                      <div key={c.component_code} className="flex justify-between text-xs">
                        <span className="text-slate-600">{c.component_name}</span>
                        <span className="font-medium text-slate-800">{INR(Number(c.amount))}</span>
                      </div>
                    ))}
                  {(detail.components ?? []).filter(c => c.component_type === "earning" && Number(c.amount) > 0).length === 0 && (
                    <>
                      {detail.basic > 0    && <div className="flex justify-between text-xs"><span className="text-slate-600">Basic Salary</span><span className="font-medium text-slate-800">{INR(detail.basic)}</span></div>}
                      {detail.hra > 0      && <div className="flex justify-between text-xs"><span className="text-slate-600">HRA</span><span className="font-medium text-slate-800">{INR(detail.hra)}</span></div>}
                      {detail.special_allowance > 0 && <div className="flex justify-between text-xs"><span className="text-slate-600">Special Allowance</span><span className="font-medium text-slate-800">{INR(detail.special_allowance)}</span></div>}
                    </>
                  )}
                  <div className="flex justify-between text-xs font-semibold border-t border-slate-200 pt-1 mt-1">
                    <span className="text-slate-700">Gross Salary</span>
                    <span className="text-slate-900">{INR(detail.gross_salary)}</span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div className="sm:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Deductions</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "PF (Employee)", value: detail.pf_employee },
                    { label: "ESIC", value: detail.esic_employee },
                    { label: "Prof. Tax", value: detail.professional_tax },
                    { label: "TDS", value: detail.tds },
                    { label: "LWP Deduction", value: detail.lwp_deduction },
                    { label: "Advance Recovery", value: detail.advance_recovery },
                  ]
                    .filter(d => d.value != null)
                    .map(d => (
                      <div key={d.label} className="rounded-lg border border-slate-200 bg-white p-2.5">
                        <p className="text-sm font-bold text-rose-600">{INR(d.value)}</p>
                        <p className="text-[9px] text-slate-500 mt-0.5">{d.label}</p>
                      </div>
                    ))}
                </div>
                <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-2 mt-3 px-1">
                  <span className="text-slate-700">Net Pay</span>
                  <span className="text-slate-950">{INR(detail.net_salary)}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center">Could not load payslip details.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface Props { employeeId: string; }

export function SalaryTab({ employeeId }: Props) {
  const { data: history = [], isLoading } = usePayslipHistory(employeeId);

  return (
    <div className="space-y-4">
      {/* Running month */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Running Month</p>
        <RunningMonthCard employeeId={employeeId} />
      </div>

      {/* Past payslips */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Past Payslips — click to expand full breakdown</p>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
            No payslip history available.
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(line => (
              <PayslipRow key={line.run_id} line={line} employeeId={employeeId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Compile check**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | grep "SalaryTab" | head -5
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/attendance/tabs/SalaryTab.tsx
git commit -m "feat(attendance-hub): salary tab with running month breakdown and expandable past payslip components"
```

---

## Task 7: Regularizations + Leave tabs

**Files:**
- Create: `src/components/attendance/tabs/RegularizationsTab.tsx`
- Create: `src/components/attendance/tabs/LeaveTab.tsx`

**Interfaces:**
- Consumes: `useRegularizationHistory`, `useLeaveBalance` from `useAttendanceHub.ts`
- Produces: `<RegularizationsTab employeeId={string} />` and `<LeaveTab employeeId={string} />`

- [ ] **Step 1: Create RegularizationsTab**

Create `src/components/attendance/tabs/RegularizationsTab.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { useRegularizationHistory } from "@/hooks/useAttendanceHub";

const STATUS_COLORS: Record<string, string> = {
  pending:          "bg-amber-50 text-amber-700",
  manager_approved: "bg-blue-50 text-blue-700",
  approved:         "bg-emerald-50 text-emerald-700",
  rejected:         "bg-rose-50 text-rose-700",
};

interface Props { employeeId: string; }

export function RegularizationsTab({ employeeId }: Props) {
  const { data: records = [], isLoading } = useRegularizationHistory(employeeId);

  if (isLoading) return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
    </div>
  );

  if (!records.length) return (
    <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
      No regularization requests found.
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <th className="px-4 py-3 text-left">Date</th>
            <th className="px-4 py-3 text-left">Type</th>
            <th className="px-4 py-3 text-left">From Status</th>
            <th className="px-4 py-3 text-left">Requested</th>
            <th className="px-4 py-3 text-left">Submitted</th>
            <th className="px-4 py-3 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map(r => {
            const statusCls = STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-600";
            return (
              <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.session_date?.slice(0, 10)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600 capitalize">{(r.request_category ?? "—").replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500 capitalize">{(r.old_status ?? "—").replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500 capitalize">{(r.requested_status ?? "—").replace(/_/g, " ")}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{r.submitted_at?.slice(0, 10)}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusCls}`}>
                    {(r.status ?? "—").replace(/_/g, " ")}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create LeaveTab**

Create `src/components/attendance/tabs/LeaveTab.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { useLeaveBalance } from "@/hooks/useAttendanceHub";

interface Props { employeeId: string; }

export function LeaveTab({ employeeId }: Props) {
  const year = new Date().getFullYear();
  const { data: balances = [], isLoading } = useLeaveBalance(employeeId, year);

  if (isLoading) return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
    </div>
  );

  if (!balances.length) return (
    <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
      No leave balance data found for {year}.
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">Leave Balances — {year}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {balances.map(b => {
          const remaining = Number(b.allocated_days) + Number(b.adjusted_days) - Number(b.used_days);
          const pct = b.allocated_days > 0 ? Math.min(100, (remaining / b.allocated_days) * 100) : 0;
          return (
            <div key={b.leave_type_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 truncate">{b.leave_type_name}</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{Math.max(0, remaining).toFixed(1)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">remaining of {b.allocated_days} allocated</p>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-slate-400">Used: {Number(b.used_days).toFixed(1)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Compile check**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | grep -E "RegularizationsTab|LeaveTab" | head -5
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/attendance/tabs/RegularizationsTab.tsx \
        src/components/attendance/tabs/LeaveTab.tsx
git commit -m "feat(attendance-hub): regularizations and leave balance tabs"
```

---

## Task 8: Drawer — `AttendanceHubDrawer.tsx`

**Files:**
- Create: `src/components/attendance/AttendanceHubDrawer.tsx`

**Interfaces:**
- Consumes: `HubEmployee` from `useAttendanceHub.ts`; `AttendanceTab`, `SalaryTab`, `RegularizationsTab`, `LeaveTab`
- Produces: `<AttendanceHubDrawer employee={HubEmployee | null} onClose={() => void} />`

Uses shadcn `Sheet` component (`@/components/ui/sheet`).

- [ ] **Step 1: Create the drawer**

Create `src/components/attendance/AttendanceHubDrawer.tsx`:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { User, Calendar, Wallet, ClipboardList, TreePalm } from "lucide-react";
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
                  { label: "Present (MTD)", value: employee.present_days },
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
```

- [ ] **Step 2: Compile check**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | grep "AttendanceHubDrawer" | head -5
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/attendance/AttendanceHubDrawer.tsx
git commit -m "feat(attendance-hub): drawer shell with 4 tabs — attendance, salary, regularizations, leave"
```

---

## Task 9: Main page — replace `AdminAttendanceView.tsx`

**Files:**
- Replace: `src/pages/AdminAttendanceView.tsx`

**Interfaces:**
- Consumes: `AttendanceHubFilters`, `AttendanceHubTable`, `AttendanceHubDrawer`, `useHubEmployees` from hooks
- Produces: final page at `/hr/attendance-lookup`

- [ ] **Step 1: Replace the page**

Overwrite `src/pages/AdminAttendanceView.tsx` with:

```tsx
import { useState, useCallback } from "react";
import { Shield } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { AttendanceHubFilters } from "@/components/attendance/AttendanceHubFilters";
import { AttendanceHubTable } from "@/components/attendance/AttendanceHubTable";
import { AttendanceHubDrawer } from "@/components/attendance/AttendanceHubDrawer";
import { useHubEmployees } from "@/hooks/useAttendanceHub";
import type { HubEmployee, HubFilters } from "@/hooks/useAttendanceHub";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const ALLOWED_ROLES = ["super_admin", "admin", "hr", "payroll_head", "payroll_admin", "wfm"] as const;

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

  const { data: result, isLoading } = useHubEmployees(filters, month);
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

  if (!canAccess) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center">
          <div className="rounded-full bg-rose-50 p-4">
            <Shield className="h-8 w-8 text-rose-500" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Access Restricted</h2>
          <p className="text-sm text-slate-500 max-w-sm">
            You need Super Admin, HR, Payroll Head, WFM, or Payroll Admin role to access People Attendance & Earnings.
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
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight text-slate-950">
            People Attendance & Earnings
          </h1>
          <p className="text-sm text-slate-500">
            Full attendance and salary intelligence for all employees. Click any row to view details.
          </p>
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
          onClose={() => setSelectedEmployee(null)}
        />
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Full TypeScript compile**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit 2>&1 | head -30
```
Expected: no output (zero errors).

- [ ] **Step 3: Frontend build**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest && npm run build 2>&1 | tail -10
```
Expected: `✓ built in` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminAttendanceView.tsx
git commit -m "feat(attendance-hub): complete People Attendance & Earnings Hub — directory table, drawer, 4 tabs"
```

---

## Task 10: Deploy to production

**Files:** None (deployment only)

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main 2>&1
```

- [ ] **Step 2: SSH deploy — build + restart**

```bash
cd /c/Users/ADMIN/Desktop/HRMS2-latest/backend && node -e "
const { Client } = require('ssh2');
function run(conn, cmd, timeout) {
  return new Promise((res, rej) => {
    let out='', err='';
    const t = timeout ? setTimeout(() => rej(new Error('Timeout: '+cmd)), timeout) : null;
    conn.exec(cmd, (e, stream) => {
      if (e) return rej(e);
      stream.on('data', d => { process.stdout.write(d.toString()); out+=d; });
      stream.stderr.on('data', d => process.stderr.write(d.toString()));
      stream.on('close', code => { if(t)clearTimeout(t); res({code,out}); });
    });
  });
}
async function main() {
  const conn = new Client();
  await new Promise((res,rej) => conn.on('ready',res).on('error',rej)
    .connect({host:'192.168.11.225',port:22,username:'masadmin',password:'Support#123',readyTimeout:15000}));
  console.log('=== CONNECTED ===');
  await run(conn, 'cd /var/www/HRMS2 && git pull origin main 2>&1');
  await run(conn, 'cd /var/www/HRMS2/backend && npm install --prefer-offline 2>&1 && npm run build 2>&1', 240000);
  await run(conn, 'pm2 restart hrms2-backend --update-env 2>&1');
  await run(conn, 'sleep 3 && pm2 logs hrms2-backend --lines 5 --nostream 2>&1');
  conn.end();
  console.log('=== DONE ===');
}
main().catch(e => { console.error(e.message); process.exit(1); });
" 2>&1
```

Expected: `=== DONE ===` with `hrms2-backend` status `online`.

- [ ] **Step 3: Verify in browser**

Open `https://mcnhrms.teammas.in/hr/attendance-lookup` — should show the new directory table with search + filter bar.

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Paginated employee directory table with columns
- ✅ Fast search box (debounced, `/` shortcut)
- ✅ Branch / Process / Designation / Status filters
- ✅ Anomaly flag column and filter (LWP > 2, missing punches)
- ✅ Click row → drawer opens
- ✅ Employee header with quick stats strip
- ✅ Attendance tab: calendar view (existing component)
- ✅ Attendance tab: tabular view with date/day/status/login/logout/hours/source
- ✅ Attendance tab: month summary strip with 7 metrics
- ✅ Attendance tab: month navigation, past months supported
- ✅ Salary tab: running month card with full breakdown
- ✅ Salary tab: past payslips list with expandable full component breakdown
- ✅ Regularizations tab: full history table
- ✅ Leave tab: balance by type with progress bar
- ✅ Salary release status in directory table (last_salary_net + last_salary_month)
- ✅ Role gate: same roles as current page
- ✅ No new DB tables, read-only
- ✅ IST date conversion in all attendance queries

**Type consistency:** All types defined in `useAttendanceHub.ts` Task 2 and consumed by later tasks use identical names. `PayslipSummary` uses `run_id`, `run_month`, `gross_salary`, `net_salary` — consistent throughout `SalaryTab.tsx`.

**No placeholders:** All steps have exact code. No "implement later" or "TBD" entries.
