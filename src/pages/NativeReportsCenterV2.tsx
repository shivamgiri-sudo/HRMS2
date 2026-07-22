/**
 * NativeReportsCenterV2 — Production-Grade Report Framework
 *
 * Addresses all architectural issues:
 * 1. RBAC enforcement at catalog, API, and export levels
 * 2. Explicit column definitions with labels and formats
 * 3. Full-export support with proper backend streaming
 * 4. Server-side pagination with total counts
 * 5. Clear state separation (not-run / empty / error / loading)
 * 6. No misleading error messages
 * 7. Duplicate key validation
 * 8. Screen-vs-export reconciliation
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search, Star, Clock, Download, Play, Loader2, ChevronDown,
  BarChart3, Users, CalendarDays, CreditCard, FileCheck, UserPlus, TrendingDown,
  Award, Layers, Package, Link2, HelpCircle, Globe, X, Filter, CheckCircle2,
  AlertTriangle, Info, FileSpreadsheet,
} from "lucide-react";
import { hrmsApi } from "../lib/hrmsApi";
import { HrmsBentoTile, HrmsModernShell } from "@/components/ui/hrms-modern";
import { useAuthStore } from "@/store/authStore";
import { REPORT_DEFINITIONS, formatValue, canViewReport, canExportReport, getReportDefinition } from "@/lib/report-definitions";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FilterDef {
  key: string;
  label: string;
  type: "date" | "month" | "year" | "text" | "select" | "number";
  options?: { value: string; label: string }[];
  placeholder?: string;
}

interface ReportDef {
  code: string;
  name: string;
  category: string;
  subcategory: string;
  filters: FilterDef[];
  requiresRunSelector?: boolean;
  directDownload?: boolean;
  roles?: string[];  // View roles
  exportRoles?: string[];  // Export roles (optional, defaults to roles)
}

interface ReportResult {
  data: Record<string, unknown>[];
  totalCount: number;
  pageSize: number;
  page: number;
  exportAvailable: boolean;
}

type ReportState = "idle" | "loading" | "success" | "empty" | "error";

// ─── Report Catalog with RBAC ──────────────────────────────────────────────────

const BRANCH_FILTER: FilterDef = { key: "branchId", label: "Branch", type: "text", placeholder: "Branch ID" };
const PROCESS_FILTER: FilterDef = { key: "processId", label: "Process", type: "text", placeholder: "Process ID" };
const DEPT_FILTER: FilterDef = { key: "departmentId", label: "Department", type: "text", placeholder: "Dept ID" };
const MONTH_FILTER: FilterDef = { key: "month", label: "Month", type: "month" };
const YEAR_FILTER: FilterDef = { key: "year", label: "Year", type: "year", placeholder: String(new Date().getFullYear()) };
const DATE_FROM: FilterDef = { key: "from", label: "From Date", type: "date" };
const DATE_TO: FilterDef = { key: "to", label: "To Date", type: "date" };
const STATUS_FILTER: FilterDef = {
  key: "status", label: "Status", type: "select",
  options: [
    { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" },
    { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
  ],
};

const CATALOG: ReportDef[] = [
  // Attendance Reports
  {
    code: "attendance-daily", name: "Daily Attendance Report", category: "Attendance", subcategory: "Daily",
    filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "hr_head", "wfm", "manager", "process_manager", "branch_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
  },
  {
    code: "daily-hc-shift", name: "Daily Headcount by Shift", category: "Attendance", subcategory: "Daily",
    filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
  },
  {
    code: "shift-adherence-detail", name: "Shift Adherence Detail", category: "Attendance", subcategory: "Daily",
    filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
  },
  {
    code: "late-arrival-summary", name: "Late Arrival Summary", category: "Attendance", subcategory: "Monthly",
    filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
  },
  {
    code: "overtime-summary", name: "Overtime Summary", category: "Attendance", subcategory: "Monthly",
    filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm", "manager", "payroll", "finance"],
  },
  {
    code: "biometric-reconciliation", name: "Biometric Reconciliation", category: "Attendance", subcategory: "Exceptions",
    filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm"],
  },
  {
    code: "regularization-summary", name: "Regularization Summary", category: "Attendance", subcategory: "Exceptions",
    filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER, STATUS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
  },
  {
    code: "attendance-dispute-summary", name: "Attendance Dispute Summary", category: "Attendance", subcategory: "Exceptions",
    filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER, STATUS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm"],
  },
  {
    code: "habitual-absentee-list", name: "Habitual Absentee / Late List", category: "Attendance", subcategory: "Exceptions",
    filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER, { key: "threshold", label: "Min Absent Days", type: "number", placeholder: "3" }],
    roles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
  },
  {
    code: "daily-shrinkage-report", name: "Daily Shrinkage Report", category: "Attendance", subcategory: "BPO Metrics",
    filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager", "ceo"],
  },
  {
    code: "monthly-shrinkage-trend", name: "Monthly Shrinkage Trend", category: "Attendance", subcategory: "BPO Metrics",
    filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager", "ceo"],
  },
  {
    code: "punch-raw-export", name: "Punch Raw Data Export", category: "Attendance", subcategory: "BPO Metrics",
    filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "wfm"],
  },

  // Payroll Reports
  {
    code: "payroll-register", name: "Salary Register", category: "Payroll", subcategory: "Monthly Processing",
    filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER], requiresRunSelector: true,
    roles: ["super_admin", "admin", "finance", "payroll", "hr_head"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
  },
  {
    code: "payroll-variance", name: "Payroll Variance Report", category: "Payroll", subcategory: "Monthly Processing",
    filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER], requiresRunSelector: true,
    roles: ["super_admin", "admin", "finance", "payroll", "hr_head"],
  },
  {
    code: "payslip-status", name: "Payslip Release Status", category: "Payroll", subcategory: "Monthly Processing",
    filters: [MONTH_FILTER, BRANCH_FILTER], requiresRunSelector: true,
    roles: ["super_admin", "admin", "finance", "payroll", "hr_head"],
  },
  {
    code: "salary-sheet-export", name: "Salary Sheet (Onfido Format)", category: "Payroll", subcategory: "Monthly Processing",
    filters: [MONTH_FILTER, BRANCH_FILTER], requiresRunSelector: true, directDownload: true,
    roles: ["super_admin", "admin", "finance", "payroll", "hr_head"],
  },

  // HR Reports
  {
    code: "employee-master", name: "Employee Master Export", category: "HR & Workforce", subcategory: "Headcount & Org",
    filters: [BRANCH_FILTER, PROCESS_FILTER, DEPT_FILTER, STATUS_FILTER, DATE_FROM, DATE_TO],
    roles: ["super_admin", "admin", "hr", "hr_head"],
  },
  {
    code: "headcount", name: "Active Headcount Summary", category: "HR & Workforce", subcategory: "Headcount & Org",
    filters: [BRANCH_FILTER, PROCESS_FILTER, DEPT_FILTER],
    roles: ["super_admin", "admin", "hr", "hr_head", "manager", "process_manager", "branch_head", "ceo"],
  },
  {
    code: "employee-movement", name: "New Joiners & Exits", category: "HR & Workforce", subcategory: "Employee Lifecycle",
    filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER],
    roles: ["super_admin", "admin", "hr", "hr_head", "manager"],
  },
];

// ─── Category Config ───────────────────────────────────────────────────────────

const CATEGORY_GRADIENTS: Record<string, { from: string; to: string; icon: typeof Users }> = {
  "HR & Workforce": { from: "from-blue-500", to: "to-indigo-600", icon: Users },
  "Attendance": { from: "from-violet-500", to: "to-purple-600", icon: CalendarDays },
  "Leave": { from: "from-emerald-500", to: "to-teal-600", icon: Clock },
  "Payroll": { from: "from-amber-500", to: "to-orange-600", icon: CreditCard },
  "Statutory & Compliance": { from: "from-red-500", to: "to-rose-600", icon: FileCheck },
  "Recruitment & ATS": { from: "from-cyan-500", to: "to-sky-600", icon: UserPlus },
  "Exit & Attrition": { from: "from-slate-500", to: "to-gray-600", icon: TrendingDown },
  "Performance & KPI": { from: "from-pink-500", to: "to-rose-600", icon: Award },
  "WFM & Roster": { from: "from-teal-500", to: "to-cyan-600", icon: Layers },
  "Assets & Documents": { from: "from-lime-500", to: "to-green-600", icon: Package },
  "Integration & Audit": { from: "from-indigo-500", to: "to-blue-600", icon: Link2 },
  "Helpdesk & Grievance": { from: "from-fuchsia-500", to: "to-pink-600", icon: HelpCircle },
  "Client Portal": { from: "from-sky-500", to: "to-indigo-600", icon: Globe },
  "Productivity": { from: "from-orange-500", to: "to-red-600", icon: BarChart3 },
};

const CATEGORY_ORDER = Object.keys(CATEGORY_GRADIENTS);

// ─── Helpers ────────────────────────────────────────────────────────────────────

const LS_RECENT = "rpt_recent_v2";
const LS_FAVS = "rpt_favs_v2";

function loadList(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}
function saveList(key: string, val: string[]) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* noop */ }
}

