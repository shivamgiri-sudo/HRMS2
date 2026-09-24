import { useEffect, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  PhoneCall, PhoneIncoming, Users, Repeat, PhoneForwarded, TrendingUp, TrendingDown,
  ArrowUp, ArrowDown, Lightbulb, Info, AlertTriangle, Timer, Hourglass, ShieldCheck,
  Smile, Frown, MessageSquareHeart, Quote,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Spinner, SectionCard, KPI_TONES, localDateStr, formatShortDate, type KpiTone } from "./DashboardKit";
import { fmtVal, type Kpi, type LobPayload } from "./CloviaReportKit";

/**
 * Clovia Inbound's branded landing overview -- one solid summary page, no
 * accordion/sub-views (those were cut per explicit request: they duplicated
 * what "Call performance" and "CSAT, Quality, Rechurn & Tickets" already
 * show in full, on the same slide). Real data from the same two endpoints
 * the rest of the Inbound slide already uses:
 *   - GET /api/inbound-insights/clovia (call metrics)
 *   - GET /api/process-performance/clovia-lob/inbound (CSAT, quality, rechurn)
 * Nothing here is fabricated -- see PR notes for the fields deliberately left
 * out (no real source anywhere in this app).
 */

interface CallMetrics {
  offered: number; answered: number; abandoned: number; answeredPct: number; abandonPct: number; slPct: number;
  aht: number; avgTalk: number; asa: number;
}
interface CallHeadline extends CallMetrics {
  uniqueCallers: number; repeatCallers: number; repeatCallerPct: number; agentsActive: number; avgCallsPerDay: number;
}
interface CallDaily extends CallMetrics { date: string; uniqueCallers: number }
interface CallInsights {
  headline: CallHeadline;
  insights: Array<{ tone: "info" | "good" | "warn" | "bad"; text: string }>;
  daily: CallDaily[];
}

const fmtNum = (v: number) => v.toLocaleString("en-IN");
const fmtSec = (s: number) => {
  if (!Number.isFinite(s)) return "—";
  const t = Math.round(s);
  return t >= 60 ? `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s` : `${t}s`;
};
const kpiVal = (kpis: Kpi[], key: string): number | null => {
  const v = kpis.find((k) => k.key === key)?.value;
  return v === null || v === undefined ? null : Number(v);
};
const kpiFmt = (kpis: Kpi[], key: string): string => {
  const k = kpis.find((x) => x.key === key);
  return k ? fmtVal(k.value, k.fmt) : "—";
};

/** Same-length period immediately before `from` -- for a real "vs previous
 * period" delta arrow, not a fabricated trend number. */
function previousPeriod(from: string, to: string): { from: string; to: string } {
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
  const prevTo = new Date(f);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return { from: localDateStr(prevFrom), to: localDateStr(prevTo) };
}
function delta(cur: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${up ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(value)}%
    </span>
  );
}

function StatTile({ icon: Icon, tone, label, value, sub, delta: d }: {
  icon: typeof PhoneCall; tone: KpiTone; label: string; value: string; sub?: string; delta?: number | null;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-100 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md">
      <div className={`absolute inset-y-0 left-0 w-1 ${t.accent}`} />
      <div className="flex items-start justify-between pl-1">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${t.badge}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <DeltaBadge value={d ?? null} />
      </div>
      <p className={`mt-1 pl-1 text-lg font-extrabold leading-tight tracking-tight ${t.value}`}>{value}</p>
      <p className="pl-1 text-[11px] font-semibold leading-tight text-slate-600">{label}</p>
      {sub && <p className="truncate pl-1 text-[10px] leading-tight text-slate-400">{sub}</p>}
    </div>
  );
}

