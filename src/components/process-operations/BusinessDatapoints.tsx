import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Database, Headphones, IndianRupee, Loader2, ShieldCheck, Target, Users } from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";

type Unit = "currency" | "percentage" | "count" | "seconds" | "rating";
type Theme = "sales" | "calls" | "leads" | "workforce" | "quality";
interface Card {
  key: string; label: string; value: number | null; unit: Unit; target?: number | null;
  direction?: "higher_is_better" | "lower_is_better"; hint?: string;
  trend?: Array<{ date: string; value: number }>; hero?: boolean;
}
interface Group { key: string; title: string; source: string; theme?: Theme; cards: Card[]; funnel?: Array<{ stage: string; count: number; pctOfBase: number }> }
interface Payload {
  supported: boolean; available: boolean; reason: string | null; processCode: string | null;
  window: { from: string; to: string; label: string } | null; groups: Group[]; notes?: string[];
}

/** Processes whose sales / calling systems are wired (mirrors SUPPORTED_PROCESS_CODES in business-datapoints.service.ts). */
export const BUSINESS_DATAPOINT_CODES = [
  "BELLA_VITA", "BLA_BLI_BLU", "NEEMANS", "GNC", "HOUSING_OWNER", "HOUSING_PREMIUM", "CLOVIA", "BIRLANU",
  "DALMIA_CEMENT", "APPRICIATE_WEALTH", "ERESOLUTION", "DU_DIGITAL", "EXICOM", "VIEGA", "SATYA_RETAIL",
];

/** Whether a process has a sales / calling connection: by code, or (Satya Retail has no fixed code) by name. Mirrors adapterKeyFor() on the server. */
export function supportsBusinessDatapoints(code: string | null, name?: string | null): boolean {
  return (!!code && BUSINESS_DATAPOINT_CODES.includes(code)) || (!!name && /satya/i.test(name));
}

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const THEMES: Record<Theme, { label: string; color: string; icon: typeof Database }> = {
  sales: { label: "Sales and revenue", color: "#2563eb", icon: IndianRupee },
  calls: { label: "Calling", color: "#7c3aed", icon: Headphones },
  leads: { label: "Leads and conversion", color: "#0891b2", icon: Target },
  workforce: { label: "People and productivity", color: "#d97706", icon: Users },
  quality: { label: "Quality", color: "#059669", icon: ShieldCheck },
};

export function formatDatapoint(v: number | null, unit: Unit): string {
  if (v === null || Number.isNaN(v)) return "—";
  if (unit === "percentage") return `${v.toFixed(1)}%`;
  if (unit === "count") return Math.round(v).toLocaleString("en-IN");
  if (unit === "rating") return `${v.toFixed(1)} / 5`;
  if (unit === "seconds") {
    const s = Math.round(v);
    return s < 90 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  }
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (a >= 10_000_000) return `${sign}₹${(a / 10_000_000).toFixed(2)}Cr`;
  if (a >= 100_000) return `${sign}₹${(a / 100_000).toFixed(2)}L`;
  return `${sign}₹${Math.round(a).toLocaleString("en-IN")}`;
}

export function statusOf(c: Pick<Card, "value" | "target" | "direction">): "pass" | "fail" | "none" {
  if (c.value === null || c.target === null || c.target === undefined || !c.direction) return "none";
  return (c.direction === "higher_is_better" ? c.value >= c.target : c.value <= c.target) ? "pass" : "fail";
}

/** The few figures worth showing large: flagged hero cards first (in source order), at most four. */
export function pickHeroes(groups: Group[], max = 4): Card[] {
  return groups.flatMap((g) => g.cards.filter((c) => c.hero && c.value !== null)).slice(0, max);
}

const COLOR = { pass: "#059669", fail: "#e11d48", none: "" };

function Spark({ data, color, w = 120, h = 34 }: { data: Array<{ date: string; value: number }>; color: string; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const vs = data.map((d) => d.value); const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1, pad = 3;
  const pts = vs.map((v, i) => [pad + (i * (w - 2 * pad)) / (vs.length - 1), h - pad - ((v - lo) / span) * (h - 2 * pad)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} role="img" aria-label={`Daily trend, ${data.length} days`}>
      <path d={`${d} L${lx.toFixed(1)},${h - pad} L${pad},${h - pad} Z`} fill={color} opacity={0.1} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2.8} fill={color} />
    </svg>
  );
}

function TargetBar({ c, color }: { c: Card; color: string }) {
  if (c.target === null || c.target === undefined || !c.direction || c.value === null || c.target === 0) return null;
  const ratio = Math.max(0, Math.min(1, c.value / c.target));
  return (
    <>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden><div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: color }} /></div>
      <p className="mt-1 text-[11px] text-slate-500">target {c.direction === "higher_is_better" ? "≥" : "≤"} {formatDatapoint(c.target, c.unit)}</p>
    </>
  );
}

function HeroTile({ c, accent }: { c: Card; accent: string }) {
  const s = statusOf(c);
  const color = s === "none" ? accent : COLOR[s];
  return (
    <div className={`${CARD} relative overflow-hidden p-4`} style={{ borderTop: `4px solid ${color}` }}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
      <p className="mt-0.5 text-3xl font-black tabular-nums" style={{ color: s === "none" ? undefined : color }}>{formatDatapoint(c.value, c.unit)}</p>
      <TargetBar c={c} color={color} />
      {c.hint && <p className="mt-1 text-[11px] text-slate-500">{c.hint}</p>}
      {c.trend && c.trend.length > 1 && <div className="mt-2"><Spark data={c.trend} color={color} w={200} h={40} /></div>}
    </div>
  );
}

