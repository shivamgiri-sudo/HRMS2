import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  Download,
  Mail,
  ExternalLink,
  FileCheck2,
  FileSearch,
  GraduationCap,
  HeartHandshake,
  IdCard,
  Landmark,
  Library,
  Loader2,
  Network,
  Package,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  UserRoundSearch,
  Users,
  UserX,
  WalletCards,
  Workflow,
  XCircle,
} from "lucide-react";
import { HrmsModernShell } from "@/components/ui/hrms-modern";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  formatValue,
  currentBusinessMonth,
  businessFirstDayOfMonth,
  businessToday,
  type ColumnDef,
  type ReportMeta,
} from "@/lib/report-catalog";

type PerspectiveType = "overview" | "trend" | "register" | "exceptions" | "reconciliation" | "compliance";
type ReportState = "idle" | "loading" | "success" | "empty" | "error";

interface DetailedReport extends ReportMeta {
  sourceTables?: string[];
  calculationNotes?: string;
  branchScoped?: boolean;
  processScoped?: boolean;
}

interface DeepPerspective {
  type: PerspectiveType;
  title: string;
  description: string;
  reports: DetailedReport[];
  missingReportCodes: string[];
}

interface DeepPack {
  code: string;
  name: string;
  shortName: string;
  description: string;
  businessOwner: string;
  viewRoles: string[];
  exportRoles: string[];
  canExport: boolean;
  relatedRoutes: Array<{ label: string; path: string }>;
  decisionQuestions: string[];
  complianceControls: string[];
  sensitiveDomains: string[];
  perspectives: DeepPerspective[];
  sourceGroups: Array<{
    key: string;
    label: string;
    description: string;
    candidateTables: string[];
    required?: boolean;
  }>;
  reportCount: number;
  missingReportCount: number;
}

interface DeepCatalogResponse {
  success: boolean;
  data: DeepPack[];
  meta: {
    packCount: number;
    detailedReportCount: number;
    roles: string[];
    architecture: string;
  };
}

interface SourceHealth {
  key: string;
  label: string;
  description: string;
  required: boolean;
  state: "available" | "missing" | "error";
  selectedTable: string | null;
  availableTables: string[];
  missingCandidates: string[];
  rowCount: number | null;
  activeCount: number | null;
  issueCount: number | null;
  latestActivity: string | null;
  statusColumn: string | null;
  statusBreakdown: Array<{ status: string; count: number }>;
  missingBranchMappings: number | null;
  missingProcessMappings: number | null;
  appliedFilters: string[];
  error?: string;
}

interface DeepOverview {
  packCode: string;
  generatedAt: string;
  filters: Record<string, string | undefined>;
  kpis: {
    schemaCoveragePct: number;
    availableRequiredSources: number;
    requiredSources: number;
    knownRows: number;
    knownIssues: number;
    mappingExceptions: number;
    latestActivity: string | null;
  };
  readiness: {
    ready: boolean;
    missingRequiredSources: string[];
    sourceErrors: string[];
  };
  sources: SourceHealth[];
  alerts: Array<{ severity: "critical" | "warning" | "info"; code: string; message: string }>;
}

interface OverviewResponse {
  success: boolean;
  data: DeepOverview;
}

interface ReportResponse {
  success: boolean;
  code: string;
  data: Record<string, unknown>[];
  totalCount?: number;
  meta?: {
    count?: number;
    totalCount?: number;
    page?: number;
    totalPages?: number;
    fallback?: boolean;
    isFullExport?: boolean;
  };
}

interface MasterResponse<T> {
  data: T[];
}

const PERSPECTIVE_ORDER: PerspectiveType[] = [
  "overview",
  "trend",
  "register",
  "exceptions",
  "reconciliation",
  "compliance",
];

const PERSPECTIVE_LABEL: Record<PerspectiveType, string> = {
  overview: "Overview",
  trend: "Trends",
  register: "Detailed Register",
  exceptions: "Exceptions",
  reconciliation: "Reconciliation",
  compliance: "Compliance",
};

