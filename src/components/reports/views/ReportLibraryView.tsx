/**
 * ReportLibraryView — lifted from NativeReportsCenterV2.tsx
 * Accepts preselectedReport prop from ReportsHub URL param ?report=xxx
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Star, Clock, Mail, Play, Loader2, ChevronDown, ChevronLeft, ChevronRight,
  BarChart3, Users, CalendarDays, CreditCard, FileCheck, UserPlus, TrendingDown,
  Award, Layers, Package, Link2, HelpCircle, Globe, X, Filter, CheckCircle2,
  AlertTriangle, Info, AlertCircle, Table2, Hash,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HrmsBentoTile } from "@/components/ui/hrms-modern";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { REPORT_CATALOG as CENTRAL_CATALOG } from "@/lib/report-catalog";

// ─── Types ─────────────────────────────────────────────────────────────────────

type ColumnFormat = "text" | "number" | "currency" | "percentage" | "date" | "datetime" | "time" | "duration" | "minutes" | "boolean" | "status" | "masked";

interface ColumnDef {
  key: string;
  label: string;
  format: ColumnFormat;
  align?: "left" | "center" | "right";
  width?: number;
  sensitive?: boolean;
}

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
  columns: ColumnDef[];
  rowGrain: string;
  primaryKey: string[];
  viewRoles: string[];
  exportRoles: string[];
  requiresRunSelector?: boolean;
  directDownload?: boolean;
}

interface ApiResponse {
  success: boolean;
  code: string;
  data: Record<string, unknown>[];
  totalCount: number;
  meta: {
    count: number;
    totalCount: number;
    limit: number | string;
    offset: number;
    page: number;
    totalPages: number;
    isFullExport: boolean;
    fallback?: boolean;
  };
}

type ReportState = "idle" | "loading" | "success" | "empty" | "error";

// ─── Value Formatter ───────────────────────────────────────────────────────────

function formatValue(value: unknown, format: ColumnFormat): string {
  if (value == null || value === "") return "—";

  switch (format) {
    case "currency":
      return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "percentage":
      return `${Number(value).toFixed(2)}%`;
    case "number":
      return Number(value).toLocaleString("en-IN");
    case "date":
      if (typeof value === "string") {
        if (value.includes("T")) return new Date(value).toLocaleDateString("en-IN");
        return value;
      }
      return String(value);
    case "datetime":
      return new Date(String(value)).toLocaleString("en-IN");
    case "time":
      if (typeof value === "string") {
        if (value.includes("T")) return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        return value;
      }
      return String(value);
    case "duration":
      return String(value);
    case "minutes": {
      const mins = Number(value);
      if (isNaN(mins)) return String(value);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
    case "boolean":
      return value === true || value === 1 || value === "1" || value === "true" ? "Yes" : "No";
    case "status":
      return String(value).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    case "masked": {
      const str = String(value);
      if (str.length <= 4) return "****";
      return "****" + str.slice(-4);
    }
    default:
      return String(value);
  }
}

// ─── Filter Definitions ────────────────────────────────────────────────────────

const BRANCH_FILTER: FilterDef = { key: "branchId", label: "Branch", type: "text", placeholder: "Branch ID" };
const PROCESS_FILTER: FilterDef = { key: "processId", label: "Process", type: "text", placeholder: "Process ID" };
const DEPT_FILTER: FilterDef = { key: "departmentId", label: "Department", type: "text", placeholder: "Dept ID" };
const MONTH_FILTER: FilterDef = { key: "month", label: "Month", type: "month" };
const YEAR_FILTER: FilterDef = { key: "year", label: "Year", type: "year" };
const DATE_FROM: FilterDef = { key: "from", label: "From Date", type: "date" };
const DATE_TO: FilterDef = { key: "to", label: "To Date", type: "date" };
const STATUS_FILTER: FilterDef = {
  key: "status", label: "Status", type: "select",
  options: [
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
  ],
};

function buildFiltersForReport(code: string): FilterDef[] {
  const dateFilters = [DATE_FROM, DATE_TO];
  const monthFilter = [MONTH_FILTER];
  const branchProcess = [BRANCH_FILTER, PROCESS_FILTER];
  const branchOnly = [BRANCH_FILTER];

  const filterMap: Record<string, FilterDef[]> = {
    "headcount": [...branchProcess, DEPT_FILTER],
    "employee-master": [...branchProcess, DEPT_FILTER, STATUS_FILTER, ...dateFilters],
    "manager-mapping": branchProcess,
    "org-structure-snapshot": branchOnly,
    "cost-centre-headcount": branchOnly,
    "employee-movement": [...dateFilters, ...branchProcess],
    "confirmation-due-list": branchProcess,
    "contract-expiry-list": branchOnly,
    "lifecycle-events": [...branchProcess, ...dateFilters],
    "increment-promotion-history": [...branchOnly, ...dateFilters],
    "birthday-list": [...branchOnly, MONTH_FILTER],
    "anniversary-list": [...branchOnly, MONTH_FILTER],
    "attendance-daily": [...dateFilters, ...branchProcess],
    "daily-hc-shift": [...dateFilters, ...branchProcess],
    "shift-adherence-detail": [...dateFilters, ...branchProcess],
    "attendance-summary": [...monthFilter, ...branchProcess],
    "attendance-register-grid": [...monthFilter, ...branchProcess],
    "late-arrival-summary": [...monthFilter, ...branchProcess],
    "overtime-summary": [...monthFilter, ...branchProcess],
    "biometric-reconciliation": [...dateFilters, ...branchProcess],
    "regularization-summary": [...monthFilter, ...branchProcess, STATUS_FILTER],
    "attendance-dispute-summary": [...monthFilter, ...branchProcess, STATUS_FILTER],
    "habitual-absentee-list": [...monthFilter, ...branchProcess],
    "daily-shrinkage-report": [...dateFilters, ...branchProcess],
    "monthly-shrinkage-trend": [...dateFilters, ...branchProcess],
    "punch-raw-export": [...dateFilters, ...branchProcess],
    "leave-balance": [...branchProcess, { key: "leaveType", label: "Leave Type", type: "text" as const, placeholder: "e.g. CL, SL, EL" }],
    "leave-utilization": [...dateFilters, BRANCH_FILTER],
    "maternity-paternity-register": [...branchOnly, YEAR_FILTER],
    "leave-encashment-register": [...branchOnly, YEAR_FILTER],
    "holiday-master-list": [...branchOnly, YEAR_FILTER],
    "payroll-register": [...monthFilter, ...branchProcess],
    "payroll-variance": [...monthFilter, ...branchProcess],
    "salary-sheet-onfido": [...monthFilter, ...branchProcess],
    "bank-advice": [...monthFilter, ...branchProcess],
    "neft-transfer-file": [...monthFilter, ...branchProcess],
    "payroll-reconciliation": [...monthFilter, ...branchProcess],
    "arrear-payment-register": [...monthFilter, ...branchProcess],
    "ytd-salary-summary": [{ key: "financialYear", label: "Financial Year", type: "text" as const, placeholder: "2025-26" }, ...branchProcess],
    "cost-centre-salary-summary": [...monthFilter, ...branchProcess],
    "process-lob-salary-cost": [...monthFilter, ...branchProcess],
    "grade-salary-distribution": [...monthFilter, ...branchProcess],
    "payslip-status": [...monthFilter, ...branchProcess],
    "salary-advance-register": [...branchProcess],
    "lwp-deduction-register": [...monthFilter, ...branchProcess],
    "bank-missing": [...branchProcess],
    "bank-change-requests": [...branchProcess],
    "increment-requests": [...branchProcess],
    "payroll-readiness-status": [...monthFilter, ...branchProcess],
    "pf-esi-optout-register": [...branchProcess],
    "pf-esic-salary-register": [...monthFilter, ...branchProcess],
    "pf-contribution-register": [...monthFilter, ...branchProcess],
    "pf-monthly-summary": [...monthFilter, branchOnly[0]],
    "pf-ecr-format": [...monthFilter, branchOnly[0]],
    "esic-contribution-register": [...monthFilter, ...branchProcess],
    "esic-monthly-summary": [...monthFilter, branchOnly[0]],
    "pt-register": [...monthFilter, ...branchProcess],
    "pt-monthly-register": [...monthFilter, branchOnly[0]],
    "tds-computation-register": branchOnly,
    "form-16-status": branchOnly,
    "investment-declaration-status": branchOnly,
    "gratuity-liability-register": branchOnly,
    "resignation-register": [...dateFilters, ...branchProcess],
    "exit-movement-report": [...dateFilters, ...branchProcess],
    "fnf-pending-register": branchOnly,
    "fnf-settlement-register": [...dateFilters, branchOnly[0]],
    "ff-settlement-register": [...dateFilters, branchOnly[0]],
    "clearance-status-register": branchOnly,
    "monthly-attrition-summary": [...dateFilters, ...branchProcess],
    "exit-reason-analysis": [...dateFilters, ...branchProcess],
    "tenure-distribution": branchProcess,
    "early-attrition-report": [...dateFilters, ...branchProcess],
    "recruitment-pipeline": branchProcess,
    "ats-pipeline-summary": branchProcess,
    "candidate-tracker": [...dateFilters, ...branchProcess],
    "offer-to-joining-tracker": [...dateFilters, ...branchProcess],
    "source-effectiveness": [...dateFilters, branchOnly[0]],
    "recruiter-productivity": [...dateFilters, branchOnly[0]],
    "offer-tracker": [...dateFilters, ...branchProcess],
    "joining-pending": branchProcess,
    "agent-performance-summary": [...monthFilter, ...branchProcess],
    "productivity-individual-scorecard": [...monthFilter, ...branchProcess],
    "team-performance-summary": [...monthFilter, ...branchProcess],
    "quality-audit-log": [...dateFilters, ...branchProcess],
    "fatal-error-register": [...dateFilters, ...branchProcess],
    "roster-published": [...dateFilters, ...branchProcess],
    "roster-adherence": [...dateFilters, ...branchProcess],
    "roster-variance": [...dateFilters, ...branchProcess],
    "shift-swap-register": [...dateFilters, ...branchProcess],
    "week-off-calendar": [...dateFilters, ...branchProcess],
    "asset-inventory": branchOnly,
    "asset-inventory-report": branchOnly,
    "asset-allocation-register": branchOnly,
    "asset-movement-log": [...dateFilters, branchOnly[0]],
    "training-completion-status": branchProcess,
    "certification-status": branchProcess,
    "training-batch-summary": [...dateFilters, ...branchProcess],
    "document-expiry-tracker": branchOnly,
    "employee-document-compliance": branchOnly,
    "document-verification-status": branchOnly,
    "missing-documents-report": branchProcess,
    "uan-status-report": branchOnly,
    "uan-master-register": branchOnly,
    "esic-status-report": branchOnly,
    "pan-verification-status": branchOnly,
    "bank-account-verification": branchOnly,
    "identity-source-snapshot": branchOnly,
  };

  return filterMap[code] ?? [...dateFilters, ...branchProcess];
}

const CATALOG: ReportDef[] = CENTRAL_CATALOG.map(r => ({
  ...r,
  filters: buildFiltersForReport(r.code),
}));

// ─── Category Config ───────────────────────────────────────────────────────────

const CATEGORY_GRADIENTS: Record<string, { from: string; to: string; icon: typeof Users }> = {
  "HR & Workforce": { from: "from-blue-500", to: "to-indigo-600", icon: Users },
  "Attendance": { from: "from-violet-500", to: "to-purple-600", icon: CalendarDays },
  "Leave": { from: "from-emerald-500", to: "to-teal-600", icon: Clock },
  "Payroll": { from: "from-amber-500", to: "to-orange-600", icon: CreditCard },
  "Statutory": { from: "from-red-500", to: "to-rose-600", icon: FileCheck },
  "Exit & Separation": { from: "from-slate-500", to: "to-gray-700", icon: HelpCircle },
  "Attrition & Trends": { from: "from-orange-500", to: "to-red-600", icon: TrendingDown },
  "Recruitment": { from: "from-sky-500", to: "to-blue-600", icon: UserPlus },
  "Operations & Quality": { from: "from-teal-500", to: "to-green-600", icon: BarChart3 },
  "WFM & Roster": { from: "from-cyan-500", to: "to-teal-600", icon: Layers },
  "Assets": { from: "from-amber-600", to: "to-yellow-700", icon: Package },
  "Training": { from: "from-indigo-500", to: "to-violet-600", icon: Award },
  "Documents": { from: "from-green-500", to: "to-emerald-600", icon: FileCheck },
  "Identity": { from: "from-rose-500", to: "to-pink-600", icon: Globe },
};

const CATEGORY_ORDER = [
  "HR & Workforce", "Attendance", "Leave", "Payroll", "Statutory",
  "Exit & Separation", "Attrition & Trends", "Recruitment",
  "Operations & Quality", "WFM & Roster", "Assets", "Training",
  "Documents", "Identity",
];

const LS_RECENT = "rpt_recent_v3";
const LS_FAVS = "rpt_favs_v3";

function loadList(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}
function saveList(key: string, val: string[]) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* noop */ }
}

