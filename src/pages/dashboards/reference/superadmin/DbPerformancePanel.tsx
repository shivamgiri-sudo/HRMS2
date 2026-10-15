import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Database, Activity, Clock, Lock, Zap, RefreshCw } from "lucide-react";
import { Panel } from "../../kit";

interface DbLive {
  threads_running: number;
  threads_connected: number;
  slow_queries: number;
  questions_per_sec: number;
  lock_waits: number;
  lock_wait_avg_ms: number;
  uptime_h: number;
}

interface TopTable {
  table_name: string;
  size_mb: number;
  rows: number;
  data_mb: number;
  index_mb: number;
}

interface UploadBatch {
  total_rows: number;
  total_batches: number;
  purged_batches: number;
  due_for_purge: number;
  next_purge_at: string;
}

interface DbPerformanceData {
  live: DbLive;
  top_tables: TopTable[];
  upload_batch: UploadBatch;
}

function tone(value: number, warn: number, bad: number): "good" | "warn" | "bad" {
  if (value >= bad) return "bad";
  if (value >= warn) return "warn";
  return "good";
}

const TONE_DOT: Record<string, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-400",
  bad: "bg-rose-500",
};
const TONE_TEXT: Record<string, string> = {
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-700",
};
const TONE_BG: Record<string, string> = {
  good: "bg-emerald-50 ring-emerald-200",
  warn: "bg-amber-50 ring-amber-200",
  bad: "bg-rose-50 ring-rose-200",
};

function MetricTile({ icon: Icon, label, value, unit, t }: {
  icon: React.ElementType; label: string; value: number | string; unit?: string; t: "good" | "warn" | "bad";
}) {
  return (
    <div className={cn("rounded-2xl p-3.5 ring-1", TONE_BG[t])}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("h-3.5 w-3.5", TONE_TEXT[t])} />
          <span className="text-[11px] font-semibold text-slate-600">{label}</span>
        </div>
        <span className={cn("h-2 w-2 rounded-full", TONE_DOT[t])} />
      </div>
      <p className={cn("kit-num mt-2 text-[22px] font-extrabold leading-none", TONE_TEXT[t])}>
        {typeof value === "number" ? value.toLocaleString("en-IN") : value}
        {unit && <span className="ml-1 text-[12px] font-normal text-slate-500">{unit}</span>}
      </p>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function DbPerformancePanel() {
  const [data, setData] = useState<DbPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/super-admin/db-performance", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
      setRefreshedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const live = data?.live;
  const tables = data?.top_tables ?? [];
  const ub = data?.upload_batch;

  return (
    <Panel
      title="Database performance"
      subtitle="Live MySQL status, largest tables and upload-batch retention"
      action={
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {refreshedAt ? refreshedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Refresh"}
        </button>
      }
    >
      {error ? (
        <p className="p-4 text-[12px] text-rose-600">{error}</p>
      ) : (
        <div className="space-y-5 p-4">
          {/* Live metrics */}
          <div>
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Live MySQL status</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
              {live ? (
                <>
                  <MetricTile icon={Activity} label="Threads running" value={live.threads_running} t={tone(live.threads_running, 10, 20)} />
                  <MetricTile icon={Database} label="Threads connected" value={live.threads_connected} t={tone(live.threads_connected, 30, 50)} />
                  <MetricTile icon={Clock} label="Slow queries" value={live.slow_queries} t={tone(live.slow_queries, 100, 500)} />
                  <MetricTile icon={Zap} label="Queries / sec" value={live.questions_per_sec} unit="qps" t="good" />
                  <MetricTile icon={Lock} label="Lock waits" value={live.lock_waits} t={tone(live.lock_waits, 50, 200)} />
                  <MetricTile icon={Database} label="Lock wait avg" value={live.lock_wait_avg_ms} unit="ms" t={tone(live.lock_wait_avg_ms, 1000, 5000)} />
                </>
              ) : (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-slate-100" />
                ))
              )}
            </div>
          </div>

          {/* Upload batch retention */}
          {ub && (
            <div>
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Upload batch retention</p>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
                  <p className="text-[11px] font-semibold text-slate-500">Total rows</p>
                  <p className="kit-num mt-1 text-[20px] font-extrabold text-slate-900">{ub.total_rows.toLocaleString("en-IN")}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
                  <p className="text-[11px] font-semibold text-slate-500">Batches purged</p>
                  <p className="kit-num mt-1 text-[20px] font-extrabold text-emerald-700">{ub.purged_batches.toLocaleString("en-IN")}</p>
                  <p className="text-[10px] text-slate-400">of {ub.total_batches}</p>
                </div>
                <div className={cn("rounded-2xl p-3.5 ring-1", ub.due_for_purge > 0 ? "bg-amber-50 ring-amber-200" : "bg-slate-50 ring-slate-200")}>
                  <p className="text-[11px] font-semibold text-slate-500">Due for purge</p>
                  <p className={cn("kit-num mt-1 text-[20px] font-extrabold", ub.due_for_purge > 0 ? "text-amber-700" : "text-slate-900")}>{ub.due_for_purge}</p>
                  <p className="text-[10px] text-slate-400">runs tonight</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
                  <p className="text-[11px] font-semibold text-slate-500">Next purge</p>
                  <p className="kit-num mt-1 text-[14px] font-extrabold text-slate-700">{ub.next_purge_at}</p>
                </div>
              </div>
            </div>
          )}

          {/* Top tables */}
          {tables.length > 0 && (
            <div>
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Largest tables (top 10)</p>
              <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
                <table className="w-full min-w-[480px] text-left text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Table</th>
                      <th className="px-4 py-2 text-right font-semibold">Total</th>
                      <th className="px-4 py-2 text-right font-semibold">Data</th>
                      <th className="px-4 py-2 text-right font-semibold">Indexes</th>
                      <th className="px-4 py-2 text-right font-semibold">~Rows</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tables.map((t, i) => (
                      <tr key={t.table_name} className={cn("hover:bg-slate-50", i === 0 && "bg-rose-50/40")}>
                        <td className="px-4 py-2 font-medium text-slate-900">
                          {t.table_name}
                          {i === 0 && <span className="ml-2 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">largest</span>}
                        </td>
                        <td className={cn("kit-num px-4 py-2 text-right font-semibold", t.size_mb > 1000 ? "text-rose-700" : t.size_mb > 500 ? "text-amber-700" : "text-slate-700")}>
                          {t.size_mb.toLocaleString("en-IN")} MB
                        </td>
                        <td className="kit-num px-4 py-2 text-right text-slate-600">{t.data_mb.toLocaleString("en-IN")} MB</td>
                        <td className="kit-num px-4 py-2 text-right text-slate-600">{t.index_mb.toLocaleString("en-IN")} MB</td>
                        <td className="kit-num px-4 py-2 text-right text-slate-500">{fmt(t.rows)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {live && (
            <p className="text-[11px] text-slate-400">
              DB uptime: {live.uptime_h.toLocaleString("en-IN")} h · SESSION wait_timeout 300s · innodb_lock_wait_timeout 30s · db-health cron every 5 min
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
