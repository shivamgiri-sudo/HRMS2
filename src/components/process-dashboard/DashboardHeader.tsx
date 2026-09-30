import { Download, Pause, Play, RefreshCw, Radio } from "lucide-react";
import { CATEGORY_LABEL, formatAge, isStale } from "./format";
import { btn } from "./ui";
import type { Freshness, ProcessConfigSummary } from "./types";
import type { PollerState } from "./poller";

interface Props {
  config: ProcessConfigSummary | null; freshness?: Freshness; now: number; lastCheckedAt: number | null;
  poll: PollerState & { pause: () => void; resume: () => void; refreshNow: () => Promise<void> };
  onRefresh: () => void; onExport: (view: "agents" | "daily") => void; exporting: boolean; embedded?: boolean; fetching?: boolean;
}

export function DashboardHeader({ config, freshness, now, lastCheckedAt, poll, onRefresh, onExport, exporting, embedded, fetching }: Props) {
  const lastData = freshness?.lastDataAt ? Date.parse(freshness.lastDataAt) : NaN;
  const stale = isStale(freshness?.lastDataAt, now, config?.refreshSeconds);
  const live = poll.running && !poll.paused && !poll.hidden && poll.failures === 0;
  const badge = poll.failures > 0 ? { t: `Reconnecting (retry ${Math.round(poll.nextDelayMs / 1000)}s)`, c: "bg-amber-50 text-amber-900 ring-amber-300" }
    : poll.paused ? { t: "Paused", c: "bg-slate-100 text-slate-800 ring-slate-300" }
    : poll.hidden ? { t: "Idle (tab hidden)", c: "bg-slate-100 text-slate-800 ring-slate-300" }
    : { t: "LIVE", c: "bg-emerald-50 text-emerald-800 ring-emerald-300" };
  return (
    <header className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-4 text-white shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {!embedded && <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-200">Process Dashboard</p>}
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold sm:text-2xl">
            {config?.label ?? config?.processName ?? "Process"}
            {config && <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold">{CATEGORY_LABEL[config.category] ?? config.category}</span>}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${badge.c}`}>
            <Radio className={`h-3.5 w-3.5 ${live ? "motion-safe:animate-pulse" : ""}`} aria-hidden="true" />{badge.t}
          </span>
          <button type="button" onClick={poll.paused ? poll.resume : poll.pause} aria-pressed={poll.paused} className={`${btn} text-slate-900`}>
            {poll.paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
            {poll.paused ? "Resume" : "Pause"}<span className="sr-only"> auto-refresh</span>
          </button>
          <button type="button" onClick={onRefresh} className={`${btn} text-slate-900`}>
            <RefreshCw className={`h-3.5 w-3.5 ${fetching ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />Refresh
          </button>
          <button type="button" onClick={() => onExport("agents")} disabled={exporting} className={`${btn} text-slate-900`}><Download className="h-3.5 w-3.5" aria-hidden="true" />Agents CSV</button>
          <button type="button" onClick={() => onExport("daily")} disabled={exporting} className={`${btn} text-slate-900`}><Download className="h-3.5 w-3.5" aria-hidden="true" />Daily CSV</button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-200">
        {Number.isNaN(lastData) ? "No data timestamp yet" : `Data updated ${formatAge(now - lastData)}`}
        {freshness?.latestDate ? ` · latest day ${freshness.latestDate}` : ""}
        {typeof freshness?.rows === "number" ? ` · ${freshness.rows.toLocaleString("en-IN")} rows` : ""}
        {lastCheckedAt ? ` · checked ${formatAge(now - lastCheckedAt)}` : ""}
        {config ? ` · refreshes every ${config.refreshSeconds}s` : ""}
      </p>
      {stale && <p role="alert" className="mt-2 inline-block rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-950">Stale data: the newest source row is older than expected. Figures describe the last loaded day.</p>}
    </header>
  );
}
