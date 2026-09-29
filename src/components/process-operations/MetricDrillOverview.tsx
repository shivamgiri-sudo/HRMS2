import { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type YAxisProps,
} from "recharts";
import { AlertTriangle, CheckCircle2, Info, TrendingDown, TrendingUp } from "lucide-react";
import { formatValue, isPercentUnit } from "./kpi-deck-model";
import {
  WEEKDAY_LABELS, computeDrillStats, type DayStatus, type DrillPoint, type DrillReading, type Insight,
} from "./metric-drill-model";

const C = { pass: "#059669", fail: "#e11d48", none: "#64748b", line: "#2563eb", ma: "#7c3aed", vol: "#cbd5e1", missing: "#e2e8f0" };
const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
const colorOf = (s: DayStatus | "missing") => (s === "pass" ? C.pass : s === "fail" ? C.fail : s === "none" ? C.none : C.missing);

export interface MetricDrillOverviewProps {
  name: string; unit: string | null; direction: string | null; target: number | null;
  readings: DrillReading[]; basis: string;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : "text-slate-900 dark:text-slate-100";
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-lg font-extrabold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function ChartTooltip({ active, payload, fmt, target, hasTarget }: { active?: boolean; payload?: Array<{ payload: DrillPoint }>; fmt: (v: number) => string; target: number | null; hasTarget: boolean }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <p className="font-bold text-slate-900 dark:text-slate-100">{p.date} · {WEEKDAY_LABELS[p.weekday]}</p>
      <p className="mt-1 text-base font-extrabold" style={{ color: colorOf(p.status) }}>{fmt(p.value)}</p>
      {hasTarget && target !== null && p.gap !== null && (
        <p className="text-slate-600 dark:text-slate-300">{p.gap > 0 ? `${fmt(Math.abs(p.gap))} short of target` : `${fmt(Math.abs(p.gap))} ahead of target`}</p>
      )}
      {p.ma !== null && <p className="text-slate-500">7-day average {fmt(p.ma)}</p>}
      {p.numerator !== null && p.denominator !== null && <p className="text-slate-500">{p.numerator.toLocaleString("en-IN")} of {p.denominator.toLocaleString("en-IN")}</p>}
    </div>
  );
}

const TONE_ICON = { good: CheckCircle2, warn: AlertTriangle, bad: AlertTriangle, info: Info } as const;
const TONE_CLS = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  bad: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
  info: "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
} as const;
function InsightRow({ i }: { i: Insight }) {
  const Icon = TONE_ICON[i.tone];
  return <li className={`flex items-start gap-2 rounded-xl border p-2.5 text-xs leading-relaxed ${TONE_CLS[i.tone]}`}><Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{i.text}</li>;
}