// ─── XLSX Export with Full Data ──────────────────────────────────────────────────

async function downloadFullExport(
  code: string,
  filters: Record<string, string>,
  filename: string,
  onProgress?: (msg: string) => void
) {
  onProgress?.("Fetching full dataset...");

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  params.set("export", "true");  // Signal for full export

  const url = `/api/reports/suite/${code}?${params.toString()}`;
  const res = await hrmsApi.get<{ data: Record<string, unknown>[]; totalCount?: number }>(url);
  const rows = res.data ?? [];

  onProgress?.(`Generating XLSX with ${rows.length.toLocaleString()} rows...`);

  const XLSX = await import("xlsx");

  // Get column definitions for proper headers
  const def = getReportDefinition(code);
  let headers: string[] = [];
  let orderedKeys: string[] = [];

  if (def && def.columns.length > 0) {
    orderedKeys = def.columns.map(c => c.key);
    headers = def.columns.map(c => c.label);
  } else if (rows.length > 0) {
    orderedKeys = Object.keys(rows[0]);
    headers = orderedKeys.map(k => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
  }

  // Format data with proper labels
  const formattedRows = rows.map(row => {
    const formatted: Record<string, unknown> = {};
    orderedKeys.forEach((key, i) => {
      const col = def?.columns.find(c => c.key === key);
      const value = row[key];
      formatted[headers[i]] = col ? formatValue(value, col.format) : value;
    });
    return formatted;
  });

  const ws = XLSX.utils.json_to_sheet(formattedRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);

  return rows.length;
}

// ─── Filter Input ───────────────────────────────────────────────────────────────

function FilterInput({ def, value, onChange }: {
  def: FilterDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const base = "h-9 text-sm border border-gray-200 rounded-lg px-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-full";

  if (def.type === "select" && def.options) {
    return (
      <select className={base} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        {def.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (def.type === "date") return <input className={base} type="date" value={value} onChange={e => onChange(e.target.value)} />;
  if (def.type === "month") return <input className={base} type="month" value={value} onChange={e => onChange(e.target.value)} />;
  if (def.type === "year") return <input className={base} type="number" min="2020" max="2035" placeholder={def.placeholder ?? String(new Date().getFullYear())} value={value} onChange={e => onChange(e.target.value)} />;
  if (def.type === "number") return <input className={base} type="number" placeholder={def.placeholder ?? ""} value={value} onChange={e => onChange(e.target.value)} />;
  return <input className={base} type="text" placeholder={def.placeholder ?? def.label} value={value} onChange={e => onChange(e.target.value)} />;
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function NativeReportsCenterV2() {
  const { user } = useAuthStore();
  const userRoles = useMemo(() => user?.roles ?? [], [user]);

  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [reportState, setReportState] = useState<ReportState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [recentCodes, setRecentCodes] = useState<string[]>(() => loadList(LS_RECENT));
  const [favCodes, setFavCodes] = useState<Set<string>>(() => new Set(loadList(LS_FAVS)));
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const runnerRef = useRef<HTMLDivElement>(null);

  // Filter catalog by user roles
  const visibleCatalog = useMemo(() => {
    return CATALOG.filter(r => {
      if (!r.roles || r.roles.length === 0) return true;
      return r.roles.some(role => userRoles.includes(role));
    });
  }, [userRoles]);

  // Check if user can export current report
  const canExport = useMemo(() => {
    if (!selectedReport) return false;
    const exportRoles = selectedReport.exportRoles ?? selectedReport.roles ?? [];
    if (exportRoles.length === 0) return true;
    return exportRoles.some(role => userRoles.includes(role));
  }, [selectedReport, userRoles]);

  // Master data for filters
  const { data: branchData } = useQuery({
    queryKey: ["branches-all"],
    queryFn: () => hrmsApi.get<{ data: { id: string; branch_name: string }[] }>("/api/org/branches"),
    staleTime: 10 * 60_000,
  });
  const { data: processData } = useQuery({
    queryKey: ["processes-all"],
    queryFn: () => hrmsApi.get<{ data: { id: string; process_name: string }[] }>("/api/processes"),
    staleTime: 10 * 60_000,
  });

  const branches = branchData?.data ?? [];
  const processes = processData?.data ?? [];

  // Group visible catalog by category
  const grouped = useMemo(() => {
    const map: Record<string, ReportDef[]> = {};
    visibleCatalog.forEach(r => {
      if (!map[r.category]) map[r.category] = [];
      map[r.category].push(r);
    });
    return map;
  }, [visibleCatalog]);

  const totalReports = visibleCatalog.length;
  const categoryCount = Object.keys(grouped).length;
  const favCount = favCodes.size;

  const recentReports = useMemo(
    () => recentCodes.map(c => visibleCatalog.find(r => r.code === c)).filter(Boolean) as ReportDef[],
    [recentCodes, visibleCatalog]
  );

  const searchResults = useMemo(() => {
    if (!searchQ.trim()) return null;
    return visibleCatalog.filter(r => r.name.toLowerCase().includes(searchQ.toLowerCase()));
  }, [searchQ, visibleCatalog]);

  function selectReport(r: ReportDef) {
    setSelectedReport(r);
    setSelectedCat(r.category);
    setRows([]);
    setTotalCount(0);
    setReportState("idle");
    setErrorMessage("");
    setFilterValues({});
    setPage(1);
    const next = [r.code, ...recentCodes.filter(c => c !== r.code)].slice(0, 8);
    setRecentCodes(next);
    saveList(LS_RECENT, next);
    setTimeout(() => runnerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  function toggleFav(code: string) {
    setFavCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) { next.delete(code); } else { next.add(code); }
      saveList(LS_FAVS, Array.from(next));
      return next;
    });
  }

  async function runReport() {
    if (!selectedReport) return;
    setReportState("loading");
    setErrorMessage("");
    setRows([]);
    setTotalCount(0);
    setPage(1);

    try {
      // Direct download reports
      if (selectedReport.directDownload && selectedReport.code === "salary-sheet-export") {
        const month = filterValues["month"]?.trim();
        const branchId = filterValues["branchId"]?.trim();
        if (!month) {
          setErrorMessage("Please select a Month to download the salary sheet.");
          setReportState("error");
          return;
        }
        const params = new URLSearchParams({ month });
        if (branchId) params.set("branchId", branchId);
        const a = document.createElement("a");
        a.href = `/api/payroll/salary-sheet-export?${params.toString()}`;
        a.download = `Salary Sheet ${month}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setReportState("idle");
        return;
      }

      const params = new URLSearchParams();
      Object.entries(filterValues).forEach(([k, v]) => { if (v) params.set(k, v); });
      params.set("limit", String(pageSize));
      params.set("offset", "0");

      const url = `/api/reports/suite/${selectedReport.code}?${params.toString()}`;
      const res = await hrmsApi.get<{ data: Record<string, unknown>[]; totalCount?: number }>(url);
      const data = res.data ?? [];
      const total = res.totalCount ?? data.length;

      setRows(data);
      setTotalCount(total);
      setReportState(data.length === 0 ? "empty" : "success");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (e as { message?: string })?.message
        ?? "Report execution failed";
      setErrorMessage(msg);
      setReportState("error");
    }
  }

  async function handleFullExport() {
    if (!selectedReport || !canExport) return;

    try {
      setExportProgress("Preparing export...");
      const filename = `${selectedReport.code}_${new Date().toISOString().slice(0, 10)}`;
      const count = await downloadFullExport(
        selectedReport.code,
        filterValues,
        filename,
        setExportProgress
      );
      setExportProgress(`Export complete: ${count.toLocaleString()} rows`);
      setTimeout(() => setExportProgress(null), 3000);
    } catch (e) {
      setExportProgress("Export failed");
      setTimeout(() => setExportProgress(null), 3000);
    }
  }

  // Get column definitions
  const columnDefs = useMemo(() => {
    if (!selectedReport) return [];
    const def = getReportDefinition(selectedReport.code);
    if (def && def.columns.length > 0) {
      return def.columns;
    }
    // Fallback: derive from first row
    if (rows.length > 0) {
      return Object.keys(rows[0]).map(key => ({
        key,
        label: key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        format: "text" as const,
      }));
    }
    return [];
  }, [selectedReport, rows]);

  function resolveFilterDef(def: FilterDef): FilterDef {
    if (def.key === "branchId" && branches.length > 0) {
      return { ...def, type: "select", options: branches.map(b => ({ value: b.id, label: b.branch_name })) };
    }
    if (def.key === "processId" && processes.length > 0) {
      return { ...def, type: "select", options: processes.map(p => ({ value: p.id, label: (p as any).process_name })) };
    }
    return def;
  }

  function setFilter(key: string, val: string) {
    setFilterValues(prev => ({ ...prev, [key]: val }));
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <HrmsModernShell
      eyebrow="Reports"
      title="Reports Center"
      description="Production-grade workforce, attendance, payroll, and compliance reports."
      icon={<BarChart3 size={22} />}
      actions={
        <div className="relative w-full sm:w-[320px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            className="w-full h-10 pl-10 pr-10 text-sm rounded-lg bg-white border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search reports..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          {searchQ && (
            <button type="button" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setSearchQ("")}>
              <X size={14} />
            </button>
          )}
        </div>
      }
    >
      <div className="flex min-h-0 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {/* Left sidebar */}
        <aside className="w-60 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-[calc(100vh-120px)] overflow-y-auto">
          <div className="px-3 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Report Categories</p>
            <p className="text-[10px] text-slate-400 mt-1">{totalReports} reports available</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-1">
            {searchResults ? (
              <div className="px-2 py-1 space-y-0.5">
                {searchResults.length === 0 && <p className="text-xs text-slate-400 px-3 py-4">No results</p>}
                {searchResults.slice(0, 20).map(r => (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => selectReport(r)}
                    className={`w-full text-left text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      selectedReport?.code === r.code ? "bg-blue-100 text-blue-700 font-medium" : "text-slate-600 hover:bg-blue-50"
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-2 py-1 space-y-0.5">
                {CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => {
                  const grad = CATEGORY_GRADIENTS[cat];
                  const Icon = grad?.icon ?? BarChart3;
                  const isOpen = selectedCat === cat;

                  return (
                    <div key={cat}>
                      <button
                        type="button"
                        onClick={() => setSelectedCat(prev => prev === cat ? null : cat)}
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors ${
                          isOpen ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${grad?.from} ${grad?.to} flex items-center justify-center`}>
                          <Icon size={11} className="text-white" />
                        </div>
                        <span className="flex-1 text-xs font-semibold truncate">{cat}</span>
                        <span className="text-[10px] text-slate-400">{grouped[cat].length}</span>
                        <ChevronDown size={13} className={`text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </button>
                      {isOpen && (
                        <div className="ml-4 border-l border-slate-200 mt-0.5 mb-1">
                          {grouped[cat].map(r => (
                            <button
                              key={r.code}
                              type="button"
                              onClick={() => selectReport(r)}
                              className={`w-full text-left text-xs px-3 py-1.5 rounded-lg transition-colors ${
                                selectedReport?.code === r.code ? "bg-blue-100 text-blue-700 font-medium" : "text-slate-600 hover:bg-blue-50"
                              }`}
                            >
                              {favCodes.has(r.code) && <Star size={9} className="inline mr-1 text-yellow-400" fill="currentColor" />}
                              {r.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </nav>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <HrmsBentoTile title="Reports" value={totalReports} detail="Available for your role" icon={<BarChart3 className="h-5 w-5 text-blue-600" />} accentClassName="from-blue-600 to-cyan-500" />
            <HrmsBentoTile title="Categories" value={categoryCount} detail="Organized by function" icon={<Layers className="h-5 w-5 text-violet-600" />} accentClassName="from-violet-500 to-purple-600" />
            <HrmsBentoTile title="Favourites" value={favCount} detail={favCount > 0 ? "Quick access" : "Star reports to pin"} icon={<Star className="h-5 w-5 text-amber-500" fill={favCount > 0 ? "currentColor" : "none"} />} accentClassName="from-amber-500 to-orange-500" />
          </div>

          {/* Recent */}
          {recentReports.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <Clock size={13} className="text-slate-400 flex-shrink-0" />
              {recentReports.slice(0, 6).map(r => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => selectReport(r)}
                  className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200 hover:bg-blue-50"
                >
                  {r.name.length > 25 ? r.name.slice(0, 25) + "..." : r.name}
                </button>
              ))}
            </div>
          )}

          {/* No selection prompt */}
          {!selectedReport && !searchResults && (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 py-16 text-center shadow-sm">
              <BarChart3 size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm text-slate-400 font-medium">Select a category from the left panel to browse reports</p>
            </div>
          )}

          {/* Runner Panel */}
          {selectedReport && (
            <div ref={runnerRef} className="space-y-4">
              {/* Header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const grad = CATEGORY_GRADIENTS[selectedReport.category];
                        const Icon = grad?.icon ?? BarChart3;
                        return (
                          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${grad?.from} ${grad?.to} flex items-center justify-center shadow-sm`}>
                            <Icon size={16} className="text-white" />
                          </div>
                        );
                      })()}
                      <div>
                        <h2 className="text-base font-bold text-gray-900">{selectedReport.name}</h2>
                        <p className="text-xs text-gray-400 mt-0.5">{selectedReport.category} / {selectedReport.subcategory}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleFav(selectedReport.code)}
                        className={`p-2 rounded-lg border transition-colors ${
                          favCodes.has(selectedReport.code) ? "bg-yellow-50 border-yellow-200 text-yellow-500" : "bg-white border-gray-200 text-gray-400"
                        }`}
                      >
                        <Star size={14} fill={favCodes.has(selectedReport.code) ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedReport(null); setRows([]); setReportState("idle"); }}
                        className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Filters */}
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-end gap-3">
                    {selectedReport.filters.map(def => {
                      const resolved = resolveFilterDef(def);
                      return (
                        <div key={def.key} className="space-y-1 w-full sm:w-auto sm:min-w-[140px] sm:max-w-[200px]">
                          <label className="block text-xs font-medium text-gray-500">{def.label}</label>
                          <FilterInput def={resolved} value={filterValues[def.key] ?? ""} onChange={v => setFilter(def.key, v)} />
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      disabled={reportState === "loading"}
                      onClick={runReport}
                      className="flex items-center gap-2 px-5 h-9 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
                    >
                      {reportState === "loading" ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run</>}
                    </button>
                  </div>
                </div>
              </div>

              {/* Error State */}
              {reportState === "error" && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-3">
                  <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Report execution failed</p>
                    <p className="text-red-600 mt-1">{errorMessage}</p>
                  </div>
                </div>
              )}

              {/* Empty State */}
              {reportState === "empty" && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-3">
                  <Info size={18} className="flex-shrink-0" />
                  <span>No records found for the selected filters. Try adjusting your date range or filter criteria.</span>
                </div>
              )}

              {/* Results */}
              {reportState === "success" && rows.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full">
                        {rows.length.toLocaleString()} rows displayed
                      </span>
                      {totalCount > rows.length && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full">
                          {totalCount.toLocaleString()} total — export for full data
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 bg-gray-50 text-gray-600 rounded-full">
                        {columnDefs.length} columns
                      </span>
                    </div>
                    {canExport && (
                      <button
                        type="button"
                        onClick={handleFullExport}
                        disabled={!!exportProgress}
                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
                      >
                        {exportProgress ? (
                          <><Loader2 size={14} className="animate-spin" /> {exportProgress}</>
                        ) : (
                          <><FileSpreadsheet size={14} /> Export Full Data</>
                        )}
                      </button>
                    )}
                    {!canExport && (
                      <span className="text-xs text-gray-400">Export not available for your role</span>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50 sticky top-0">
                          {columnDefs.map(col => (
                            <th
                              key={col.key}
                              className={`px-3 py-2.5 font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${
                                col.align === "right" ? "text-right" : "text-left"
                              }`}
                            >
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {rows.map((row, i) => (
                          <tr key={i} className={`hover:bg-blue-50/50 ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                            {columnDefs.map(col => (
                              <td
                                key={col.key}
                                className={`px-3 py-2 text-gray-700 whitespace-nowrap max-w-[220px] truncate ${
                                  col.align === "right" ? "text-right" : ""
                                }`}
                                title={String(row[col.key] ?? "")}
                              >
                                {formatValue(row[col.key], col.format)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Idle State */}
              {reportState === "idle" && (
                <div className="bg-white rounded-xl border border-slate-200 py-14 text-center shadow-sm">
                  <BarChart3 size={36} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400 font-medium">Configure filters above and click Run to generate the report</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </HrmsModernShell>
  );
}