function MiniStat({ icon: Icon, tone, label, value, sub }: { icon: typeof PhoneCall; tone: KpiTone; label: string; value: string; sub?: string }) {
  const t = KPI_TONES[tone];
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 shadow-sm">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${t.badge}`}>
        <Icon className="h-3 w-3" />
      </span>
      <div className="min-w-0">
        <p className={`truncate text-xs font-bold leading-tight ${t.value}`}>{value}</p>
        <p className="truncate text-[9px] font-medium leading-tight text-slate-500">{label}</p>
        {sub && <p className="truncate text-[8px] leading-tight text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

const INSIGHT_ICON: Record<string, { icon: typeof Info; cls: string }> = {
  good: { icon: TrendingUp, cls: "bg-emerald-50 text-emerald-600" },
  info: { icon: Info, cls: "bg-sky-50 text-sky-600" },
  warn: { icon: AlertTriangle, cls: "bg-amber-50 text-amber-600" },
  bad: { icon: TrendingDown, cls: "bg-rose-50 text-rose-600" },
};

export function CloviaInboundOverview({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<CallInsights | null>(null);
  const [prev, setPrev] = useState<CallInsights | null>(null);
  const [lob, setLob] = useState<LobPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const prevRange = previousPeriod(from, to);
    Promise.all([
      hrmsApi.get<{ success: boolean; data: CallInsights | null }>(`/api/inbound-insights/clovia?startDate=${from}&endDate=${to}`),
      hrmsApi.get<{ success: boolean; data: CallInsights | null }>(`/api/inbound-insights/clovia?startDate=${prevRange.from}&endDate=${prevRange.to}`),
      hrmsApi.get<{ success: boolean; data: LobPayload }>(`/api/process-performance/clovia-lob/inbound?from=${from}&to=${to}`),
    ])
      .then(([cur, prv, lb]) => {
        if (cancelled) return;
        setData(cur.data);
        setPrev(prv.data);
        setLob(lb.data);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load the Inbound overview."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const kpis = lob?.kpis ?? [];

  if (loading && !data) return <Spinner tone="blue" />;
  if (error && !data) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const h = data.headline;
  const ph = prev?.headline;
  const rechurnPct = h.offered > 0 && kpiVal(kpis, "rcN") !== null ? Math.round(((kpiVal(kpis, "rcN") as number) / h.offered) * 1000) / 10 : null;
  const uniquePctOfOffered = h.offered > 0 ? Math.round((h.uniqueCallers / h.offered) * 1000) / 10 : null;
  const combinedInsights = [
    ...data.insights.slice(0, 4),
    ...(lob?.insights ?? []).filter((i) => i.tab === "csat" || i.tab === "rechurn").slice(0, 2),
  ].slice(0, 6);

  return (
    <div className="space-y-3">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-600 via-pink-600 to-rose-700 px-4 py-3 text-white shadow-lg">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{ backgroundImage: "radial-gradient(circle at 15% 20%, white, transparent 45%), radial-gradient(circle at 85% 85%, white, transparent 40%)" }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold leading-tight sm:text-lg">Inbound Dashboard</h2>
            <p className="text-[11px] text-white/80">Track performance, improve experience, deliver excellence</p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">
              {formatShortDate(from)} – {formatShortDate(to)}
            </span>
            <span className="font-serif text-sm italic text-white/90">Clovia</span>
          </div>
        </div>
      </div>

      {/* Primary KPI row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile icon={PhoneCall} tone="rose" label="Call Offered" value={fmtNum(h.offered)}
          sub={`${h.avgCallsPerDay}/day`} delta={ph ? delta(h.offered, ph.offered) : null} />
        <StatTile icon={PhoneIncoming} tone="indigo" label="Call Answered" value={fmtNum(h.answered)}
          sub={`${h.answeredPct}% Answer Rate`} delta={ph ? delta(h.answered, ph.answered) : null} />
        <StatTile icon={Users} tone="emerald" label="Unique Calls" value={fmtNum(h.uniqueCallers)}
          sub={uniquePctOfOffered !== null ? `${uniquePctOfOffered}% of Offered` : undefined} delta={ph ? delta(h.uniqueCallers, ph.uniqueCallers) : null} />
        <StatTile icon={Repeat} tone="amber" label="Repeat Calls" value={fmtNum(h.repeatCallers)}
          sub={`${h.repeatCallerPct}% Repeat Rate`} delta={ph ? delta(h.repeatCallers, ph.repeatCallers) : null} />
        <StatTile icon={PhoneForwarded} tone="violet" label="Rechurn Calls" value={kpiFmt(kpis, "rcN")}
          sub={rechurnPct !== null ? `${rechurnPct}% of Offered` : undefined} />
      </div>

      {/* Trend + Key Highlights */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard icon={PhoneCall} title="Call Trend" tone="rose" footnote="Offered, Answered and Unique callers by day. Repeat calls have no daily breakdown in the source data, only a whole-range total (shown above), so it is not plotted here.">
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} />
                <Tooltip labelFormatter={(v: unknown) => formatShortDate(String(v))} contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="offered" name="Offered" stroke="#e11d48" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="answered" name="Answered" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="uniqueCallers" name="Unique" stroke="#10b981" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </SectionCard>
        </div>
        <SectionCard icon={Lightbulb} title="Key Highlights" tone="amber">
          {combinedInsights.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>
          ) : (
            <ul className="max-h-[200px] space-y-1.5 overflow-y-auto pr-1">
              {combinedInsights.map((ins, i) => {
                const cfg = INSIGHT_ICON[ins.tone] ?? INSIGHT_ICON.info;
                const Icon = cfg.icon;
                return (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${cfg.cls}`}>
                      <Icon className="h-2.5 w-2.5" />
                    </span>
                    <span className="text-[11px] leading-snug text-slate-600">{ins.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Secondary KPI strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat icon={Timer} tone="rose" label="Avg Talk Time" value={fmtSec(h.avgTalk)} />
        <MiniStat icon={Hourglass} tone="cyan" label="Avg Speed of Answer" value={fmtSec(h.asa)} />
        <MiniStat icon={MessageSquareHeart} tone="sky" label="Feedback Received" value={kpiFmt(kpis, "fbN")} />
        <MiniStat icon={Smile} tone="emerald" label="C-SAT %" value={kpiFmt(kpis, "csatPct")} />
        <MiniStat icon={Frown} tone="red" label="D-SAT %" value={kpiFmt(kpis, "dsatPct")} />
        <MiniStat icon={ShieldCheck} tone="violet" label="Avg Quality Score" value={kpiFmt(kpis, "avgQuality")} />
      </div>

      <div className="flex items-center justify-center gap-1.5 py-1 text-rose-400">
        <Quote className="h-3 w-3" />
        <p className="font-serif text-xs italic">Happy Customers, Stronger Brand</p>
        <Quote className="h-3 w-3 -scale-x-100" />
      </div>
    </div>
  );
}
