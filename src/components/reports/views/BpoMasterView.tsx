import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Mail,
  FileSearch,
  FileSpreadsheet,
  Filter,
  History,
  Library,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  Users,
  Workflow,
} from "lucide-react";
import { HrmsModernShell } from "@/components/ui/hrms-modern";
import { hrmsApi } from "@/lib/hrmsApi";
import { currentBusinessMonth, businessFirstDayOfMonth, businessToday } from "@/lib/report-catalog";

type ColumnFormat =
  | "text" | "number" | "currency" | "percentage" | "date" | "month"
  | "time" | "duration" | "status" | "boolean" | "email" | "phone" | "masked";

interface MasterColumn {
  key: string;
  label: string;
  format: ColumnFormat;
  sensitive?: boolean;
  description?: string;
}

interface MasterDefinition {
  code: string;
  name: string;
  domain: string;
  description: string;
  rowGrain: string;
  primaryKey: string[];
  viewRoles: string[];
  exportRoles: string[];
  dateStandard: "DD-MMM-YYYY";
  employeeCodePolicy: "MANDATORY";
  aggregateEmployeeCode?: "AGGREGATE";
  columns: MasterColumn[];
  sourceDomains: string[];
  controlNotes: string[];
  canExport: boolean;
}

interface CatalogResponse {
  success: boolean;
  data: MasterDefinition[];
  meta: {
    reportCount: number;
    totalMasterReportCount: number;
    employeeCodePolicy: string;
    dateStandard: string;
    headerStandard: string;
    sourcePolicy?: string;
    accuracyPolicy?: string;
  };
}

interface FieldLineage {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string | null;
  transformation: string;
  confidence: "EXACT" | "DERIVED" | "UNAVAILABLE";
}

interface VerificationSummary {
  runtimeSchemaVerified: boolean;
  exactMappedFieldCount: number;
  derivedMappedFieldCount: number;
  unavailableFieldCount: number;
  duplicateGrainCount: number;
  sourceRowCount: number;
  distinctGrainCount: number;
  accuracyStatus: "SCHEMA_VERIFIED" | "DUPLICATE_GRAIN_FOUND";
}

interface RunResult {
  definition: MasterDefinition;
  generatedAt: string;
  sourceState: "available" | "unavailable";
  sourceTable: string | null;
  rows: Record<string, unknown>[];
  totalCount: number;
  filters: Record<string, unknown>;
  coverage: {
    available: string[];
    unavailable: string[];
    percentage: number;
  };
  lineage?: Record<string, FieldLineage>;
  verification?: VerificationSummary;
  accuracyStatement?: string;
  sensitiveDataMasked?: boolean;
  message: string | null;
}

interface RunResponse {
  success: boolean;
  data: RunResult;
}

interface MasterResponse<T> {
  data: T[];
}

const DOMAIN_ICONS: Record<string, typeof BarChart3> = {
  OPERATIONS: Workflow,
  "EMPLOYEE PERFORMANCE": Users,
  "CLIENT PERFORMANCE": Building2,
  "WFM / ATTENDANCE": RefreshCw,
  HR: Users,
  PAYROLL: FileSpreadsheet,
  FINANCE: BarChart3,
  "QUALITY / COMPLIANCE": ShieldCheck,
  "RECRUITMENT / TRAINING": Users,
  "ADMIN / IT / FACILITY": Database,
  "HIGHER MANAGEMENT": BarChart3,
  "AUDIT / COMPLIANCE / CONTROL": ShieldCheck,
  "END-TO-END EMPLOYEE JOURNEY": History,
  "DATA GOVERNANCE / REPORT ACCURACY": FileSearch,
};

