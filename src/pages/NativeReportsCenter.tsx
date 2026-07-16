import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck2,
  Filter,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundSearch,
  X,
} from "lucide-react";
import { hrmsApi } from "../lib/hrmsApi";
import { HrmsBentoTile, HrmsModernShell } from "@/components/ui/hrms-modern";

interface FilterDef {
  key: string;
  label: string;
  type: "date" | "month" | "year" | "text" | "select" | "number";
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

interface ReportDef {
  code: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  filters: FilterDef[];
  accuracyTier: "controlled" | "standard";
}

interface ReportMeta {
  reportCode?: string;
  rowCount?: number;
  generatedAt?: string;
  accuracyStatus?: string;
  sourceTables?: string[];
  warnings?: string[];
  assurance?: string;
}

interface ReportResponse {
  success?: boolean;
  code?: string;
  data: Record<string, unknown>[];
  meta?: ReportMeta;
}

interface HealthResponse {
  success: boolean;
  data: {
    status: "healthy" | "attention_required";
    checkedAt: string;
    tables: Array<{ table_name: string; estimated_rows: number; last_updated: string | null }>;
    checks: Array<{ check_name: string; issue_count: number }>;
  };
}

const DATE_FROM: FilterDef = { key: "from", label: "From Date", type: "date" };
const DATE_TO: FilterDef = { key: "to", label: "To Date", type: "date" };
const MONTH: FilterDef = { key: "month", label: "Month", type: "month" };
const YEAR: FilterDef = { key: "year", label: "Year", type: "year", placeholder: String(new Date().getFullYear()) };
const BRANCH: FilterDef = { key: "branchId", label: "Branch", type: "text", placeholder: "All branches" };
const PROCESS: FilterDef = { key: "processId", label: "Process", type: "text", placeholder: "All processes" };
const DEPARTMENT: FilterDef = { key: "departmentId", label: "Department", type: "text", placeholder: "All departments" };
const COST_CENTRE: FilterDef = { key: "costCentreId", label: "Cost Centre", type: "text", placeholder: "All cost centres" };
const STATUS: FilterDef = {
  key: "status",
  label: "Status",
  type: "select",
  options: [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "active", label: "Active" },
    { value: "closed", label: "Closed" },
  ],
};

