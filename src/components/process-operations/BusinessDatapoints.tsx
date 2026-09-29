import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, Loader2 } from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";

type Unit = "currency" | "percentage" | "count";
interface Card { key: string; label: string; value: number | null; unit: Unit; target?: number | null; direction?: "higher_is_better" | "lower_is_better"; hint?: string }
interface Group { key: string; title: string; source: string; cards: Card[]; funnel?: Array<{ stage: string; count: number; pctOfBase: number }> }
interface Payload { supported: boolean; available: boolean; reason: string | null; processCode: string | null; window: { from: string; to: string; label: string } | null; groups: Group[] }

/** Processes whose sales system is wired (mirrors SUPPORTED_PROCESS_CODES in business-datapoints.service.ts). */
export const BUSINESS_DATAPOINT_CODES = ["BELLA_VITA", "BLA_BLI_BLU", "NEEMANS", "GNC"];

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";

export function formatDatapoint(v: number | null, unit: Unit): string {
  if (v === null || Number.isNaN(v)) return "—";
  if (unit === "percentage") return `${v.toFixed(1)}%`;
  if (unit === "count") return Math.round(v).toLocaleString("en-IN");
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 10_000_000) return `${s}₹${(a / 10_000_000).toFixed(2)}Cr`;
  if (a >= 100_000) return `${s}₹${(a / 100_000).toFixed(2)}L`;
  return `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
}

function statusOf(c: Card): "pass" | "fail" | "none" {
  if (c.value === null || c.target === null || c.target === undefined || !c.direction) return "none";
  return (c.direction === "higher_is_better" ? c.value >= c.target : c.value <= c.target) ? "pass" : "fail";
}

function DatapointCard({ c }: { c: Card }) {
  const s = statusOf(c);
  const color = s === "pass" ? "#059669" : s === "fail" ? "#e11d48" : undefined;
  const ratio = c.target ? Math.max(0, Math.min(1.2, (c.value ?? 0) / c.target)) : null;
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40" style={s !== "none" ? { borderLeft: `4px solid ${color}` } : undefined}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
      <p className="text-2xl font-black tabular-nums" style={{ color }}>{formatDatapoint(c.value, c.unit)}</p>
      {c.target !== null && c.target !== undefined && c.direction && (
        <>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (ratio ?? 0) * 100)}%`, background: color }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">target {c.direction === "higher_is_better" ? "≥" : "≤"} {formatDatapoint(c.target, c.unit)}</p>
        </>
      )}
      {c.hint && <p className="mt-0.5 text-[11px] text-slate-500">{c.hint}</p>}
    </div>
  );
}

/**
 * Sales, revenue, payment-mix, RTO and funnel figures from the process's own sales systems, which the
 * KPI metric list does not carry. Loaded on request (the Bella-Vita source alone takes ~20s), read-only.
 */
export function BusinessDatapoints({ processId, processCode, period }: { processId: string; processCode: string | null; period: string }) {
  const [enabled, setEnabled] = useState(false);
  const supported = !!processCode && BUSINESS_DATAPOINT_CODES.includes(processCode);
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["process-operations", "business-datapoints", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Payload>>(`/api/process-operations/${processId}/business-datapoints?period=${period}`, 120_000),
    enabled: supported && enabled,
    staleTime: 5 * 60_000,
  });
  if (!supported) return null;
  const d = data?.data;

  return (
    <section aria-label="Business datapoints" className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <Database className="h-4 w-4 text-blue-600" aria-hidden />
        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Business datapoints from the sales systems</h3>
        {d?.window && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{d.window.label} · {d.window.from} → {d.window.to}</span>}
        {!enabled && (
          <button type="button" onClick={() => setEnabled(true)} className="ml-auto rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            Load revenue, AOV, RTO and funnel
          </button>
        )}
      </div>
      {!enabled && <p className="mt-2 text-xs text-slate-500">Revenue, average order value, prepaid share, RTO and the call funnel are computed live from the sales uploads, not from the KPI list above, so they can be current even when the KPI feed has stopped. It can take up to a minute the first time.</p>}
      {enabled && isFetching && !d && <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Reading the sales systems… this can take up to a minute.</p>}
      {enabled && isError && (
        <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden />Could not read the sales systems.</span>
          <button type="button" onClick={() => refetch()} className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white">Retry</button>
        </div>
      )}
      {d && !d.available && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{d.reason}</p>}
      {d?.available && (
        <div className="mt-3 space-y-5">
          <p className="text-xs text-slate-500">
            Same source and figures as the process's own dashboards. <a className="font-semibold text-blue-600 underline" href="/performance/process-performance-v2">Open the full dashboards in TPZ Process</a> for trends, LOB and agent detail.
          </p>
          {d.groups.map((g) => (
            <div key={g.key}>
              <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">{g.title} <span className="font-medium normal-case text-slate-400">· {g.source}</span></p>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">{g.cards.map((c) => <DatapointCard key={c.key} c={c} />)}</div>
              {g.funnel && g.funnel.length > 0 && (
                <div className="mt-3 space-y-1.5" role="img" aria-label={`${g.title} funnel`}>
                  {g.funnel.map((f) => (
                    <div key={f.stage} className="flex items-center gap-3 text-xs">
                      <span className="w-40 shrink-0 text-slate-600 dark:text-slate-300">{f.stage}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800"><div className="h-full rounded bg-blue-500" style={{ width: `${Math.max(1, Math.min(100, f.pctOfBase))}%` }} /></div>
                      <span className="w-32 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-300">{f.count.toLocaleString("en-IN")} · {f.pctOfBase}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
