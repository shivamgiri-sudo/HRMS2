import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import { DASHBOARD_ACCESS_REGISTRY } from "../../../backend/src/shared/dashboardAccessRegistry";
import { Panel } from "./kit";
import "./kit/kit.css";

type Row = Record<string, string | number | boolean | null>;
interface Drill { summary?: Record<string, string | number>; records: Row[]; totalCount?: number }

const PAGE = 25;
const HIDE = /(^id$|Id$|_id$)/;
const label = (c: string) => c.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim().replace(/^./, (m) => m.toUpperCase());

function csv(rows: Row[], cols: string[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.map(label).map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/**
 * Full-page drilldown for any dashboard metric: /dashboards/drill/:dashboardCode/:metricCode.
 * Same scoped backend endpoint as the side drawer, but with search, sort, pagination and CSV export
 * for the cases where a drawer is too small to work the list.
 */
export default function DashboardDrillPage() {
  const { dashboardCode = "", metricCode = "" } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const filters = useMemo(() => Object.fromEntries(sp.entries()), [sp]);
  const qs = sp.toString() ? `?${sp.toString()}` : "";
  const known = Object.values(DASHBOARD_ACCESS_REGISTRY).some((d) => d.code === dashboardCode);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dash-drill", dashboardCode, metricCode, qs],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data?: Drill } | Drill>(`/api/dashboards/${dashboardCode}/metric/${metricCode}/drilldown${qs}`);
      return ((res as { data?: Drill }).data ?? res) as Drill;
    },
    enabled: known && !!metricCode,
    staleTime: 30_000,
    retry: 1,
  });

  const cols = useMemo(() => (data?.records?.[0] ? Object.keys(data.records[0]).filter((c) => !HIDE.test(c)) : []), [data]);
  const rows = useMemo(() => {
    let list = data?.records ?? [];
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((r) => cols.some((c) => String(r[c] ?? "").toLowerCase().includes(needle)));
    if (sort) list = [...list].sort((a, b) => {
      const x = a[sort.col], y = b[sort.col];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
    return list;
  }, [data, q, sort, cols]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);

  const download = () => {
    const blob = new Blob([csv(rows, cols)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${dashboardCode}_${metricCode}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1400px] space-y-4 p-1">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue-700 hover:text-blue-900"><ArrowLeft className="h-4 w-4" />Back to dashboard</button>
        <header className="rounded-3xl bg-gradient-to-br from-[#0b1f44] via-[#1e2f7a] to-[#4338ca] p-6 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[.18em] text-white/70">{dashboardCode.replace(/_/g, " ")}</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight">{label(metricCode.toLowerCase())}</h1>
          <p className="mt-1 text-[13px] text-white/75">Drill-down records behind this number{Object.keys(filters).length ? ` · filtered: ${Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}</p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Stat k="Records" v={(data?.totalCount ?? data?.records?.length ?? 0).toLocaleString("en-IN")} />
            {data?.summary ? Object.entries(data.summary).slice(0, 4).map(([k, v]) => <Stat key={k} k={label(k)} v={String(v ?? "—")} />) : null}
          </div>
        </header>

        <Panel title="Records" subtitle={data && data.totalCount && data.totalCount > data.records.length ? `Showing the first ${data.records.length.toLocaleString("en-IN")} of ${data.totalCount.toLocaleString("en-IN")} — export covers loaded rows` : undefined}
          action={<div className="flex items-center gap-2">
            <label className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search…" className="h-8 w-44 rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-[12px] outline-none focus:border-blue-400" aria-label="Search records" /></label>
            <button type="button" onClick={download} disabled={!rows.length} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[12px] font-semibold text-white disabled:opacity-40"><Download className="h-3.5 w-3.5" />CSV</button>
          </div>} bodyClassName="p-0">
          {!known ? <p className="p-6 text-[13px] text-rose-600">Unknown dashboard.</p>
            : isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            : error ? <p className="p-6 text-[13px] text-rose-600">Could not load records: {(error as Error).message}</p>
            : !rows.length ? <p className="p-10 text-center text-[13px] text-slate-400">No records match.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-slate-50"><tr>{cols.map((c) => (
                    <th key={c} className="whitespace-nowrap px-4 py-2.5 text-left"><button type="button" onClick={() => { setSort((s) => (s?.col === c ? { col: c, dir: (s.dir * -1) as 1 | -1 } : { col: c, dir: 1 })); setPage(0); }} className="font-bold uppercase tracking-wide text-slate-500 hover:text-slate-900">{label(c)}{sort?.col === c ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>
                  ))}</tr></thead>
                  <tbody className="divide-y divide-slate-100">{view.map((r, i) => (
                    <tr key={i} className="hover:bg-blue-50/40">{cols.map((c, ci) => {
                      const v = r[c];
                      return <td key={c} className={cn("whitespace-nowrap px-4 py-2.5", ci === 0 ? "font-semibold text-slate-900" : "text-slate-600", typeof v === "number" && "kit-num text-right")}>{v === null || v === undefined ? <span className="text-slate-300">—</span> : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? v.toLocaleString("en-IN") : String(v)}</td>;
                    })}</tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          {rows.length > PAGE ? (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
              <span>{page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length.toLocaleString("en-IN")}</span>
              <span className="flex items-center gap-1">
                <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-slate-200 p-1 disabled:opacity-30" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
                <span className="px-2">{page + 1} / {pages}</span>
                <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-slate-200 p-1 disabled:opacity-30" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
              </span>
            </div>
          ) : null}
        </Panel>
        <p className="text-[11px] text-slate-400"><Link to="/dashboard" className="hover:underline">My dashboard</Link></p>
      </div>
    </DashboardLayout>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="rounded-2xl bg-white/10 px-4 py-2.5 ring-1 ring-white/15"><p className="text-[11px] font-semibold uppercase tracking-wide text-white/65">{k}</p><p className="kit-num mt-0.5 text-[20px] font-extrabold">{v}</p></div>;
}