const PACK_ICONS: Record<string, LucideIcon> = {
  "people-workforce": Users,
  "recruitment-onboarding": UserRoundSearch,
  "attendance-biometric": CalendarDays,
  "leave-absence": HeartHandshake,
  "wfm-roster-breaks": Workflow,
  "payroll-compensation": WalletCards,
  "statutory-tax": Landmark,
  "exit-attrition": UserX,
  "finance-profitability": CircleDollarSign,
  "operations-productivity": Activity,
  "quality-risk": FileSearch,
  "performance-career": BriefcaseBusiness,
  "training-lms": GraduationCap,
  "assets-it": Package,
  "support-grievance": HeartHandshake,
  "documents-identity-privacy": IdCard,
  "engagement-experience": Users,
  "security-access-audit": ShieldCheck,
  "integration-data-quality": Network,
  "visitor-workplace": Building2,
};

// Date defaults come from the shared business-timezone helpers, not from UTC substrings of
// toISOString(). The local copies these replace were wrong in IST: firstDayOfMonth() returned
// the last day of the PREVIOUS month on every call, and currentMonth()/today() returned the
// previous month/day between 00:00 and 05:29 daily. See the notes in lib/report-catalog.ts.
const currentMonth = currentBusinessMonth;
const firstDayOfMonth = businessFirstDayOfMonth;
const today = businessToday;

function mask(value: unknown) {
  const text = String(value ?? "");
  return text.length > 4 ? `****${text.slice(-4)}` : "****";
}

