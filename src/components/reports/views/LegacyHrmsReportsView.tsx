import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Search } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

// ── types ─────────────────────────────────────────────────────────────────────

type ReportMeta = { code: string; label: string };

type LegacyColumn = {
  key: string;
  label: string;
  format: string;
  align?: string;
};

type LegacyResult = {
  columns: LegacyColumn[];
  rows: Record<string, unknown>[];
  total: number;
  summary?: Record<string, number>;
  truncated?: boolean;
  displayLimit?: number;
};

// ── helpers ───────────────────────────────────────────────────────────────────

function unwrap<T>(r: unknown): T {
  return ((r as any)?.data?.data ?? (r as any)?.data ?? r) as T;
}

/** Rolling 36-month list for the month picker */
const MONTH_OPTIONS = Array.from({ length: 36 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});

function formatCell(value: unknown, format: string): string {
  if (value == null || value === "") return "—";
  const n = Number(value);

  if (format === "currency" && !isNaN(n)) {
    return `₹${n.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (format === "number" && !isNaN(n)) return n.toLocaleString("en-IN");
  if ((format === "date" || format === "datetime") && String(value).length >= 10) {
    try {
      return new Date(String(value)).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch { return String(value); }
  }
  if (format === "boolean") {
    return value === true || value === 1 || value === "1" ? "Yes" : "No";
  }
  if (format === "status") {
    return String(value)
      .replace(/_/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  return String(value);
}

// ── component ─────────────────────────────────────────────────────────────────

// Filter mode: month-picker vs date-range
type FilterMode = "month" | "range";

export default function LegacyHrmsReportsView() {
  const [selected, setSelected]     = useState<string>("");
  const [filterMode, setFilterMode] = useState<FilterMode>("month");
  const [month, setMonth]           = useState<string>("");
  const [fromDate, setFromDate]     = useState<string>("");
  const [toDate, setToDate]         = useState<string>("");
  const [branch, setBranch]         = useState<string>("");
  const [process, setProcess]       = useState<string>("");
  const [empCode, setEmpCode]       = useState<string>("");
  const [empName, setEmpName]       = useState<string>("");
  const [runKey, setRunKey]         = useState(0);
  const tokenRef = useRef<string>(
    localStorage.getItem("hrms_access_token") ?? localStorage.getItem("token") ?? ""
  );

  // ── report list ──────────────────────────────────────────────────────────
  const { data: listRaw } = useQuery({
    queryKey: ["legacy-report-list"],
    queryFn: () => hrmsApi.get("/api/legacy-reports"),
    staleTime: Infinity,
  });
  const reports: ReportMeta[] = unwrap<ReportMeta[]>(listRaw) ?? [];

  // ── branch list for dropdown ──────────────────────────────────────────────
  const { data: branchRaw } = useQuery({
    queryKey: ["branch-master-list"],
    queryFn: () => hrmsApi.get("/api/branches"),
    staleTime: 300_000,
  });
  const branchOptions: string[] = (() => {
    const raw = unwrap<{ branch_name?: string; name?: string }[]>(branchRaw) ?? [];
    return Array.from(new Set(raw.map(b => b.branch_name ?? b.name ?? "").filter(Boolean))).sort();
  })();

  // ── process list for dropdown ────────────────────────────────────────────
  const { data: procRaw } = useQuery({
    queryKey: ["process-master-list"],
    queryFn: () => hrmsApi.get("/api/processes"),
    staleTime: 300_000,
  });
  const processOptions: string[] = (() => {
    const raw = unwrap<{ process_name?: string; name?: string }[]>(procRaw) ?? [];
    return Array.from(new Set(raw.map(p => p.process_name ?? p.name ?? "").filter(Boolean))).sort();
  })();

  // ── build params ─────────────────────────────────────────────────────────
  function buildParams(): Record<string, string> {
    const p: Record<string, string> = {};
    if (filterMode === "month" && month) p.month = month;
    if (filterMode === "range" && fromDate) p.from_date = fromDate;
    if (filterMode === "range" && toDate)   p.to_date   = toDate;
    if (branch)  p.branch         = branch;
    if (process) p.process        = process;
    if (empCode) p.employee_code  = empCode;
    if (empName) p.employee_name  = empName;
    return p;
  }

  const {
    data: resultRaw,
    isFetching,
    error,
    isSuccess,
  } = useQuery({
    queryKey: ["legacy-report-data", selected, runKey, filterMode, month, fromDate, toDate, branch, process, empCode, empName],
    queryFn: () => {
      const params = buildParams();
      const qs = new URLSearchParams(params).toString();
      return hrmsApi.get(`/api/legacy-reports/${selected}${qs ? `?${qs}` : ""}`);
    },
    enabled: !!selected && runKey > 0,
    staleTime: 0,
  });

  const result: LegacyResult | null =
    isSuccess && resultRaw ? (unwrap<LegacyResult>(resultRaw) ?? null) : null;

  // ── CSV export ───────────────────────────────────────────────────────────
  function handleExport() {
    const token = localStorage.getItem("hrms_access_token") ?? localStorage.getItem("token") ?? tokenRef.current;
    const params = buildParams();
    const qs = new URLSearchParams(params).toString();
    const url = `/api/legacy-reports/${selected}/export${qs ? `?${qs}` : ""}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const bUrl = URL.createObjectURL(blob);
        const suffix = month || (fromDate ? `${fromDate}_${toDate ?? ""}` : "");
        const a = Object.assign(document.createElement("a"), {
          href: bUrl,
          download: `legacy-${selected}${suffix ? `-${suffix}` : ""}.csv`,
        });
        a.click();
        URL.revokeObjectURL(bUrl);
      });
  }

  // ── report label for header ───────────────────────────────────────────────
  const selectedLabel = reports.find(r => r.code === selected)?.label ?? "";

  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-700
                        bg-slate-50 dark:bg-slate-900 overflow-y-auto flex flex-col">
        <div className="p-3 border-b border-slate-200 dark:border-slate-700">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Legacy HRMS Reports
          </p>
          <p className="text-xs text-slate-400 mt-0.5">db_bill data · exact format</p>
        </div>

        <nav className="p-2 space-y-0.5 flex-1">
          {reports.map(r => (
            <button
              key={r.code}
              onClick={() => { setSelected(r.code); setRunKey(0); }}
              className={[
                "w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5",
                selected === r.code
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-medium"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800",
              ].join(" ")}
            >
              <FileText className="w-3 h-3 shrink-0 opacity-60" />
              <span className="truncate">{r.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main area ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">Select a report</p>
              <p className="text-xs mt-1 opacity-70">Choose one from the sidebar</p>
            </div>
          </div>
        ) : (
          <>
            {/* Filter bar - single compact row */}
            <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700
                            bg-white dark:bg-slate-950 shrink-0">
              <div className="flex flex-wrap gap-2 items-center">
                {/* Date mode toggle */}
                <div className="flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden h-7">
                  <button
                    className={`px-2 text-[11px] font-medium transition-colors ${filterMode === "month" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                    onClick={() => setFilterMode("month")}
                  >Month</button>
                  <button
                    className={`px-2 text-[11px] font-medium transition-colors border-l border-slate-200 dark:border-slate-700 ${filterMode === "range" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"}`}
                    onClick={() => setFilterMode("range")}
                  >Range</button>
                </div>

                {filterMode === "month" ? (
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger className="w-28 h-7 text-[11px]">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Current</SelectItem>
                      {MONTH_OPTIONS.map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                      className="w-32 h-7 text-[11px]" placeholder="From" />
                    <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                      className="w-32 h-7 text-[11px]" placeholder="To" />
                  </>
                )}

                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />

                {/* Branch dropdown */}
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger className="w-40 h-7 text-[11px]">
                    <SelectValue placeholder="All Branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Branches</SelectItem>
                    {branchOptions.map(b => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Process dropdown */}
                <Select value={process} onValueChange={setProcess}>
                  <SelectTrigger className="w-40 h-7 text-[11px]">
                    <SelectValue placeholder="All Processes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Processes</SelectItem>
                    {processOptions.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="w-px h-5 bg-slate-200 dark:bg-slate-700" />

                {/* Employee code */}
                <Input value={empCode} onChange={e => setEmpCode(e.target.value)}
                  placeholder="Emp Code" className="w-24 h-7 text-[11px]" />

                {/* Employee name search */}
                <Input value={empName} onChange={e => setEmpName(e.target.value)}
                  placeholder="Name" className="w-28 h-7 text-[11px]" />

                <Button size="sm" className="h-7 px-3 text-[11px]" onClick={() => setRunKey(k => k + 1)} disabled={isFetching}>
                  <Search className="w-3 h-3 mr-1" />
                  {isFetching ? "..." : "Run"}
                </Button>

                {result && result.total > 0 && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={handleExport}>
                    <Download className="w-3 h-3 mr-1" />
                    CSV
                  </Button>
                )}

                <div className="ml-auto flex items-center gap-2">
                  {selectedLabel && (
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate max-w-[150px]">
                      {selectedLabel}
                    </span>
                  )}
                  {result != null && (
                    <Badge variant="secondary" className="text-[10px] h-5">
                      {result.total.toLocaleString("en-IN")}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
              {error && (
                <div className="p-4 text-sm text-red-600">
                  Error: {(error as Error).message}
                </div>
              )}

              {result?.truncated && (
                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-1.5">
                  <span className="font-semibold">Note:</span>
                  Showing first {result.displayLimit?.toLocaleString("en-IN")} rows.
                  Apply branch or employee filters to narrow results, or use{" "}
                  <button
                    className="underline font-medium"
                    onClick={handleExport}
                  >
                    Export CSV
                  </button>{" "}
                  for the full dataset.
                </div>
              )}

              {runKey > 0 && !isFetching && result && result.rows.length === 0 && (
                <div className="p-8 text-center text-slate-400">
                  <p className="text-sm">No data for the selected filters.</p>
                </div>
              )}

              {result && result.rows.length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10">
                    <tr>
                      {result.columns.map(col => (
                        <th
                          key={col.key}
                          className={[
                            "px-2 py-1.5 font-semibold text-slate-600 dark:text-slate-300",
                            "border-b border-slate-200 dark:border-slate-700 whitespace-nowrap",
                            col.align === "right" ? "text-right" : "text-left",
                          ].join(" ")}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr
                        key={ri}
                        className={[
                          "border-b border-slate-100 dark:border-slate-800",
                          "hover:bg-blue-50 dark:hover:bg-slate-900 transition-colors",
                          ri % 2 !== 0
                            ? "bg-slate-50/40 dark:bg-slate-900/20"
                            : "",
                        ].join(" ")}
                      >
                        {result.columns.map(col => (
                          <td
                            key={col.key}
                            className={[
                              "px-2 py-1 text-slate-700 dark:text-slate-300 whitespace-nowrap",
                              col.align === "right"
                                ? "text-right tabular-nums"
                                : "",
                            ].join(" ")}
                          >
                            {formatCell(row[col.key], col.format)}
                          </td>
                        ))}
                      </tr>
                    ))}

                    {/* Summary / totals row */}
                    {result.summary && Object.keys(result.summary).length > 0 && (
                      <tr className="bg-slate-200 dark:bg-slate-700 font-semibold
                                     border-t-2 border-slate-400 dark:border-slate-500">
                        {result.columns.map((col, ci) => (
                          <td
                            key={col.key}
                            className={[
                              "px-2 py-1.5 text-slate-800 dark:text-slate-200 whitespace-nowrap",
                              col.align === "right" ? "text-right tabular-nums" : "",
                            ].join(" ")}
                          >
                            {ci === 0
                              ? "TOTAL"
                              : result.summary![col.key] != null
                                ? formatCell(result.summary![col.key], col.format)
                                : ""}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