const CONTROLLED_REPORTS: ReportDef[] = [
  {
    code: "attendance-daily",
    name: "Daily Attendance Report",
    category: "Attendance",
    subcategory: "Daily",
    description: "Punch-in/out, total login hours, productive minutes, attendance source and reconciliation status.",
    filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "daily-hc-shift",
    name: "Daily Headcount by Shift",
    category: "Attendance",
    subcategory: "Daily",
    description: "Day-wise rostered headcount by shift. Missing rosters are shown as action-required gaps, not Unassigned.",
    filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "shift-adherence-detail",
    name: "Shift Adherence Detail",
    category: "Attendance",
    subcategory: "Daily",
    description: "Roster shift, punch-in/out, login hours and measurable adherence status for every employee-day.",
    filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "attendance-summary",
    name: "Monthly Attendance Summary",
    category: "Attendance",
    subcategory: "Monthly",
    description: "Employee-wise day grid in the validated reference format with attendance codes, salary days and totals.",
    filters: [MONTH, BRANCH, PROCESS, DEPARTMENT],
    accuracyTier: "controlled",
  },
  {
    code: "late-arrival-summary",
    name: "Late Arrival Summary",
    category: "Attendance",
    subcategory: "Monthly",
    description: "Late instances with shift start, first punch, minutes late and severity.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "overtime-summary",
    name: "Overtime Summary",
    category: "Attendance",
    subcategory: "Monthly",
    description: "Excess login time over scheduled minutes with punch evidence. OT payment remains policy-controlled.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "biometric-reconciliation",
    name: "Biometric Reconciliation",
    category: "Attendance",
    subcategory: "Exceptions",
    description: "Processed attendance versus biometric punch and login-hour evidence, including mismatch classification.",
    filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "regularization-summary",
    name: "Regularization Summary",
    category: "Attendance",
    subcategory: "Exceptions",
    description: "Regularizations with before/after status, punch corrections, payroll impact and approval trail.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "attendance-dispute-summary",
    name: "Attendance Dispute Summary",
    category: "Attendance",
    subcategory: "Exceptions",
    description: "Formal dispute cases only, with classification, payroll impact, escalation and review outcome.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "habitual-absentee-list",
    name: "Habitual Absentee / Late List",
    category: "Attendance",
    subcategory: "Exceptions",
    description: "Employee-level absenteeism, missing punch, LWP and late-pattern analysis.",
    filters: [MONTH, BRANCH, PROCESS, { key: "thresholdPct", label: "Absence Threshold %", type: "number", placeholder: "25" }],
    accuracyTier: "controlled",
  },
  {
    code: "daily-shrinkage-report",
    name: "Daily Shrinkage Report",
    category: "Attendance",
    subcategory: "BPO Metrics",
    description: "Roster-based planned, unplanned and overall shrinkage with an organisation-level overall row.",
    filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "monthly-shrinkage-trend",
    name: "Monthly Shrinkage Trend",
    category: "Attendance",
    subcategory: "BPO Metrics",
    description: "Monthly shrinkage using rostered employee-date slots. Months without roster data are not fabricated.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "punch-raw-export",
    name: "Punch Raw Data Export",
    category: "Attendance",
    subcategory: "BPO Metrics",
    description: "Punch evidence with process, first/last punch and total punching hours in HH:MM:SS.",
    filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "payroll-register",
    name: "Salary Register",
    category: "Payroll",
    subcategory: "Monthly Processing",
    description: "Canonical employee-month salary register with earnings, statutory deductions, recoveries and control status.",
    filters: [MONTH, BRANCH, PROCESS, DEPARTMENT, COST_CENTRE],
    accuracyTier: "controlled",
  },
  {
    code: "payroll-variance",
    name: "Payroll Variance Report",
    category: "Payroll",
    subcategory: "Monthly Processing",
    description: "Current versus previous canonical payroll line, amount and percentage variance with high-risk flags.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "payslip-status",
    name: "Payslip Release Status",
    category: "Payroll",
    subcategory: "Monthly Processing",
    description: "Employee-wise payslip generated/released status against the selected canonical payroll run.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "ytd-salary-summary",
    name: "YTD Salary Summary",
    category: "Payroll",
    subcategory: "Salary Analysis",
    description: "Financial-year earnings and deductions without double-counting repeat payroll runs.",
    filters: [{ key: "financialYear", label: "Financial Year", type: "text", placeholder: "2026-27" }, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "cost-centre-salary-summary",
    name: "Cost Centre Salary Summary",
    category: "Payroll",
    subcategory: "Salary Analysis",
    description: "Cost-centre headcount and salary components from one canonical employee-month line.",
    filters: [MONTH, COST_CENTRE],
    accuracyTier: "controlled",
  },
  {
    code: "process-lob-salary-cost",
    name: "Process / LOB Salary Cost",
    category: "Payroll",
    subcategory: "Salary Analysis",
    description: "Process/LOB earnings, deductions, employer contributions and total employer cost.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "grade-salary-distribution",
    name: "Grade-wise Salary Distribution",
    category: "Payroll",
    subcategory: "Salary Analysis",
    description: "Selected-month grade headcount and salary distribution without all-month salary joins.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "salary-advance-register",
    name: "Salary Advance Register",
    category: "Payroll",
    subcategory: "Advances & Recoveries",
    description: "Approved and rejected salary advances with schema-compatible recovery and outstanding values.",
    filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
  {
    code: "lwp-deduction-register",
    name: "LWP Deduction Register",
    category: "Payroll",
    subcategory: "Advances & Recoveries",
    description: "Attendance LWP versus payroll LWP and deduction amount, with explicit variance status.",
    filters: [MONTH, BRANCH, PROCESS],
    accuracyTier: "controlled",
  },
];

const STANDARD_REPORTS: ReportDef[] = [
  { code: "employee-master", name: "Employee Master Export", category: "HR & Workforce", subcategory: "Master", description: "Employee master with organisation mapping.", filters: [BRANCH, PROCESS, DEPARTMENT], accuracyTier: "standard" },
  { code: "headcount", name: "Active Headcount Summary", category: "HR & Workforce", subcategory: "Headcount", description: "Active headcount by branch, department and process.", filters: [BRANCH, PROCESS, DEPARTMENT], accuracyTier: "standard" },
  { code: "employee-movement", name: "New Joiners & Exits", category: "HR & Workforce", subcategory: "Lifecycle", description: "Joining and exit movement for the selected period.", filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "manager-mapping", name: "Manager Mapping Report", category: "HR & Workforce", subcategory: "Governance", description: "Missing or inconsistent reporting-manager mappings.", filters: [BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "leave-balance", name: "Leave Balance Report", category: "Leave", subcategory: "Balance", description: "Allocated, used, adjusted and remaining leave.", filters: [YEAR, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "leave-utilization", name: "Leave Utilization Report", category: "Leave", subcategory: "Utilization", description: "Leave applications and approved utilization.", filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "leave-lwp-reconciliation", name: "Leave vs LWP Reconciliation", category: "Leave", subcategory: "Reconciliation", description: "Attendance and payroll LWP comparison.", filters: [MONTH, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "statutory-missing", name: "Missing Statutory Details", category: "Compliance", subcategory: "PF / ESIC", description: "Missing PAN, UAN, PF and ESIC details.", filters: [BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "pf-ecr-export", name: "PF ECR Export", category: "Compliance", subcategory: "PF / EPF", description: "PF ECR source data for the selected payroll month.", filters: [MONTH, BRANCH], accuracyTier: "standard" },
  { code: "esic-monthly-summary", name: "ESIC Monthly Summary", category: "Compliance", subcategory: "ESIC", description: "Employee and employer ESIC totals.", filters: [DATE_FROM, DATE_TO], accuracyTier: "standard" },
  { code: "ats-pipeline-summary", name: "ATS Pipeline Summary", category: "Recruitment & ATS", subcategory: "Pipeline", description: "Candidate count and drop-off by hiring stage.", filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "candidate-source-analysis", name: "Candidate Source Analysis", category: "Recruitment & ATS", subcategory: "Source", description: "Candidate source, offer and joining conversion.", filters: [DATE_FROM, DATE_TO, BRANCH], accuracyTier: "standard" },
  { code: "bgv-status-report", name: "BGV Status Report", category: "Recruitment & ATS", subcategory: "BGV", description: "BGV status, ageing and completion tracking.", filters: [DATE_FROM, DATE_TO, BRANCH, STATUS], accuracyTier: "standard" },
  { code: "monthly-attrition-summary", name: "Monthly Attrition Summary", category: "Exit & Attrition", subcategory: "Attrition", description: "Monthly attrition by branch and process.", filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "ff-settlement-register", name: "F&F Settlement Register", category: "Exit & Attrition", subcategory: "Settlement", description: "Full-and-final settlement status and ageing.", filters: [DATE_FROM, DATE_TO, BRANCH, STATUS], accuracyTier: "standard" },
  { code: "kpi-score-summary", name: "KPI Score Summary", category: "Performance & KPI", subcategory: "KPI", description: "Employee KPI scores by month and process.", filters: [MONTH, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "below-target-kpi", name: "Below-Target KPI Report", category: "Performance & KPI", subcategory: "KPI", description: "Employees below the configured KPI threshold.", filters: [MONTH, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "roster-adherence", name: "Roster vs Actual Adherence", category: "WFM & Operations", subcategory: "Roster", description: "Roster assignment versus actual attendance.", filters: [MONTH, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "workforce-mandate-vs-actual", name: "Workforce Mandate vs Actual", category: "WFM & Operations", subcategory: "Capacity", description: "Client mandate versus actual workforce availability.", filters: [MONTH, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "asset-inventory-report", name: "Asset Inventory Report", category: "Assets & Documents", subcategory: "Assets", description: "Asset inventory, ownership and status.", filters: [BRANCH, STATUS], accuracyTier: "standard" },
  { code: "employee-document-compliance", name: "Employee Document Compliance", category: "Assets & Documents", subcategory: "Documents", description: "Employee document completeness and exceptions.", filters: [BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "integration-run-history", name: "Integration Run History", category: "Integration & Audit", subcategory: "Integration", description: "Integration execution status, counts and failures.", filters: [DATE_FROM, DATE_TO, STATUS], accuracyTier: "standard" },
  { code: "sensitive-action-audit", name: "Sensitive Action Audit", category: "Integration & Audit", subcategory: "Audit", description: "Sensitive changes with actor, reason and before/after values.", filters: [DATE_FROM, DATE_TO], accuracyTier: "standard" },
  { code: "helpdesk-ticket-summary", name: "Helpdesk Ticket Summary", category: "Helpdesk & Grievance", subcategory: "Helpdesk", description: "Ticket volume, status and ageing.", filters: [DATE_FROM, DATE_TO, BRANCH, STATUS], accuracyTier: "standard" },
  { code: "grievance-tat-report", name: "Grievance TAT Report", category: "Helpdesk & Grievance", subcategory: "Grievance", description: "Grievance turnaround time and breaches.", filters: [DATE_FROM, DATE_TO, STATUS], accuracyTier: "standard" },
  { code: "productivity-individual-scorecard", name: "Individual Productivity Scorecard", category: "Productivity", subcategory: "Individual", description: "Employee productivity and efficiency scorecard.", filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS], accuracyTier: "standard" },
  { code: "productivity-process-summary", name: "Process / LOB Productivity Summary", category: "Productivity", subcategory: "Process", description: "Process-level productivity roll-up.", filters: [DATE_FROM, DATE_TO, BRANCH, PROCESS, COST_CENTRE], accuracyTier: "standard" },
];

const CATALOG = [...CONTROLLED_REPORTS, ...STANDARD_REPORTS];

const defaultMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);

function normalizeCell(value: unknown): string | number {
  if (value == null) return "";
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function exportRows(rows: Record<string, unknown>[], filename: string) {
  const XLSX = await import("xlsx");
  const normalized = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCell(value)])));
  const sheet = XLSX.utils.json_to_sheet(normalized);
  const widths = Object.keys(normalized[0] ?? {}).map((key) => ({ wch: Math.min(40, Math.max(12, key.length + 2)) }));
  sheet["!cols"] = widths;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  XLSX.writeFile(workbook, filename);
}

function initialFilters(report: ReportDef): Record<string, string> {
  const values: Record<string, string> = {};
  for (const filter of report.filters) {
    if (filter.type === "month") values[filter.key] = defaultMonth;
    if (filter.key === "from") values[filter.key] = today;
    if (filter.key === "to") values[filter.key] = today;
    if (filter.type === "year") values[filter.key] = String(new Date().getFullYear());
  }
  return values;
}

function buildUrl(code: string, filters: Record<string, string>, limit: number) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  params.set("limit", String(limit));
  return `/api/reports/suite/${code}?${params.toString()}`;
}

function displayValue(value: unknown) {
  if (value == null || value === "") return <span className="text-slate-300">—</span>;
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return String(value);
}

export default function NativeReportsCenter() {
  const [selectedReport, setSelectedReport] = useState<ReportDef>(CONTROLLED_REPORTS[0]);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => initialFilters(CONTROLLED_REPORTS[0]));
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [runError, setRunError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [showException, setShowException] = useState(false);
  const [exceptionForm, setExceptionForm] = useState({ employeeCode: "", date: today, newStatus: "present", reason: "" });
  const [exceptionEmployee, setExceptionEmployee] = useState<Record<string, unknown> | null>(null);
  const [exceptionLoading, setExceptionLoading] = useState(false);
  const [exceptionMessage, setExceptionMessage] = useState("");

  const { data: branchResponse } = useQuery({
    queryKey: ["report-hub-branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
    staleTime: 10 * 60_000,
  });
  const { data: processResponse } = useQuery({
    queryKey: ["report-hub-processes"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; process_name: string }> }>("/api/processes"),
    staleTime: 10 * 60_000,
  });
  const { data: departmentResponse } = useQuery({
    queryKey: ["report-hub-departments"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; dept_name: string }> }>("/api/org/departments"),
    staleTime: 10 * 60_000,
  });
  const { data: costCentreResponse } = useQuery({
    queryKey: ["report-hub-cost-centres"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; cost_centre_name: string }> }>("/api/org/cost-centres"),
    staleTime: 10 * 60_000,
  });
  const healthQuery = useQuery({
    queryKey: ["report-hub-health"],
    queryFn: () => hrmsApi.get<HealthResponse>("/api/reports/suite/health"),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const branches = branchResponse?.data ?? [];
  const processes = processResponse?.data ?? [];
  const departments = departmentResponse?.data ?? [];
  const costCentres = costCentreResponse?.data ?? [];

  const categories = useMemo(() => ["All", ...Array.from(new Set(CATALOG.map((report) => report.category)))], []);
  const filteredReports = useMemo(() => CATALOG.filter((report) => {
    const matchesCategory = category === "All" || report.category === category;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${report.name} ${report.category} ${report.subcategory} ${report.description}`.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  }), [category, search]);

  const columns = useMemo(() => rows.length ? Object.keys(rows[0]) : [], [rows]);
  const controlledCount = CONTROLLED_REPORTS.length;
  const healthChecks = healthQuery.data?.data.checks ?? [];
  const openHealthIssues = healthChecks.reduce((sum, check) => sum + Number(check.issue_count ?? 0), 0);
  const isPlaceholder = rows.length === 1 && rows[0]?.report_status === "PENDING_DATA_BUILDER";

  function selectReport(report: ReportDef) {
    setSelectedReport(report);
    setFilterValues(initialFilters(report));
    setRows([]);
    setMeta(null);
    setRunError("");
  }

  function resolveFilter(filter: FilterDef): FilterDef {
    if (filter.key === "branchId" && branches.length) return { ...filter, type: "select", options: branches.map((item) => ({ value: item.id, label: item.branch_name })) };
    if (filter.key === "processId" && processes.length) return { ...filter, type: "select", options: processes.map((item) => ({ value: item.id, label: item.process_name })) };
    if (filter.key === "departmentId" && departments.length) return { ...filter, type: "select", options: departments.map((item) => ({ value: item.id, label: item.dept_name })) };
    if (filter.key === "costCentreId" && costCentres.length) return { ...filter, type: "select", options: costCentres.map((item) => ({ value: item.id, label: item.cost_centre_name })) };
    return filter;
  }

  async function runReport() {
    setRunning(true);
    setRunError("");
    setRows([]);
    setMeta(null);
    try {
      const response = await hrmsApi.get<ReportResponse>(buildUrl(selectedReport.code, filterValues, 5000));
      setRows(response.data ?? []);
      setMeta(response.meta ?? null);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Report failed");
    } finally {
      setRunning(false);
    }
  }

  async function downloadFullReport() {
    setExporting(true);
    setRunError("");
    try {
      const response = await hrmsApi.get<ReportResponse>(buildUrl(selectedReport.code, filterValues, 100000));
      if (!response.data?.length) throw new Error("No data is available to export for the selected filters");
      if (response.data[0]?.report_status === "PENDING_DATA_BUILDER") throw new Error("This report still requires a dedicated backend data builder and cannot be certified for export");
      await exportRows(response.data, `${selectedReport.code}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function lookupExceptionEmployee() {
    setExceptionLoading(true);
    setExceptionMessage("");
    setExceptionEmployee(null);
    try {
      const response = await hrmsApi.get<{ success: boolean; data: Record<string, unknown> }>(
        `/api/reports/suite/employee-lookup?employeeCode=${encodeURIComponent(exceptionForm.employeeCode)}&date=${encodeURIComponent(exceptionForm.date)}`,
      );
      setExceptionEmployee(response.data);
    } catch (error) {
      setExceptionMessage(error instanceof Error ? error.message : "Employee lookup failed");
    } finally {
      setExceptionLoading(false);
    }
  }

  async function submitException() {
    if (!exceptionEmployee?.employee_id) return;
    if (exceptionForm.reason.trim().length < 10) {
      setExceptionMessage("Reason must be at least 10 characters");
      return;
    }
    setExceptionLoading(true);
    setExceptionMessage("");
    try {
      await hrmsApi.post("/api/attendance/manual-overrides", {
        employee_id: exceptionEmployee.employee_id,
        attendance_date: exceptionForm.date,
        new_status: exceptionForm.newStatus,
        reason: exceptionForm.reason.trim(),
        payroll_month: exceptionForm.date.slice(0, 7),
      });
      setExceptionMessage("Exception request created successfully. It is pending approval and fully audit-logged.");
      setExceptionEmployee(null);
      setExceptionForm({ employeeCode: "", date: today, newStatus: "present", reason: "" });
    } catch (error) {
      setExceptionMessage(error instanceof Error ? error.message : "Unable to create exception request");
    } finally {
      setExceptionLoading(false);
    }
  }

  return (
    <HrmsModernShell
      eyebrow="Enterprise Reporting"
      title="Accuracy-First Report Hub"
      description="One governed workspace for attendance, payroll, HR, compliance, recruitment, operations and productivity reports."
      icon={<BarChart3 size={22} />}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowException(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
          >
            <SlidersHorizontal size={16} /> Mark Exception
          </button>
          <button
            type="button"
            onClick={() => healthQuery.refetch()}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={15} className={healthQuery.isFetching ? "animate-spin" : ""} /> Recheck Health
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-4">
          <HrmsBentoTile title="Available Reports" value={CATALOG.length} detail="Across every major department" icon={<BarChart3 className="h-5 w-5 text-blue-600" />} accentClassName="from-blue-600 to-cyan-500" />
          <HrmsBentoTile title="Accuracy-Controlled" value={controlledCount} detail="Rebuilt critical attendance and payroll reports" icon={<ShieldCheck className="h-5 w-5 text-emerald-600" />} accentClassName="from-emerald-500 to-teal-600" />
          <HrmsBentoTile title="Data Health Issues" value={healthQuery.isLoading ? "…" : openHealthIssues} detail={openHealthIssues ? "Source or reconciliation action required" : "No critical issue detected"} icon={openHealthIssues ? <AlertTriangle className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />} accentClassName="from-amber-500 to-orange-500" />
          <HrmsBentoTile title="Export Capacity" value="100K" detail="Server-refetched rows per XLSX export" icon={<Download className="h-5 w-5 text-violet-600" />} accentClassName="from-violet-500 to-purple-600" />
        </div>

        <div className={`rounded-xl border p-4 ${healthQuery.data?.data.status === "healthy" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                {healthQuery.data?.data.status === "healthy" ? <CheckCircle2 size={17} className="text-emerald-700" /> : <AlertTriangle size={17} className="text-amber-700" />}
                <p className="text-sm font-bold text-slate-900">Reporting Data Health</p>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {healthQuery.isError
                  ? "Health checks could not be completed. Reports must not be treated as certified until database connectivity is restored."
                  : healthQuery.data?.data.status === "healthy"
                    ? "Critical reconciliation checks passed at the latest scan."
                    : "One or more source-data or payroll reconciliation checks require attention."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {healthChecks.map((check) => (
                <span key={check.check_name} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${Number(check.issue_count) ? "bg-white text-amber-800" : "bg-white/70 text-emerald-800"}`}>
                  {check.check_name.replace(/_/g, " ")}: {Number(check.issue_count).toLocaleString("en-IN")}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-4">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search any report" className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                {search && <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X size={14} /></button>}
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {categories.map((item) => (
                  <button key={item} type="button" onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${category === item ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{item}</button>
                ))}
              </div>
            </div>
            <div className="max-h-[720px] overflow-y-auto p-2">
              {filteredReports.map((report) => (
                <button key={report.code} type="button" onClick={() => selectReport(report)} className={`mb-1 w-full rounded-lg border p-3 text-left transition ${selectedReport.code === report.code ? "border-blue-300 bg-blue-50 shadow-sm" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{report.name}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{report.category} · {report.subcategory}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {report.accuracyTier === "controlled" && <ShieldCheck size={14} className="shrink-0 text-emerald-600" />}
                      <ChevronRight size={14} className="shrink-0 text-slate-300" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0 space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-slate-900">{selectedReport.name}</h2>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${selectedReport.accuracyTier === "controlled" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                        {selectedReport.accuracyTier === "controlled" ? "Accuracy Controlled" : "Standard Builder"}
                      </span>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">{selectedReport.description}</p>
                  </div>
                  <button type="button" onClick={downloadFullReport} disabled={exporting} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                    {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Export Full XLSX
                  </button>
                </div>
              </div>

              <div className="p-5">
                <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><Filter size={14} /> Report Filters</div>
                <div className="flex flex-wrap items-end gap-3">
                  {selectedReport.filters.map((definition) => {
                    const filter = resolveFilter(definition);
                    const value = filterValues[filter.key] ?? "";
                    return (
                      <label key={filter.key} className="w-full min-w-[150px] space-y-1 sm:w-auto">
                        <span className="block text-xs font-semibold text-slate-600">{filter.label}</span>
                        {filter.type === "select" ? (
                          <select value={value} onChange={(event) => setFilterValues((current) => ({ ...current, [filter.key]: event.target.value }))} className="h-10 min-w-[170px] rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">All</option>
                            {filter.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        ) : (
                          <input type={filter.type === "year" ? "number" : filter.type} value={value} placeholder={filter.placeholder} onChange={(event) => setFilterValues((current) => ({ ...current, [filter.key]: event.target.value }))} className="h-10 min-w-[170px] rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                        )}
                      </label>
                    );
                  })}
                  <button type="button" onClick={runReport} disabled={running} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60">
                    {running ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Run Report
                  </button>
                </div>
              </div>
            </section>

            {runError && <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><span>{runError}</span></div>}

            {meta && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"><FileCheck2 size={12} /> {meta.rowCount ?? rows.length} rows</span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{meta.accuracyStatus?.replace(/_/g, " ") ?? "report generated"}</span>
                  {meta.sourceTables?.map((table) => <span key={table} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{table}</span>)}
                </div>
                {meta.warnings?.map((warning) => <p key={warning} className="mt-2 flex items-start gap-2 text-xs text-amber-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{warning}</p>)}
                {meta.assurance && <p className="mt-2 text-xs text-slate-500">{meta.assurance}</p>}
              </section>
            )}

            {isPlaceholder && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <p className="font-semibold text-amber-900">This report is not accuracy-certified yet</p>
                <p className="mt-1 text-sm text-amber-700">A tile exists, but its dedicated backend data builder is still pending. The hub will not treat this placeholder as a valid report or permit certified export.</p>
              </div>
            )}

            {!running && !isPlaceholder && rows.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Report Preview</p>
                    <p className="text-xs text-slate-500">Showing up to 500 rows on screen. Full XLSX is fetched separately from the server.</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{rows.length.toLocaleString("en-IN")} fetched</span>
                </div>
                <div className="max-h-[650px] overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-50">
                      <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 text-left font-bold uppercase tracking-wide text-slate-500">{column.replace(/_/g, " ")}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.slice(0, 500).map((row, index) => (
                        <tr key={index} className="hover:bg-blue-50/40">
                          {columns.map((column) => <td key={column} className="max-w-[280px] whitespace-nowrap px-3 py-2 text-slate-700" title={String(row[column] ?? "")}>{displayValue(row[column])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {!running && !runError && rows.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
                <BarChart3 size={36} className="mx-auto text-slate-200" />
                <p className="mt-3 text-sm font-semibold text-slate-500">Set the filters and run the report</p>
                <p className="mt-1 text-xs text-slate-400">Critical reports include source lineage and reconciliation warnings.</p>
              </div>
            )}
          </main>
        </div>
      </div>

      {showException && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={() => setShowException(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div>
                <div className="flex items-center gap-2"><UserRoundSearch size={18} className="text-amber-600" /><h3 className="text-lg font-bold text-slate-900">Mark Attendance Exception</h3></div>
                <p className="mt-1 text-sm text-slate-500">Search by employee or biometric code, review the live attendance state, then create an audited approval request.</p>
              </div>
              <button type="button" onClick={() => setShowException(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={17} /></button>
            </div>
            <div className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1"><span className="text-xs font-semibold text-slate-600">Employee / Biometric Code</span><input value={exceptionForm.employeeCode} onChange={(event) => setExceptionForm((current) => ({ ...current, employeeCode: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-500" placeholder="MAS employee code" /></label>
                <label className="space-y-1"><span className="text-xs font-semibold text-slate-600">Attendance Date</span><input type="date" value={exceptionForm.date} onChange={(event) => setExceptionForm((current) => ({ ...current, date: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-amber-500" /></label>
              </div>
              <button type="button" onClick={lookupExceptionEmployee} disabled={exceptionLoading || !exceptionForm.employeeCode.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{exceptionLoading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search Employee</button>

              {exceptionEmployee && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p><span className="font-semibold">Employee:</span> {String(exceptionEmployee.employee_name ?? "")}</p>
                    <p><span className="font-semibold">Code:</span> {String(exceptionEmployee.employee_code ?? "")}</p>
                    <p><span className="font-semibold">Process:</span> {String(exceptionEmployee.process_name ?? "—")}</p>
                    <p><span className="font-semibold">Current Status:</span> {String(exceptionEmployee.attendance_status ?? "No processed record")}</p>
                  </div>
                  {!exceptionEmployee.attendance_record_id && <p className="mt-2 text-xs font-semibold text-red-700">No attendance record exists for this date. Process attendance first before creating an override.</p>}
                </div>
              )}

              {exceptionEmployee?.attendance_record_id && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1"><span className="text-xs font-semibold text-slate-600">New Attendance Status</span><select value={exceptionForm.newStatus} onChange={(event) => setExceptionForm((current) => ({ ...current, newStatus: event.target.value }))} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-amber-500"><option value="present">Present</option><option value="half_day">Half Day</option><option value="absent">Absent</option><option value="leave_approved">Leave Approved</option><option value="holiday">Holiday</option><option value="week_off">Week Off</option><option value="week_off_worked">Week Off Worked</option><option value="missing_punch">Missing Punch</option></select></label>
                    <label className="space-y-1 sm:col-span-2"><span className="text-xs font-semibold text-slate-600">Mandatory Reason</span><textarea value={exceptionForm.reason} onChange={(event) => setExceptionForm((current) => ({ ...current, reason: event.target.value }))} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-500" placeholder="Explain the evidence and reason for correction (minimum 10 characters)" /></label>
                  </div>
                  <button type="button" onClick={submitException} disabled={exceptionLoading} className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-5 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-60">{exceptionLoading ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Create Audited Exception</button>
                </>
              )}

              {exceptionMessage && <div className={`rounded-lg p-3 text-sm ${exceptionMessage.includes("successfully") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{exceptionMessage}</div>}
            </div>
          </div>
        </div>
      )}
    </HrmsModernShell>
  );
}
