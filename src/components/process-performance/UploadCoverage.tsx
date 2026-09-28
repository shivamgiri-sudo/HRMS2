import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, CalendarClock, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

/** What data an upload type already holds (GET /api/bulk-upload/coverage) -- so the uploader knows where to continue from. */
export interface UploadCoverage {
  latestDate: string | null;
  firstDate: string | null;
  days: number;
  lastUploadedAt: string | null;
  uploads: number;
  basis: "data" | "uploads-only";
}

const KEY = "upload-coverage";
type CoverageMap = Record<string, UploadCoverage>;

export function useUploadCoverage(codes: string[]) {
  const list = [...new Set(codes)].sort();
  return useQuery({
    queryKey: [KEY, list.join(",")],
    enabled: list.length > 0,
    staleTime: 2 * 60_000,
    retry: 1,
    queryFn: async (): Promise<CoverageMap> => {
      const res = await hrmsApi.get<{ success: boolean; data: CoverageMap }>(`/api/bulk-upload/coverage?codes=${encodeURIComponent(list.join(","))}`, 60_000);
      return res.data;
    },
  });
}

/** Re-reads coverage from the server (bypassing its cache) -- call after an import finishes. */
export function useRefreshUploadCoverage() {
  const qc = useQueryClient();
  return async (codes: string[]) => {
    const list = [...new Set(codes)].sort();
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CoverageMap }>(`/api/bulk-upload/coverage?codes=${encodeURIComponent(list.join(","))}&refresh=1`, 60_000);
      qc.setQueryData([KEY, list.join(",")], res.data);
    } catch {
      /* the badge keeps its previous value */
    }
    void qc.invalidateQueries({ queryKey: [KEY] });
  };
}

/** DD/MM/YYYY */
export const fmtCoverageDate = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const isoOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function nextDayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return isoOf(d);
}
/** Whole days between the latest data date and today (0 = data is up to today). */
export function daysBehind(iso: string): number {
  const a = new Date(`${iso}T00:00:00`).getTime();
  const b = new Date(`${isoOf(new Date())}T00:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
const fmtWhen = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** One line for an uploader tile: "Data till 15/09/2026". */
export function UploadCoverageLine({ coverage, loading }: { coverage?: UploadCoverage; loading?: boolean }) {
  if (loading && !coverage) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" />Checking data…</span>;
  }
  if (!coverage) return null;
  if (coverage.latestDate) {
    const behind = daysBehind(coverage.latestDate);
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${behind > 2 ? "text-amber-600" : "text-emerald-600"}`}>
        <CalendarCheck2 className="h-3 w-3" />Data till {fmtCoverageDate(coverage.latestDate)}
      </span>
    );
  }
  if (coverage.lastUploadedAt) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><CalendarClock className="h-3 w-3" />Last uploaded {fmtWhen(coverage.lastUploadedAt)}</span>;
  }
  return <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><CalendarClock className="h-3 w-3" />No data uploaded yet</span>;
}

/** The banner above the upload box: what is already there, and the date to upload from. */
export function UploadCoverageBanner({ coverage, loading }: { coverage?: UploadCoverage; loading?: boolean }) {
  if (loading && !coverage) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />Checking what data is already uploaded…
      </div>
    );
  }
  if (!coverage) return null;

  if (!coverage.latestDate) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-700">{coverage.basis === "data" ? "No data uploaded yet." : "This upload has no data date."}</span>{" "}
        {coverage.lastUploadedAt
          ? `Last uploaded on ${fmtWhen(coverage.lastUploadedAt)}${coverage.uploads ? ` (${coverage.uploads} upload${coverage.uploads === 1 ? "" : "s"})` : ""}.`
          : "Nothing has been uploaded for it so far."}
      </div>
    );
  }
  const behind = daysBehind(coverage.latestDate);
  const tone = behind > 2 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  const from = fmtCoverageDate(nextDayIso(coverage.latestDate));
  return (
    <div className={`flex flex-col gap-1 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${tone}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <CalendarCheck2 className="h-4 w-4 shrink-0" />
        <span>
          Data uploaded till <b>{fmtCoverageDate(coverage.latestDate)}</b>
          {behind > 0 && <span className="ml-1.5 text-xs opacity-80">({behind} day{behind === 1 ? "" : "s"} ago)</span>}
        </span>
        <span className="text-slate-400">·</span>
        <span>Upload from <b>{from}</b> onward</span>
      </div>
      <div className="text-[11px] opacity-80">
        {coverage.firstDate ? `First date ${fmtCoverageDate(coverage.firstDate)} · ` : ""}
        {coverage.days} day{coverage.days === 1 ? "" : "s"} with data
        {coverage.lastUploadedAt ? ` · last upload ${fmtWhen(coverage.lastUploadedAt)}` : ""}
      </div>
    </div>
  );
}