function DatapointCard({ c, accent }: { c: Card; accent: string }) {
  const s = statusOf(c);
  const color = s === "none" ? accent : COLOR[s];
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40" style={s !== "none" ? { borderLeft: `4px solid ${color}` } : undefined}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
      <div className="flex items-end justify-between gap-2">
        <p className="text-2xl font-black tabular-nums" style={{ color: s === "none" ? undefined : color }}>{formatDatapoint(c.value, c.unit)}</p>
        {c.trend && c.trend.length > 1 && <Spark data={c.trend} color={color} w={84} h={28} />}
      </div>
      <TargetBar c={c} color={color} />
      {c.hint && <p className="mt-0.5 text-[11px] text-slate-500">{c.hint}</p>}
    </div>
  );
}

/** A headline figure is shown once, in the strip above; the section lists only the rest. */
export function withoutHeroes(g: Group, heroKeys: Set<string>): Group {
  return { ...g, cards: g.cards.filter((c) => !heroKeys.has(c.key)) };
}

function GroupSection({ g, defaultOpen }: { g: Group; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const theme = THEMES[g.theme ?? "sales"];
  const Icon = theme.icon;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
        style={{ background: `linear-gradient(90deg, ${theme.color}14, transparent)` }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ background: theme.color }}><Icon className="h-4 w-4" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-slate-900 dark:text-slate-100">{g.title}</span>
          <span className="block truncate text-[11px] text-slate-500">{theme.label} · {g.source}</span>
        </span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{g.cards.length}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">{g.cards.map((c) => <DatapointCard key={c.key} c={c} accent={theme.color} />)}</div>
          {g.funnel && g.funnel.length > 0 && (
            <div className="space-y-1.5" role="img" aria-label={`${g.title} funnel`}>
              {g.funnel.map((f, i) => (
                <div key={f.stage} className="flex items-center gap-3 text-xs">
                  <span className="w-44 shrink-0 text-slate-600 dark:text-slate-300">{f.stage}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800"><div className="h-full rounded" style={{ width: `${Math.max(1.5, Math.min(100, f.pctOfBase))}%`, background: theme.color, opacity: 1 - i * 0.14 }} /></div>
                  <span className="w-36 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-300">{f.count.toLocaleString("en-IN")} · {f.pctOfBase}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Sales, revenue, payment-mix, RTO, calling and funnel figures from the process's own sales and dialler systems, which the
 * KPI metric list does not carry. Loaded on request (the Bella-Vita source alone takes ~20s), read-only.
 */
export function BusinessDatapoints({ processId, processCode, processName, period }: { processId: string; processCode: string | null; processName?: string | null; period: string }) {
  const [enabled, setEnabled] = useState(false);
  const supported = supportsBusinessDatapoints(processCode, processName);
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["process-operations", "business-datapoints", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Payload>>(`/api/process-operations/${processId}/business-datapoints?period=${period}`, 120_000),
    enabled: supported && enabled,
    staleTime: 5 * 60_000,
  });
  const d = data?.data;
  const heroes = useMemo(() => (d?.available ? pickHeroes(d.groups) : []), [d]);
  // Sections list what the headline strip does not; a section left with nothing (no cards, no funnel) is dropped.
  const shownGroups = useMemo(() => {
    const keys = new Set(heroes.map((h) => h.key));
    return (d?.available ? d.groups : []).map((g) => withoutHeroes(g, keys)).filter((g) => g.cards.length > 0 || (g.funnel?.length ?? 0) > 0);
  }, [d, heroes]);
  if (!supported) return null;

  return (
    <section aria-label="Business datapoints" className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <Database className="h-4 w-4 text-blue-600" aria-hidden />
        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Business datapoints from the sales and calling systems</h3>
        {d?.window && <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{d.window.label} · {d.window.from} → {d.window.to}</span>}
        {!enabled && (
          <button type="button" onClick={() => setEnabled(true)} className="ml-auto rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            Load revenue, calling and funnel figures
          </button>
        )}
      </div>
      {!enabled && <p className="mt-2 text-xs text-slate-500">Revenue, average order value, RTO, call volumes and the conversion funnel are computed live from the process's own uploads and dialler, not from the KPI list above, so they can be current even when the KPI feed has stopped. It can take up to a minute the first time.</p>}
      {enabled && isFetching && !d && <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Reading the sales and calling systems… this can take up to a minute.</p>}
      {enabled && isError && (
        <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden />Could not read the sales and calling systems.</span>
          <button type="button" onClick={() => refetch()} className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white">Retry</button>
        </div>
      )}
      {d && !d.available && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{d.reason}</p>}
      {d?.available && (
        <div className="mt-3 space-y-4">
          {d.notes && d.notes.length > 0 && (
            <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{d.notes.join(" ")}</p>
          )}
          {heroes.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Headline figures">
              {heroes.map((c) => <HeroTile key={c.key} c={c} accent="#2563eb" />)}
            </div>
          )}
          <p className="text-xs text-slate-500">
            Same source and figures as the process's own dashboards. <a className="font-semibold text-blue-600 underline" href="/performance/process-performance-v2">Open the full dashboards in TPZ Process</a> for trends, LOB and agent detail.
          </p>
          <div className="space-y-3">
            {shownGroups.map((g, i) => <GroupSection key={g.key} g={g} defaultOpen={i < 3} />)}
          </div>
        </div>
      )}
    </section>
  );
}