export function MetricDrillOverview({ name, unit, direction, target, readings, basis }: MetricDrillOverviewProps) {
  const fmt = (v: number) => formatValue(v, unit);
  const s = useMemo(() => computeDrillStats({ readings, target, direction }, fmt), [readings, target, direction, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showMa, setShowMa] = useState(true);
  const [showVol, setShowVol] = useState(true);
  const hasTarget = target !== null && !!direction;
  const hasVolume = s.points.some((p) => p.denominator !== null);
  const pct = isPercentUnit(unit);
  const higher = direction !== "lower_is_better";

  if (!s.latest) {
    return <div className={`${CARD} p-8 text-center text-sm text-slate-500`}>No readings in this window for {name}, so there is nothing to chart yet.</div>;
  }

  const lat = s.latest;
  const statusTxt = lat.status === "pass" ? "On target" : lat.status === "fail" ? "Below target" : "No target set";
  const delta = s.last7Avg !== null && s.prev7Avg !== null ? s.last7Avg - s.prev7Avg : null;
  const deltaGood = delta === null ? null : higher ? delta > 0 : delta < 0;
  const yDomain: YAxisProps["domain"] = pct
    ? [(min: number) => Math.max(0, Math.floor((Math.min(min, target ?? min) - 5) / 5) * 5), (max: number) => Math.min(100, Math.ceil((Math.max(max, target ?? max) + 3) / 5) * 5)]
    : ["auto", "auto"];
  const weekData = s.weekdays.map((w) => ({ ...w, avg: w.avg }));
  const streakTxt = s.streak && s.streak.status !== "none" ? `${s.streak.length} day${s.streak.length === 1 ? "" : "s"} ${s.streak.status === "pass" ? "on target" : "below"}` : "—";

  return (
    <div className="space-y-4">
      <section className={`${CARD} p-4`} aria-label="Summary">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.6fr)]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Latest reading · {lat.date}</p>
            <p className="text-5xl font-black leading-tight tabular-nums" style={{ color: colorOf(lat.status) }}>{fmt(lat.value)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: `${colorOf(lat.status)}1a`, color: colorOf(lat.status) }}>{statusTxt}</span>
              {hasTarget && <span className="text-xs text-slate-500">target {higher ? "≥" : "≤"} {fmt(target as number)}</span>}
            </div>
            {hasTarget && lat.gap !== null && (
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200"><b style={{ color: colorOf(lat.status) }}>{fmt(Math.abs(lat.gap))}</b> {lat.gap > 0 ? "short of" : "ahead of"} target</p>
            )}
            {delta !== null && (
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                {delta > 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                <b className={deltaGood ? "text-emerald-600" : "text-rose-600"}>{delta > 0 ? "up" : "down"} {fmt(Math.abs(delta))}</b> on the 7 readings before ({basis})
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Average" value={s.mean === null ? "—" : fmt(s.mean)} sub={s.median === null ? undefined : `median ${fmt(s.median)}`} />
            <Stat label="Best day" value={s.best ? fmt(s.best.value) : "—"} sub={s.best?.date} tone="good" />
            <Stat label="Worst day" value={s.worst ? fmt(s.worst.value) : "—"} sub={s.worst?.date} tone="bad" />
            <Stat label="Days on target" value={s.passPct === null ? "—" : `${s.passPct}%`} sub={hasTarget ? `${s.passDays} of ${s.passDays + s.failDays}` : "no target set"} tone={s.passPct === null ? undefined : s.passPct >= 80 ? "good" : s.passPct >= 50 ? "warn" : "bad"} />
            <Stat label="Current run" value={streakTxt} sub={`${s.n} readings shown`} tone={s.streak?.status === "fail" ? "bad" : s.streak?.status === "pass" ? "good" : undefined} />
            <Stat label="Trend per day" value={s.slopePerDay === null ? "—" : `${s.slopePerDay > 0 ? "+" : ""}${pct ? s.slopePerDay.toFixed(2) : fmt(s.slopePerDay)}${pct ? " pt" : ""}`} sub={s.r2 === null ? "needs 4+ readings" : `fit ${Math.round(s.r2 * 100)}%`}
              tone={s.slopePerDay === null || Math.abs(s.slopePerDay) < 0.005 ? undefined : (higher ? s.slopePerDay > 0 : s.slopePerDay < 0) ? "good" : "bad"} />
          </div>
        </div>
      </section>

      <section className={`${CARD} p-4`} aria-label="Trend chart">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Day by day against target</h3>
          <div className="ml-auto flex gap-2 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={showMa} onChange={(e) => setShowMa(e.target.checked)} />7-day average</label>
            {hasVolume && <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={showVol} onChange={(e) => setShowVol(e.target.checked)} />Volume (calls / cases)</label>}
          </div>
        </div>
        <div className="h-80 w-full" role="img" aria-label={`${name} by day, with target and 7-day average`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={s.points} margin={{ top: 10, right: hasVolume && showVol ? 8 : 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="drillFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.line} stopOpacity={0.28} /><stop offset="100%" stopColor={C.line} stopOpacity={0.02} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis yAxisId="v" domain={yDomain} tickFormatter={(v: number) => (pct ? `${v}` : fmt(v))} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={48} />
              {hasVolume && showVol && <YAxis yAxisId="vol" orientation="right" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={44} />}
              {hasVolume && showVol && <Bar yAxisId="vol" dataKey="denominator" fill={C.vol} opacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={26} name="Volume" />}
              {hasTarget && <ReferenceLine yAxisId="v" y={target as number} stroke="#0f172a" strokeDasharray="5 4" label={{ value: `target ${fmt(target as number)}`, position: "insideTopRight", fontSize: 11, fill: "#0f172a" }} />}
              <Area yAxisId="v" type="monotone" dataKey="value" stroke={C.line} strokeWidth={2.4} fill="url(#drillFill)" name={name}
                dot={(p: { cx?: number; cy?: number; payload?: DrillPoint; index?: number }) => (
                  <circle key={`d-${p.index}`} cx={p.cx} cy={p.cy} r={4} fill={colorOf(p.payload?.status ?? "none")} stroke="#fff" strokeWidth={1.5} />
                )}
                activeDot={{ r: 6 }} />
              {showMa && <Line yAxisId="v" type="monotone" dataKey="ma" stroke={C.ma} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls name="7-day average" />}
              <Tooltip content={<ChartTooltip fmt={fmt} target={target} hasTarget={hasTarget} />} />
              {s.n > 14 && <Brush dataKey="date" height={22} stroke="#94a3b8" travellerWidth={8} tickFormatter={(v: string) => v.slice(5)} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Dots are coloured by status: <b style={{ color: C.pass }}>green</b> met target, <b style={{ color: C.fail }}>red</b> missed, <b style={{ color: C.none }}>grey</b> no target. Hover any point for the day's detail.</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className={`${CARD} p-4`} aria-label="Weekday pattern">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Which weekdays are strong or weak</h3>
          <p className="mb-2 text-[11px] text-slate-500">Average by weekday over the readings shown.</p>
          <div className="h-56 w-full" role="img" aria-label="Average value by weekday">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis domain={yDomain} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => (pct ? `${v}` : fmt(v))} />
                {hasTarget && <ReferenceLine y={target as number} stroke="#0f172a" strokeDasharray="5 4" />}
                <Tooltip formatter={(v: number, _n: string, p: { payload?: { n: number; pass: number; fail: number } }) => [`${fmt(v)} (${p.payload?.n ?? 0} days: ${p.payload?.pass ?? 0} on / ${p.payload?.fail ?? 0} below)`, "Average"]} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="avg" radius={[6, 6, 0, 0]} maxBarSize={38}>
                  {weekData.map((w) => <Cell key={w.label} fill={w.avg === null ? C.missing : !hasTarget ? C.line : (higher ? (w.avg as number) >= (target as number) : (w.avg as number) <= (target as number)) ? C.pass : C.fail} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className={`${CARD} p-4`} aria-label="Distribution">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">How the readings are spread</h3>
          <p className="mb-2 text-[11px] text-slate-500">Number of days in each value range{hasTarget ? "; the outlined bar holds the target" : ""}.</p>
          {s.bins.length ? (
            <div className="h-56 w-full" role="img" aria-label="Histogram of daily values">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.bins} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip formatter={(v: number) => [`${v} day${v === 1 ? "" : "s"}`, "In this range"]} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {s.bins.map((b) => {
                      const mid = (b.from + b.to) / 2;
                      const ok = !hasTarget ? true : higher ? mid >= (target as number) : mid <= (target as number);
                      return <Cell key={b.label} fill={!hasTarget ? C.line : ok ? C.pass : C.fail} stroke={b.hasTarget ? "#0f172a" : "none"} strokeWidth={b.hasTarget ? 2 : 0} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-16 text-center text-xs text-slate-400">Needs 3 or more readings with some variation.</p>}
        </section>
      </div>

      <section className={`${CARD} p-4`} aria-label="Calendar">
        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Calendar view</h3>
        <p className="mb-3 text-[11px] text-slate-500">Each square is a day: green met target, red missed, grey no target, empty no reading.</p>
        <div className="overflow-x-auto">
          <div className="inline-grid gap-1" style={{ gridTemplateColumns: `36px repeat(${s.calendar.length}, 34px)` }}>
            {WEEKDAY_LABELS.map((wd, row) => (
              <div key={wd} className="contents">
                <span className="self-center text-[10px] font-semibold text-slate-400">{wd}</span>
                {s.calendar.map((week, col) => {
                  const c = week[row];
                  return (
                    <div key={`${wd}-${col}`} title={`${c.date}${c.value !== null ? ` · ${fmt(c.value)}` : " · no reading"}`}
                      className="flex h-8 w-[34px] items-center justify-center rounded-md text-[9px] font-bold text-white"
                      style={c.status === "missing" ? { border: "1px dashed #cbd5e1" } : { background: colorOf(c.status), opacity: c.status === "none" ? 0.6 : 0.92 }}>
                      {c.status !== "missing" ? c.date.slice(8) : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={`${CARD} p-4`} aria-label="What this says">
        <h3 className="mb-2 text-sm font-extrabold text-slate-900 dark:text-slate-100">What this says</h3>
        <ul className="grid gap-2 lg:grid-cols-2">{s.insights.map((i, k) => <InsightRow key={k} i={i} />)}</ul>
      </section>
    </div>
  );
}