function FilterInput({ def, value, onChange }: { def: FilterDef; value: string; onChange: (v: string) => void }) {
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

function detectDuplicates(rows: Record<string, unknown>[], primaryKey: string[]): { hasDuplicates: boolean; duplicateCount: number } {
  if (primaryKey.length === 0 || rows.length === 0) return { hasDuplicates: false, duplicateCount: 0 };
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const row of rows) {
    const keyValue = primaryKey.map(k => String(row[k] ?? "")).join("|");
    if (seen.has(keyValue)) { duplicateCount++; } else { seen.add(keyValue); }
  }
  return { hasDuplicates: duplicateCount > 0, duplicateCount };
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface ReportLibraryViewProps {
  preselectedReport?: string;
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function ReportLibraryView({ preselectedReport }: ReportLibraryViewProps) {
  const { roleKeys } = useWorkforceAccess();
  const userRoles = roleKeys;

  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [reportState, setReportState] = useState<ReportState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [recentCodes, setRecentCodes] = useState<string[]>(() => loadList(LS_RECENT));
  const [favCodes, setFavCodes] = useState<Set<string>>(() => new Set(loadList(LS_FAVS)));
  const [requestMessage, setRequestMessage] = useState("");
  const [duplicateInfo, setDuplicateInfo] = useState<{ hasDuplicates: boolean; duplicateCount: number }>({ hasDuplicates: false, duplicateCount: 0 });

  const pageSize = 100;
  const runnerRef = useRef<HTMLDivElement>(null);

  const visibleCatalog = useMemo(() => {
    if (userRoles.includes("super_admin")) return CATALOG;
    return CATALOG.filter(r => {
      if (!r.viewRoles || r.viewRoles.length === 0) return true;
      return r.viewRoles.some(role => userRoles.includes(role));
    });
  }, [userRoles]);

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

  // Auto-select preselected report from URL param
  useEffect(() => {
    if (preselectedReport && visibleCatalog.length > 0) {
      const found = visibleCatalog.find(r => r.code === preselectedReport);
      if (found) selectReport(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedReport, visibleCatalog.length]);

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
    setCurrentPage(1);
    setReportState("idle");
    setErrorMessage("");
    setFilterValues({});
    setDuplicateInfo({ hasDuplicates: false, duplicateCount: 0 });
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

  async function runReport(page = 1) {
    if (!selectedReport) return;
    setReportState("loading");
    setErrorMessage("");
    setRows([]);

    try {
      const params = new URLSearchParams();
      Object.entries(filterValues).forEach(([k, v]) => { if (v) params.set(k, v); });
      params.set("limit", String(pageSize));
      params.set("offset", String((page - 1) * pageSize));

      const url = `/api/reports/suite/${selectedReport.code}?${params.toString()}`;
      const res = await hrmsApi.get<ApiResponse>(url, 120_000);
      const data = res.data ?? [];
      const total = res.totalCount ?? res.meta?.totalCount ?? data.length;

      setRows(data);
      setTotalCount(total);
      setCurrentPage(page);

      const dupeCheck = detectDuplicates(data, selectedReport.primaryKey);
      setDuplicateInfo(dupeCheck);

      setReportState(data.length === 0 ? "empty" : "success");
    } catch (e: unknown) {
      const errObj = e as { response?: { data?: { message?: string } }; message?: string };
      const msg = errObj?.response?.data?.message ?? errObj?.message ?? "Report execution failed";
      setErrorMessage(msg);
      setReportState("error");
    }
  }

  async function handleRequestReport() {
    if (!selectedReport) return;
    setRequestMessage("Submitting report request…");
    try {
      const filters: Record<string, string> = {};
      Object.entries(filterValues).forEach(([k, v]) => { if (v) filters[k] = v; });
      const res = await hrmsApi.post<{ requestReference: string; recipientEmailMasked: string; message: string }>(
        `/api/reports/${selectedReport.code}/request`,
        { filters }
      );
      setRequestMessage(`Request ${res.requestReference} queued. Report will be emailed to ${res.recipientEmailMasked}.`);
    } catch (error) {
      setRequestMessage(error instanceof Error ? error.message : "Request failed. Please try again.");
    } finally {
      window.setTimeout(() => setRequestMessage(""), 8000);
    }
  }

  function resolveFilterDef(def: FilterDef): FilterDef {
    if (def.key === "branchId" && branches.length > 0) {
      return { ...def, type: "select", options: branches.map(b => ({ value: b.id, label: b.branch_name })) };
    }
    if (def.key === "processId" && processes.length > 0) {
      return { ...def, type: "select", options: processes.map(p => ({ value: p.id, label: (p as { process_name: string }).process_name })) };
    }
    return def;
  }

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="space-y-4">
      {/* Search bar */}
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

      <div className="flex min-h-0 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-[calc(100vh-200px)] overflow-y-auto">
          <div className="px-3 py-3 border-b border-slate-100">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Report Categories</p>
            <p className="text-[10px] text-slate-400 mt-1">{totalReports} reports for your role</p>
          </div>
          <nav className="flex-1 overflow-y-auto py-1">
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
                      <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${grad?.from ?? "from-gray-400"} ${grad?.to ?? "to-gray-500"} flex items-center justify-center`}>
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
          </nav>
        </aside>

        {/* Main */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <HrmsBentoTile title="Reports" value={totalReports} detail="Available for your role" icon={<BarChart3 className="h-5 w-5 text-blue-600" />} accentClassName="from-blue-600 to-cyan-500" />
            <HrmsBentoTile title="Categories" value={categoryCount} detail="Organized by function" icon={<Layers className="h-5 w-5 text-violet-600" />} accentClassName="from-violet-500 to-purple-600" />
            <HrmsBentoTile title="Favourites" value={favCodes.size} detail="Quick access" icon={<Star className="h-5 w-5 text-amber-500" fill={favCodes.size > 0 ? "currentColor" : "none"} />} accentClassName="from-amber-500 to-orange-500" />
          </div>

          {/* Recent */}
          {recentReports.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <Clock size={13} className="text-slate-400 flex-shrink-0" />
              {recentReports.slice(0, 6).map(r => (
                <button key={r.code} type="button" onClick={() => selectReport(r)} className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200 hover:bg-blue-50">
                  {r.name.length > 25 ? r.name.slice(0, 25) + "..." : r.name}
                </button>
              ))}
            </div>
          )}

          {/* Search results */}
          {searchResults !== null && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
              <p className="text-xs font-semibold text-slate-500 mb-2">{searchResults.length} results for "{searchQ}"</p>
              <div className="space-y-1">
                {searchResults.map(r => (
                  <button key={r.code} type="button" onClick={() => { selectReport(r); setSearchQ(""); }} className="w-full text-left text-xs px-3 py-2 rounded-lg text-slate-700 hover:bg-blue-50 flex items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-slate-400">— {r.category}</span>
                  </button>
                ))}
                {searchResults.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">No reports found.</p>}
              </div>
            </div>
          )}

          {/* No selection */}
          {!selectedReport && searchResults === null && (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 py-16 text-center shadow-sm">
              <BarChart3 size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm text-slate-400 font-medium">Select a category and report from the left panel</p>
            </div>
          )}

          {/* Report Panel */}
          {selectedReport && (
            <div ref={runnerRef} className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const grad = CATEGORY_GRADIENTS[selectedReport.category];
                        const Icon = grad?.icon ?? BarChart3;
                        return (
                          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${grad?.from ?? "from-gray-500"} ${grad?.to ?? "to-gray-600"} flex items-center justify-center shadow-sm`}>
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
                  <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                    <Hash size={12} />
                    <span className="font-medium">Row grain:</span>
                    <span>{selectedReport.rowGrain}</span>
                    <span className="text-gray-300">|</span>
                    <span className="font-medium">Primary key:</span>
                    <span>{selectedReport.primaryKey.join(", ")}</span>
                  </div>
                </div>

                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-end gap-3">
                    {selectedReport.filters.map(def => {
                      const resolved = resolveFilterDef(def);
                      return (
                        <div key={def.key} className="space-y-1 w-full sm:w-auto sm:min-w-[140px] sm:max-w-[200px]">
                          <label className="block text-xs font-medium text-gray-500">{def.label}</label>
                          <FilterInput def={resolved} value={filterValues[def.key] ?? ""} onChange={v => setFilterValues(prev => ({ ...prev, [def.key]: v }))} />
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      disabled={reportState === "loading"}
                      onClick={() => runReport(1)}
                      className="flex items-center gap-2 px-5 h-9 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60"
                    >
                      {reportState === "loading" ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run</>}
                    </button>
                  </div>
                </div>
              </div>

              {reportState === "error" && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-3">
                  <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Report execution failed</p>
                    <p className="text-red-600 mt-1">{errorMessage}</p>
                  </div>
                </div>
              )}

              {reportState === "empty" && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-3">
                  <Info size={18} className="flex-shrink-0" />
                  <span>No records found for the selected filters. Adjust your date range or criteria.</span>
                </div>
              )}

              {reportState === "success" && duplicateInfo.hasDuplicates && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-orange-700 flex items-center gap-3">
                  <AlertCircle size={18} className="flex-shrink-0" />
                  <span>
                    <strong>Data quality warning:</strong> {duplicateInfo.duplicateCount} duplicate row(s) detected based on primary key ({selectedReport.primaryKey.join(", ")}).
                  </span>
                </div>
              )}

              {reportState === "success" && rows.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full">
                        <Table2 size={12} /> {rows.length} rows on page {currentPage}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 bg-gray-50 text-gray-600 rounded-full">
                        {totalCount.toLocaleString()} total
                      </span>
                      {totalCount > rows.length && (
                        <span className="text-xs text-amber-600 font-medium">
                          (showing page {currentPage} of {totalPages})
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={handleRequestReport}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
                      >
                        <Mail size={14} /> Request by Email
                      </button>
                      {requestMessage && (
                        <p className="text-xs text-blue-700 max-w-xs text-right">{requestMessage}</p>
                      )}
                    </div>
                  </div>

                  {totalPages > 1 && (
                    <div className="px-5 py-2 border-b border-gray-100 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        disabled={currentPage === 1 || reportState === "loading"}
                        onClick={() => runReport(currentPage - 1)}
                        className="p-2 rounded border border-gray-200 disabled:opacity-40"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span className="text-xs text-gray-600">Page {currentPage} of {totalPages}</span>
                      <button
                        type="button"
                        disabled={currentPage === totalPages || reportState === "loading"}
                        onClick={() => runReport(currentPage + 1)}
                        className="p-2 rounded border border-gray-200 disabled:opacity-40"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50 sticky top-0">
                          {selectedReport.columns.map(col => (
                            <th
                              key={col.key}
                              className={`px-3 py-2.5 font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${
                                col.align === "right" ? "text-right" : "text-left"
                              }`}
                              style={{ minWidth: col.width }}
                            >
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {rows.map((row, i) => (
                          <tr key={i} className={`hover:bg-blue-50/50 ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                            {selectedReport.columns.map(col => (
                              <td
                                key={col.key}
                                className={`px-3 py-2 text-gray-700 whitespace-nowrap max-w-[220px] truncate ${
                                  col.align === "right" ? "text-right tabular-nums" : ""
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
    </div>
  );
}