// Shared business-timezone helpers rather than UTC substrings of toISOString(). The local
// copies these replace were wrong in IST: firstDayOfMonth() returned the last day of the
// PREVIOUS month on every call, so every BPO report's default From date started in the wrong
// month. See the notes in lib/report-catalog.ts.
const currentMonth = currentBusinessMonth;
const firstDayOfMonth = businessFirstDayOfMonth;
const today = businessToday;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function displayValue(value: unknown, format: ColumnFormat) {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "currency") {
    const number = Number(value);
    return Number.isFinite(number)
      ? number.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
      : String(value);
  }
  if (format === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(value);
  }
  if (format === "percentage") {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%` : String(value);
  }
  return String(value);
}

function duplicateCount(rows: Record<string, unknown>[], keys: string[]) {
  if (!rows.length || !keys.length) return 0;
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const signature = keys.map((key) => String(row[key] ?? "")).join("|");
    if (seen.has(signature)) duplicates += 1;
    else seen.add(signature);
  }
  return duplicates;
}

function reportFileName(code: string) {
  // businessToday(), not a UTC substring: in IST a download taken before 05:30 was stamped
  // with the previous day's date, so the filename disagreed with the data inside it.
  return `${code.toUpperCase()}_${businessToday()}.xlsx`;
}

export default function BpoMasterReports() {
  const [search, setSearch] = useState("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 250;
  const [filters, setFilters] = useState({
    month: currentMonth(),
    from: firstDayOfMonth(),
    to: today(),
    branchId: "",
    processId: "",
    employeeCode: "",
    clientId: "",
  });

  const catalogQuery = useQuery({
    queryKey: ["bpo-master-report-catalog"],
    queryFn: () => hrmsApi.get<CatalogResponse>("/api/reports/bpo-master"),
    staleTime: 5 * 60_000,
  });
  const branchQuery = useQuery({
    queryKey: ["bpo-master-branches"],
    queryFn: () => hrmsApi.get<MasterResponse<{ id: string; branch_name: string }>>("/api/org/branches"),
    staleTime: 10 * 60_000,
  });
  const processQuery = useQuery({
    queryKey: ["bpo-master-processes"],
    queryFn: () => hrmsApi.get<MasterResponse<{ id: string; process_name: string }>>("/api/processes"),
    staleTime: 10 * 60_000,
  });
  const clientQuery = useQuery({
    queryKey: ["bpo-master-clients"],
    queryFn: () => hrmsApi.get<MasterResponse<{ id: string; client_name: string }>>("/api/clients"),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const reports = useMemo(() => catalogQuery.data?.data ?? [], [catalogQuery.data]);
  const selectedReport = useMemo(() => reports.find((report) => report.code === selectedCode) ?? reports[0] ?? null, [reports, selectedCode]);
  const activeCode = selectedReport?.code ?? "";
  const filteredReports = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return reports;
    return reports.filter((report) =>
      [report.name, report.domain, report.description, report.rowGrain, ...report.sourceDomains]
        .some((value) => value.toLowerCase().includes(term))
    );
  }, [reports, search]);
  const rows = runResult?.rows ?? [];
  const displayedDuplicates = runResult?.verification?.duplicateGrainCount
    ?? (runResult ? duplicateCount(rows, runResult.definition.primaryKey) : 0);
  const totalPages = Math.max(1, Math.ceil((runResult?.totalCount ?? 0) / pageSize));

  function selectReport(code: string) {
    setSelectedCode(code);
    setRunResult(null);
    setRunError("");
    setPage(1);
  }

  function buildParams(targetPage: number, exportMode = false) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
    params.set("limit", String(exportMode ? 100000 : pageSize));
    params.set("offset", String(exportMode ? 0 : (targetPage - 1) * pageSize));
    if (exportMode) params.set("export", "true");
    return params;
  }

  async function runReport(targetPage = 1) {
    if (!selectedReport) return;
    setRunning(true);
    setRunError("");
    try {
      const response = await hrmsApi.get<RunResponse>(
        `/api/reports/bpo-master/${selectedReport.code}?${buildParams(targetPage).toString()}`,
        180_000
      );
      setRunResult(response.data);
      setPage(targetPage);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Report execution failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleRequestReport() {
    if (!selectedReport) return;
    setExportMessage("SUBMITTING REPORT REQUEST…");
    try {
      const requestFilters: Record<string, string> = {};
      Object.entries(filters).forEach(([k, v]) => { if (v) requestFilters[k] = v; });
      const res = await hrmsApi.post<{ requestReference: string; recipientEmailMasked: string; message: string }>(
        `/api/reports/${selectedReport.code}/request`,
        { filters: requestFilters }
      );
      setExportMessage(`REQUEST ${res.requestReference} QUEUED — REPORT WILL BE EMAILED TO ${res.recipientEmailMasked}`);
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message.toUpperCase() : "REQUEST FAILED");
    } finally {
      window.setTimeout(() => setExportMessage(""), 8000);
    }
  }

  return (
    <HrmsModernShell
      eyebrow="REPORTS"
      title="BPO Master Reports"
      description="Source-governed master reports with field lineage and accuracy certification."
      icon={<FileSpreadsheet className="h-5 w-5" />}
    >
      <div className="space-y-4">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[
            ["MASTER REPORTS", catalogQuery.data?.meta.totalMasterReportCount ?? 14, FileSpreadsheet],
            ["EMPLOYEE CODE", "MANDATORY", Users],
            ["DATE FORMAT", "DD-MMM-YYYY", RefreshCw],
            ["HEADERS", "UPPER CASE", Table2],
            ["BRANCH SCOPE", "FAIL CLOSED", ShieldCheck],
            ["SOURCE POLICY", "EXACT OR UNAVAILABLE", FileSearch],
          ].map(([label, value, Icon]) => {
            const MetricIcon = Icon as typeof BarChart3;
            return (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <MetricIcon className="h-4 w-4" /> {String(label)}
                </div>
                <p className="mt-2 text-lg font-black text-slate-900">{String(value)}</p>
              </div>
            );
          })}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-700">
            <Filter className="h-4 w-4" /> COMMON REPORT FILTERS
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">REPORT MONTH
              <input type="month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold" />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">FROM DATE
              <input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold" />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">TO DATE
              <input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold" />
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">BRANCH
              <select value={filters.branchId} onChange={(event) => setFilters((current) => ({ ...current, branchId: event.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold uppercase">
                <option value="">ALL AUTHORISED</option>
                {(branchQuery.data?.data ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">PROCESS
              <select value={filters.processId} onChange={(event) => setFilters((current) => ({ ...current, processId: event.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold uppercase">
                <option value="">ALL PROCESSES</option>
                {(processQuery.data?.data ?? []).map((process) => <option key={process.id} value={process.id}>{process.process_name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">CLIENT
              <select value={filters.clientId} onChange={(event) => setFilters((current) => ({ ...current, clientId: event.target.value }))} className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold uppercase">
                <option value="">ALL CLIENTS</option>
                {(clientQuery.data?.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.client_name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[10px] font-bold uppercase text-slate-500">EMPLOYEE CODE
              <input value={filters.employeeCode} onChange={(event) => setFilters((current) => ({ ...current, employeeCode: event.target.value.toUpperCase() }))} placeholder="EMPLOYEE CODE" className="h-9 w-full rounded-lg border border-slate-200 px-2 text-xs font-semibold uppercase" />
            </label>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-xs font-black uppercase tracking-widest text-slate-700">SELECT MASTER REPORT</p>
              <p className="mt-1 text-[10px] uppercase text-slate-400">COMPREHENSIVE DOMAIN REPORTS + CROSS-MODULE CONTROL LEDGERS</p>
            </div>
            <div className="max-h-[780px] space-y-2 overflow-y-auto p-2">
              {catalogQuery.isLoading ? (
                <div className="flex items-center justify-center py-12 text-xs font-bold text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> LOADING REPORTS</div>
              ) : filteredReports.map((report) => {
                const Icon = DOMAIN_ICONS[report.domain] ?? FileSpreadsheet;
                const active = report.code === activeCode;
                return (
                  <button key={report.code} type="button" onClick={() => selectReport(report.code)} className={classNames("w-full rounded-xl border p-3 text-left transition", active ? "border-blue-300 bg-blue-50 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50")}>
                    <div className="flex items-start gap-3">
                      <span className={classNames("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600")}><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-wider text-blue-600">{report.domain}</p>
                        <h3 className="mt-1 text-xs font-black leading-5 text-slate-900">{report.name}</h3>
                        <p className="mt-1 text-[10px] leading-4 text-slate-500">{report.columns.length} COLUMNS · {report.rowGrain}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-w-0 space-y-4">
            {selectedReport && (
              <>
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="max-w-4xl">
                        <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">{selectedReport.domain}</p>
                        <h2 className="mt-2 text-xl font-black text-slate-900">{selectedReport.name}</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{selectedReport.description}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">GRAIN: {selectedReport.rowGrain}</span>
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">EMPLOYEE CODE: MANDATORY</span>
                          <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">DATE: DD-MMM-YYYY</span>
                          <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-700">HEADERS: UPPER CASE</span>
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">SOURCE: EXACT / DERIVED / UNAVAILABLE</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => runReport(1)} disabled={running} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-black uppercase text-white disabled:opacity-50">
                          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} RUN REPORT
                        </button>
                        <button type="button" onClick={handleRequestReport} disabled={running} className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-black uppercase text-white hover:bg-blue-700 disabled:opacity-50">
                          <Mail className="h-4 w-4" /> REQUEST BY EMAIL
                        </button>
                      </div>
                    </div>
                    {exportMessage && <p className="mt-3 text-xs font-black uppercase text-slate-600">{exportMessage}</p>}
                  </div>
                  <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">PRIMARY KEY</p>
                      <p className="mt-1 text-xs font-bold text-slate-700">{selectedReport.primaryKey.join(" + ")}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">SOURCE DOMAINS</p>
                      <p className="mt-1 text-xs font-bold leading-5 text-slate-700">{selectedReport.sourceDomains.join(" · ")}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">CONTROL RULES</p>
                      <p className="mt-1 text-xs font-bold leading-5 text-slate-700">{selectedReport.controlNotes.join(" · ")}</p>
                    </div>
                  </div>
                </section>

                {runError && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-bold uppercase text-rose-700">{runError}</div>}

                {runResult && (
                  <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-7">
                      <div><p className="text-[10px] font-black uppercase text-slate-400">SOURCE STATE</p><p className={classNames("mt-1 text-sm font-black uppercase", runResult.sourceState === "available" ? "text-emerald-700" : "text-rose-700")}>{runResult.sourceState}</p></div>
                      <div><p className="text-[10px] font-black uppercase text-slate-400">SOURCE TABLE</p><p className="mt-1 break-words font-mono text-xs font-bold text-slate-700">{runResult.sourceTable ?? "UNAVAILABLE"}</p></div>
                      <div><p className="text-[10px] font-black uppercase text-slate-400">COLUMN COVERAGE</p><p className="mt-1 text-sm font-black text-slate-900">{runResult.coverage.percentage}%</p></div>
                      <div><p className="text-[10px] font-black uppercase text-slate-400">SOURCE ROWS</p><p className="mt-1 text-sm font-black text-slate-900">{(runResult.verification?.sourceRowCount ?? runResult.totalCount).toLocaleString("en-IN")}</p></div>
                      <div><p className="text-[10px] font-black uppercase text-slate-400">DISTINCT GRAIN</p><p className="mt-1 text-sm font-black text-slate-900">{(runResult.verification?.distinctGrainCount ?? runResult.totalCount).toLocaleString("en-IN")}</p></div>
                      <div><p className="text-[10px] font-black uppercase text-slate-400">DUPLICATE KEYS</p><p className={classNames("mt-1 text-sm font-black", displayedDuplicates ? "text-amber-700" : "text-emerald-700")}>{displayedDuplicates.toLocaleString("en-IN")}</p></div>
                      <div><p className="text-[10px] font-black uppercase text-slate-400">MAPPING</p><p className="mt-1 text-xs font-black text-slate-700">{runResult.verification ? `${runResult.verification.exactMappedFieldCount} EXACT · ${runResult.verification.derivedMappedFieldCount} DERIVED · ${runResult.verification.unavailableFieldCount} UNAVAILABLE` : "NOT REPORTED"}</p></div>
                    </div>

                    {runResult.accuracyStatement && (
                      <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold uppercase leading-5 text-amber-800">
                        <AlertTriangle className="mr-2 inline h-4 w-4" /> {runResult.accuracyStatement}
                      </div>
                    )}
                    {runResult.message && <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold uppercase text-amber-700">{runResult.message}</div>}
                    {runResult.coverage.unavailable.length > 0 && (
                      <div className="mx-4 mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">UNAVAILABLE FROM CURRENT SOURCE SCHEMA ({runResult.coverage.unavailable.length})</p>
                        <p className="mt-2 text-[10px] leading-5 text-slate-500">{runResult.coverage.unavailable.join(" · ")}</p>
                      </div>
                    )}

                    {runResult.sourceState === "available" && rows.length > 0 ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs font-bold uppercase text-slate-500">
                          <span>{rows.length.toLocaleString("en-IN")} ROWS SHOWN OF {runResult.totalCount.toLocaleString("en-IN")}</span>
                          <div className="flex items-center gap-3">
                            {displayedDuplicates > 0 ? <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-4 w-4" /> DUPLICATE GRAIN DETECTED</span> : <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> GRAIN CHECK PASSED</span>}
                            <span>{runResult.coverage.available.length} AVAILABLE COLUMNS</span>
                            {runResult.sensitiveDataMasked && <span className="text-violet-700">SENSITIVE DATA MASKED</span>}
                          </div>
                        </div>
                        <div className="max-h-[650px] overflow-auto border-y border-slate-100">
                          <table className="min-w-max border-collapse text-[11px]">
                            <thead className="sticky top-0 z-10 bg-slate-900 text-left text-[10px] font-black uppercase tracking-wider text-white">
                              <tr>{selectedReport.columns.map((column) => {
                                const lineage = runResult.lineage?.[column.key];
                                const title = [column.description, lineage ? `SOURCE: ${lineage.sourceSchema}.${lineage.sourceTable}.${lineage.sourceColumn ?? "DERIVED"} | ${lineage.transformation} | ${lineage.confidence}` : null].filter(Boolean).join("\n");
                                return <th key={column.key} title={title} className="whitespace-nowrap border-r border-slate-700 px-3 py-3">{column.label}</th>;
                              })}</tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {rows.map((row, index) => (
                                <tr key={`${index}-${selectedReport.primaryKey.map((key) => String(row[key] ?? "")).join("-")}`} className="hover:bg-blue-50/40">
                                  {selectedReport.columns.map((column) => <td key={column.key} className="max-w-xs whitespace-nowrap border-r border-slate-100 px-3 py-2 text-slate-700">{column.sensitive && !selectedReport.canExport ? "****" : displayValue(row[column.key], column.format)}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex items-center justify-between p-3">
                          <button type="button" disabled={page <= 1 || running} onClick={() => runReport(page - 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black uppercase disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> PREVIOUS</button>
                          <span className="text-xs font-black uppercase text-slate-500">PAGE {page} OF {totalPages}</span>
                          <button type="button" disabled={page >= totalPages || running} onClick={() => runReport(page + 1)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black uppercase disabled:opacity-40">NEXT <ChevronRight className="h-4 w-4" /></button>
                        </div>
                      </>
                    ) : runResult.sourceState === "available" ? (
                      <div className="py-12 text-center text-xs font-bold uppercase text-slate-500">NO RECORDS MATCHED THE SELECTED FILTERS</div>
                    ) : null}
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </HrmsModernShell>
  );
}
