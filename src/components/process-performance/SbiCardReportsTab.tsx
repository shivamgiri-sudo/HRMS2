import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  FileSpreadsheet,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";

interface ReportFilter {
  key: string;
  label: string;
  type: string;
  options?: string[];
}

interface ReportMeta {
  id: string;
  name: string;
  filters: ReportFilter[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthStart(): string {
  return today().slice(0, 8) + "01";
}

interface FilterValues {
  from?: string;
  to?: string;
  date?: string;
  campaign?: string;
  team?: string;
  teamLeader?: string;
  agent?: string;
  site?: string;
  status?: string;
  [key: string]: string | undefined;
}

function ReportPanel({ report }: { report: ReportMeta }) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [filters, setFilters] = useState<FilterValues>(() => {
    const init: FilterValues = {};
    for (const f of report.filters) {
      if (f.type === "date") {
        init[f.key] = f.key === "from" ? monthStart() : today();
      } else if (f.key === "date") {
        init[f.key] = today();
      } else {
        init[f.key] = "";
      }
    }
    return init;
  });
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v) params.set(k, v);
      }
      const token = localStorage.getItem("hrms_token") || sessionStorage.getItem("hrms_token") || "";
      const resp = await fetch(
        `/api/process-performance/sbi-card-reports/${report.id}/download?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${resp.status}`);
      }
      const blob = await resp.blob();
      const cd = resp.headers.get("Content-Disposition") || "";
      const fnMatch = cd.match(/filename="([^"]+)"/);
      const filename = fnMatch
        ? fnMatch[1]
        : `${report.name.replace(/\s+/g, "_")}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-600" />
        <span className="flex-1 font-semibold text-slate-800 text-sm">
          {report.name}
        </span>
        <ChevronRight
          className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {report.filters.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">
                  {f.label}
                </span>
                {f.type === "select" && f.options ? (
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={filters[f.key] ?? ""}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, [f.key]: e.target.value }))
                    }
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o || "All"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type === "date" ? "date" : "text"}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={filters[f.key] ?? ""}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, [f.key]: e.target.value }))
                    }
                  />
                )}
              </label>
            ))}
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {downloading ? "Generating…" : "Download"}
          </button>
        </div>
      )}
    </div>
  );
}

export function SbiCardReportsTab() {
  const q = useQuery({
    queryKey: ["sbi-card-reports-meta"],
    queryFn: () =>
      hrmsApi.get<HrmsEnvelope<ReportMeta[]>>(
        "/api/process-performance/sbi-card-reports"
      ),
    staleTime: Infinity,
  });

  const reports = q.data?.data ?? [];

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading reports…
      </div>
    );
  }

  if (q.isError) {
    return (
      <p className="text-sm text-red-600 py-4">
        Failed to load report list. Check your connection.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Select a report, set the date range and filters, then click Download to
        get the Excel file in SBI's format.
      </p>
      {reports.map((r) => (
        <ReportPanel key={r.id} report={r} />
      ))}
    </div>
  );
}