function dateTime(value: string | null) {
  if (!value) return "No activity found";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function roleCanExport(report: DetailedReport | null, roles: string[], packCanExport: boolean) {
  if (!report || !packCanExport) return false;
  if (roles.includes("super_admin")) return true;
  const allowed = report.exportRoles?.length ? report.exportRoles : report.viewRoles;
  return allowed.some((role) => roles.includes(role));
}

function detectDuplicates(rows: Record<string, unknown>[], keys: string[]) {
  if (!rows.length || !keys.length) return 0;
  const seen = new Set<string>();
  let count = 0;
  for (const row of rows) {
    const key = keys.map((field) => String(row[field] ?? "")).join("|");
    if (seen.has(key)) count += 1;
    else seen.add(key);
  }
  return count;
}

// Direct browser downloads have been removed.
// Reports are requested via the secure email delivery workflow.

function StateBadge({ state }: { state: SourceHealth["state"] }) {
  const config = state === "available"
    ? { text: "Available", icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" }
    : state === "missing"
      ? { text: "Missing", icon: XCircle, cls: "border-rose-200 bg-rose-50 text-rose-700" }
      : { text: "Query error", icon: AlertTriangle, cls: "border-amber-200 bg-amber-50 text-amber-700" };
  const Icon = config.icon;
  return (
    <span className={classNames("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold", config.cls)}>
      <Icon className="h-3 w-3" /> {config.text}
    </span>
  );
}

export default function NativeReportsCenterV3() {
  const { roleKeys } = useWorkforceAccess();
  const [search, setSearch] = useState("");
  const [selectedPackCode, setSelectedPackCode] = useState<string | null>(null);
  const [perspectiveType, setPerspectiveType] = useState<PerspectiveType>("overview");
  const [selectedReport, setSelectedReport] = useState<DetailedReport | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [reportState, setReportState] = useState<ReportState>("idle");
  const [reportError, setReportError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({
    month: currentMonth(),
    from: firstDayOfMonth(),
    to: today(),
    branchId: "",
    processId: "",
  });
  const reportRef = useRef<HTMLDivElement>(null);
  const pageSize = 100;

  const catalogQuery = useQuery({
    queryKey: ["deep-section-reports"],
    queryFn: () => hrmsApi.get<DeepCatalogResponse>("/api/reports/deep-sections"),
    staleTime: 5 * 60_000,
  });
  const branchQuery = useQuery({
    queryKey: ["reports-branches"],
    queryFn: () => hrmsApi.get<MasterResponse<{ id: string; branch_name: string }>>("/api/org/branches"),
    staleTime: 10 * 60_000,
  });
  const processQuery = useQuery({
    queryKey: ["reports-processes"],
    queryFn: () => hrmsApi.get<MasterResponse<{ id: string; process_name: string }>>("/api/processes"),
    staleTime: 10 * 60_000,
  });

  const packs = useMemo(() => catalogQuery.data?.data ?? [], [catalogQuery.data]);
  const selectedPack = useMemo(
    () => packs.find((pack) => pack.code === selectedPackCode) ?? packs[0] ?? null,
    [packs, selectedPackCode]
  );
  const activePackCode = selectedPack?.code ?? "";
  const filteredPacks = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return packs;
    return packs.filter((pack) =>
      [pack.name, pack.shortName, pack.description, pack.businessOwner]
        .some((value) => value.toLowerCase().includes(term))
      || pack.perspectives.some((perspective) =>
        perspective.reports.some((report) => report.name.toLowerCase().includes(term))
      )
    );
  }, [packs, search]);

  const overviewParams = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
    return params.toString();
  }, [filters]);

  const overviewQuery = useQuery({
    queryKey: ["deep-section-overview", activePackCode, overviewParams],
    enabled: Boolean(activePackCode),
    queryFn: () => hrmsApi.get<OverviewResponse>(`/api/reports/deep-sections/${activePackCode}/overview?${overviewParams}`),
    staleTime: 60_000,
  });

  const overview = overviewQuery.data?.data;
  const branches = branchQuery.data?.data ?? [];
  const processes = processQuery.data?.data ?? [];
  const selectedPerspective = selectedPack?.perspectives.find((perspective) => perspective.type === perspectiveType);
  const canExportSelected = roleCanExport(selectedReport, roleKeys, selectedPack?.canExport ?? false);
  const duplicateCount = selectedReport ? detectDuplicates(rows, selectedReport.primaryKey) : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function selectPack(code: string) {
    setSelectedPackCode(code);
    setPerspectiveType("overview");
    setSelectedReport(null);
    setRows([]);
    setReportState("idle");
    setPage(1);
  }

  function selectPerspective(type: PerspectiveType) {
    setPerspectiveType(type);
    setSelectedReport(null);
    setRows([]);
    setReportState("idle");
    setPage(1);
  }

  function selectDetailedReport(report: DetailedReport) {
    setSelectedReport(report);
    setRows([]);
    setTotalCount(0);
    setPage(1);
    setReportState("idle");
    setReportError("");
    window.setTimeout(() => reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function runDetailedReport(targetPage = 1) {
    if (!selectedReport) return;
    setReportState("loading");
    setReportError("");
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
      params.set("limit", String(pageSize));
      params.set("offset", String((targetPage - 1) * pageSize));
      const response = await hrmsApi.get<ReportResponse>(
        `/api/reports/suite/${selectedReport.code}?${params.toString()}`,
        120_000
      );
      const data = response.data ?? [];
      setRows(data);
      setTotalCount(response.totalCount ?? response.meta?.totalCount ?? data.length);
      setPage(targetPage);
      setReportState(data.length ? "success" : "empty");
    } catch (error) {
      setReportState("error");
      setReportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRequestReport() {
    if (!selectedReport) return;
    setExportMessage("Submitting report request…");
    try {
      const res = await hrmsApi.post<{ requestReference: string; recipientEmailMasked: string; message: string }>(
        `/api/reports/${selectedReport.code}/request`,
        { filters }
      );
      setExportMessage(`Request ${res.requestReference} queued. Report will be emailed to ${res.recipientEmailMasked}.`);
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      window.setTimeout(() => setExportMessage(""), 8000);
    }
  }

  return (
    <HrmsModernShell
      eyebrow="REPORTS"
      title="Decision Center"
      description="Decision-ready section packs with registers, exceptions and compliance evidence."
      icon={<BarChart3 className="h-5 w-5" />}
    >
      <div className="grid min-h-[calc(100vh-150px)] gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Section Packs</p>
            <p className="mt-1 text-xs text-slate-500">
              {catalogQuery.isLoading ? "Loading…" : `${filteredPacks.length} available for your role`}
            </p>
          </div>
          <div className="max-h-[calc(100vh-225px)] space-y-1 overflow-y-auto p-2">
            {catalogQuery.isLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading sections
              </div>
            ) : catalogQuery.isError ? (
              <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">Unable to load report sections.</div>
            ) : filteredPacks.map((pack) => {
              const Icon = PACK_ICONS[pack.code] ?? BarChart3;
              const active = pack.code === activePackCode;
              return (
                <button
                  key={pack.code}
                  type="button"
                  onClick={() => selectPack(pack.code)}
                  className={classNames(
                    "flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition",
                    active
                      ? "border-blue-200 bg-blue-50 text-blue-800"
                      : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                  )}
                >
                  <span className={classNames(
                    "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold">{pack.shortName}</span>
                    <span className="mt-1 block text-[10px] text-slate-500">
                      {pack.reportCount} drill-downs · {pack.sourceGroups.length} source groups
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {!selectedPack ? (
            <div className="flex min-h-96 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-sm text-slate-500">
              No report section is available for your current role.
            </div>
          ) : (
            <>
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-3xl">
                      <div className="flex items-center gap-2 text-xs font-semibold text-blue-600">
                        <Database className="h-4 w-4" /> Owner: {selectedPack.businessOwner}
                      </div>
                      <h2 className="mt-2 text-xl font-bold text-slate-900">{selectedPack.name}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{selectedPack.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedPack.relatedRoutes.map((route) => (
                        <Link
                          key={route.path}
                          to={route.path}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {route.label} <ExternalLink className="h-3 w-3" />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="space-y-1 text-xs font-semibold text-slate-600">
                    Month
                    <input
                      type="month"
                      value={filters.month}
                      onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-normal"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-slate-600">
                    From
                    <input
                      type="date"
                      value={filters.from}
                      onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-normal"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-slate-600">
                    To
                    <input
                      type="date"
                      value={filters.to}
                      onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-normal"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-slate-600">
                    Branch
                    <select
                      value={filters.branchId}
                      onChange={(event) => setFilters((current) => ({ ...current, branchId: event.target.value }))}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-normal"
                    >
                      <option value="">All authorised branches</option>
                      {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-slate-600">
                    Process
                    <select
                      value={filters.processId}
                      onChange={(event) => setFilters((current) => ({ ...current, processId: event.target.value }))}
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-normal"
                    >
                      <option value="">All processes</option>
                      {processes.map((process) => <option key={process.id} value={process.id}>{process.process_name}</option>)}
                    </select>
                  </label>
                </div>

                <div className="flex gap-1 overflow-x-auto p-3">
                  {PERSPECTIVE_ORDER.map((type) => {
                    const perspective = selectedPack.perspectives.find((item) => item.type === type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => selectPerspective(type)}
                        className={classNames(
                          "whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold",
                          perspectiveType === type ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                        )}
                      >
                        {PERSPECTIVE_LABEL[type]}
                        {type !== "overview" && perspective ? ` (${perspective.reports.length})` : ""}
                      </button>
                    );
                  })}
                </div>
              </section>

              {perspectiveType === "overview" ? (
                <section className="space-y-4">
                  {overviewQuery.isLoading ? (
                    <div className="flex h-52 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Inspecting schema and report sources
                    </div>
                  ) : overviewQuery.isError || !overview ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
                      The section overview could not be generated. No zero values have been substituted.
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        {[
                          ["Schema coverage", `${overview.kpis.schemaCoveragePct}%`, ShieldCheck],
                          ["Required sources", `${overview.kpis.availableRequiredSources}/${overview.kpis.requiredSources}`, Database],
                          ["Known rows", overview.kpis.knownRows.toLocaleString("en-IN"), Table2],
                          ["Known issues", overview.kpis.knownIssues.toLocaleString("en-IN"), AlertTriangle],
                          ["Mapping gaps", overview.kpis.mappingExceptions.toLocaleString("en-IN"), Network],
                          ["Latest activity", overview.kpis.latestActivity ? dateTime(overview.kpis.latestActivity) : "Unavailable", RefreshCw],
                        ].map(([label, value, Icon]) => {
                          const MetricIcon = Icon as LucideIcon;
                          return (
                            <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                <MetricIcon className="h-4 w-4" /> {String(label)}
                              </div>
                              <p className="mt-2 text-lg font-bold text-slate-900">{String(value)}</p>
                            </div>
                          );
                        })}
                      </div>

                      {overview.alerts.length > 0 && (
                        <div className="space-y-2">
                          {overview.alerts.map((alert) => (
                            <div
                              key={alert.code}
                              className={classNames(
                                "flex items-start gap-3 rounded-xl border p-3 text-sm",
                                alert.severity === "critical" && "border-rose-200 bg-rose-50 text-rose-700",
                                alert.severity === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
                                alert.severity === "info" && "border-blue-200 bg-blue-50 text-blue-700"
                              )}
                            >
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                              <span>{alert.message}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
                        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                          <div className="border-b border-slate-100 px-4 py-3">
                            <h3 className="text-sm font-bold text-slate-900">Source coverage and data health</h3>
                            <p className="mt-1 text-xs text-slate-500">Missing and failed sources are shown explicitly and are never converted to zero.</p>
                          </div>
                          <div className="divide-y divide-slate-100">
                            {overview.sources.map((source) => (
                              <div key={source.key} className="p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <h4 className="text-sm font-bold text-slate-800">{source.label}</h4>
                                      <StateBadge state={source.state} />
                                      {!source.required && <span className="text-[10px] text-slate-400">Optional</span>}
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">{source.description}</p>
                                    <p className="mt-2 font-mono text-[10px] text-slate-400">
                                      {source.selectedTable ?? source.missingCandidates.join(" · ")}
                                    </p>
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-right text-xs">
                                    <span className="text-slate-400">Rows</span><b>{source.rowCount == null ? "Unavailable" : source.rowCount.toLocaleString("en-IN")}</b>
                                    <span className="text-slate-400">Issues</span><b>{source.issueCount == null ? "Unavailable" : source.issueCount.toLocaleString("en-IN")}</b>
                                    <span className="text-slate-400">Mapping gaps</span><b>{source.missingBranchMappings == null && source.missingProcessMappings == null ? "N/A" : ((source.missingBranchMappings ?? 0) + (source.missingProcessMappings ?? 0)).toLocaleString("en-IN")}</b>
                                  </div>
                                </div>
                                {source.statusBreakdown.length > 0 && (
                                  <div className="mt-3 flex flex-wrap gap-1.5">
                                    {source.statusBreakdown.slice(0, 8).map((item) => (
                                      <span key={item.status} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] text-slate-600">
                                        {item.status}: <b>{item.count.toLocaleString("en-IN")}</b>
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {source.error && <p className="mt-2 text-xs text-rose-600">{source.error}</p>}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><BookOpen className="h-4 w-4 text-blue-600" /> Decisions this pack must support</h3>
                            <ol className="mt-3 space-y-3">
                              {selectedPack.decisionQuestions.map((question, index) => (
                                <li key={question} className="flex gap-2 text-xs leading-5 text-slate-600">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold text-blue-700">{index + 1}</span>
                                  {question}
                                </li>
                              ))}
                            </ol>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><FileCheck2 className="h-4 w-4 text-emerald-600" /> Compliance controls</h3>
                            <div className="mt-3 space-y-2">
                              {selectedPack.complianceControls.map((control) => (
                                <div key={control} className="flex items-start gap-2 text-xs text-slate-600">
                                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> {control}
                                </div>
                              ))}
                            </div>
                            <div className="mt-4 rounded-lg bg-rose-50 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-wide text-rose-600">Sensitive domains</p>
                              <p className="mt-1 text-xs leading-5 text-rose-700">{selectedPack.sensitiveDomains.join(" · ")}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              ) : (
                <section className="space-y-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-900">{selectedPerspective?.title ?? PERSPECTIVE_LABEL[perspectiveType]}</h3>
                    <p className="mt-1 text-xs text-slate-500">{selectedPerspective?.description}</p>
                    {selectedPerspective?.missingReportCodes.length ? (
                      <p className="mt-2 text-[10px] text-amber-700">
                        Planned datasets not yet implemented: {selectedPerspective.missingReportCodes.join(", ")}
                      </p>
                    ) : null}
                  </div>

                  {selectedPerspective?.reports.length ? (
                    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                      {selectedPerspective.reports.map((report) => (
                        <button
                          key={report.code}
                          type="button"
                          onClick={() => selectDetailedReport(report)}
                          className={classNames(
                            "rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md",
                            selectedReport?.code === report.code ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-bold text-slate-900">{report.name}</h4>
                              <p className="mt-1 text-xs leading-5 text-slate-500">{report.description}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                            <span className="rounded bg-slate-100 px-2 py-1">{report.rowGrain}</span>
                            <span className="rounded bg-slate-100 px-2 py-1">{report.columns.length} columns</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                      <Database className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-3 text-sm font-semibold text-slate-700">No dedicated drill-down dataset yet</p>
                      <p className="mt-1 text-xs text-slate-500">The section overview still reports live schema coverage and source health. A detailed dataset must be added only after its grain, source and controls are approved.</p>
                    </div>
                  )}
                </section>
              )}

              {selectedReport && (
                <section ref={reportRef} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Detailed drill-down</p>
                        <h3 className="mt-1 text-base font-bold text-slate-900">{selectedReport.name}</h3>
                        <p className="mt-1 text-xs text-slate-500">Grain: {selectedReport.rowGrain} · Key: {selectedReport.primaryKey.join(", ")}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => runDetailedReport(1)}
                          disabled={reportState === "loading"}
                          className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-60"
                        >
                          {reportState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          Run report
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRequestReport()}
                          disabled={!canExportSelected}
                          title={canExportSelected ? "Request report — will be sent to your official email" : "Your role cannot export this report"}
                          className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Mail className="h-4 w-4" /> Request by Email
                        </button>
                      </div>
                    </div>
                    {selectedReport.calculationNotes && (
                      <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        <b>Calculation:</b> {selectedReport.calculationNotes}
                      </div>
                    )}
                    {exportMessage && <p className="mt-2 text-xs font-semibold text-slate-600">{exportMessage}</p>}
                  </div>

                  {reportState === "idle" && (
                    <div className="py-12 text-center text-sm text-slate-500">Run the report using the shared section filters.</div>
                  )}
                  {reportState === "loading" && (
                    <div className="flex items-center justify-center py-12 text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running report</div>
                  )}
                  {reportState === "error" && (
                    <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{reportError}</div>
                  )}
                  {reportState === "empty" && (
                    <div className="py-12 text-center text-sm text-slate-500">No records matched the selected filters.</div>
                  )}
                  {reportState === "success" && (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
                        <span>{rows.length.toLocaleString("en-IN")} shown of {totalCount.toLocaleString("en-IN")}</span>
                        {duplicateCount > 0 && (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> {duplicateCount} duplicate grain keys detected</span>
                        )}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse text-xs">
                          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                              {selectedReport.columns.map((column) => (
                                <th key={column.key} className="whitespace-nowrap border-b border-slate-200 px-3 py-2.5">{column.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {rows.map((row, rowIndex) => (
                              <tr key={`${rowIndex}-${selectedReport.primaryKey.map((key) => String(row[key] ?? "")).join("-")}`} className="hover:bg-slate-50">
                                {selectedReport.columns.map((column: ColumnDef) => (
                                  <td key={column.key} className={classNames("max-w-xs whitespace-nowrap px-3 py-2.5 text-slate-700", column.align === "right" && "text-right", column.align === "center" && "text-center")}>
                                    {column.sensitive && !canExportSelected ? mask(row[column.key]) : formatValue(row[column.key], column.format)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-100 p-3">
                        <button
                          type="button"
                          disabled={page <= 1}
                          onClick={() => runDetailedReport(page - 1)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"
                        >
                          <ChevronLeft className="h-4 w-4" /> Previous
                        </button>
                        <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                        <button
                          type="button"
                          disabled={page >= totalPages}
                          onClick={() => runDetailedReport(page + 1)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold disabled:opacity-40"
                        >
                          Next <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </HrmsModernShell>
  );
}
