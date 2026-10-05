import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle, CalendarDays, CheckCircle2, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Spinner } from "./DashboardKit";
import {
  WEEK_LABELS, DateRangeInputs, fmtDay, num, pct, ratio, sumCounts, weekTotals, type Analysis, type Counts, type Row,
} from "./AltRxShared";

/**
 * ALT RX Process Performance Dashboard. Layout follows the source dashboard: navy banner with
 * Month and View By, six KPI cards compared with Week-1, daily / weekly / TAT / FRT charts, and
 * the brand, agent and comment tables with week and day columns. Every row opens a drill-down.
 */

const COLORS = { inflow: "#3b5bdb", closure: "#2f9e44", closurePct: "#f08c00", within: "#7048e8", out: "#e03131", frt: "#15aabf" };
const NAVY = "#1e2a5e";

type Metric = "inflow" | "closure" | "closurePct" | "open" | "within" | "out" | "frtPct";
type ViewBy = "MTD" | (typeof WEEK_LABELS)[number];

const metricValue = (c: Counts, m: Metric): number | null => {
  switch (m) {
    case "inflow": return c.inflow;
    case "closure": return c.closure;
    case "closurePct": return ratio(c.closure, c.inflow);
    case "open": return c.inflow - c.closure;
    case "within": return c.within;
    case "out": return c.out;
    case "frtPct": return ratio(c.within, c.inflow);
  }
};
const isPctMetric = (m: Metric) => m === "closurePct" || m === "frtPct";
const fmtMetric = (v: number | null, m: Metric) => (v === null ? "-" : isPctMetric(m) ? pct(v) : num(v));

/** Picks the days shown (selected month) and re-sums rows for them. */
function scopeRows(rows: Row[], keepIdx: number[], days: string[], all: boolean): Array<{ key: string; mtd: Counts; weeks: Counts[]; daily: Counts[] }> {
  return rows.map((r) => {
    const daily = keepIdx.map((i) => r.daily[i]);
    return { key: r.key, mtd: all ? r.mtd : sumCounts(daily), weeks: weekTotals(keepIdx.map((i) => days[i]), daily), daily };
  });
}

function MetricGrid({
  title, nameHeader, rows, days, metric, onRow,
}: {
  title: string; nameHeader: string; rows: Array<{ key: string; mtd: Counts; weeks: Counts[]; daily: Counts[] }>;
  days: string[]; metric: Metric; onRow?: (key: string) => void;
}) {
  const total = sumCounts(rows.map((r) => r.mtd));
  const weekTotal = WEEK_LABELS.map((_, w) => sumCounts(rows.map((r) => r.weeks[w])));
  const dayTotal = days.map((_, i) => sumCounts(rows.map((r) => r.daily[i])));
  const cell = (c: Counts) => fmtMetric(metricValue(c, metric), metric);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[11px]">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr style={{ background: NAVY }} className="text-white">
            <th scope="col" className="sticky left-0 whitespace-nowrap px-2 py-1.5 text-left font-semibold" style={{ background: NAVY }}>{nameHeader}</th>
            <th scope="col" className="px-2 py-1.5 text-right font-semibold">MTD</th>
            {WEEK_LABELS.map((w) => <th scope="col" key={w} className="px-2 py-1.5 text-right font-semibold">{w}</th>)}
            {days.map((d) => <th scope="col" key={d} className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">{fmtDay(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.key}
              onClick={onRow ? () => onRow(r.key) : undefined}
              className={`${idx % 2 ? "bg-white" : "bg-slate-50"} ${onRow ? "cursor-pointer hover:bg-amber-50" : ""}`}
            >
              <td className="sticky left-0 whitespace-nowrap px-2 py-1 font-medium text-slate-700" style={{ background: idx % 2 ? "#fff" : "#f8fafc" }}>{r.key}</td>
              <td className="px-2 py-1 text-right tabular-nums">{cell(r.mtd)}</td>
              {r.weeks.map((w, i) => <td key={i} className="px-2 py-1 text-right tabular-nums">{cell(w)}</td>)}
              {r.daily.map((d, i) => <td key={i} className="px-2 py-1 text-right tabular-nums">{cell(d)}</td>)}
            </tr>
          ))}
          <tr style={{ background: NAVY }} className="font-bold text-white">
            <td className="sticky left-0 px-2 py-1.5" style={{ background: NAVY }}>Grand Total</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{cell(total)}</td>
            {weekTotal.map((w, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums">{cell(w)}</td>)}
            {dayTotal.map((d, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums">{cell(d)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DetailDrawer({
  title, rowKey, rows, days, onClose,
}: {
  title: string; rowKey: string; rows: Array<{ key: string; mtd: Counts; weeks: Counts[]; daily: Counts[] }>; days: string[]; onClose: () => void;
}) {
  const row = rows.find((r) => r.key === rowKey);
  if (!row) return null;
  const m = row.mtd;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${title} detail`}>
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
            <h2 className="text-base font-bold text-slate-800">{row.key}</h2>
            <p className="mt-1 text-xs text-slate-500">
              MTD: inflow {num(m.inflow)} · closed {num(m.closure)} · closure {pct(ratio(m.closure, m.inflow))} · within TAT {num(m.within)} · out of TAT {num(m.out)} · FRT {pct(ratio(m.within, m.inflow))}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Week-wise</p>
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-1.5">Week</th><th className="py-1.5 text-right">Inflow</th><th className="py-1.5 text-right">Closure</th><th className="py-1.5 text-right">Within</th><th className="py-1.5 text-right">Out</th><th className="py-1.5 text-right">FRT %</th></tr></thead>
              <tbody>
                {WEEK_LABELS.map((w, i) => (
                  <tr key={w} className="border-b border-slate-100">
                    <td className="py-1.5">{w}</td>
                    <td className="py-1.5 text-right tabular-nums">{num(row.weeks[i].inflow)}</td>
                    <td className="py-1.5 text-right tabular-nums">{num(row.weeks[i].closure)}</td>
                    <td className="py-1.5 text-right tabular-nums">{num(row.weeks[i].within)}</td>
                    <td className="py-1.5 text-right tabular-nums">{num(row.weeks[i].out)}</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(ratio(row.weeks[i].within, row.weeks[i].inflow))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Day-wise</p>
            {days.length === 0 ? <p className="text-sm text-slate-500">None</p> : (
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-1.5">Date</th><th className="py-1.5 text-right">Inflow</th><th className="py-1.5 text-right">Closure</th><th className="py-1.5 text-right">Within</th><th className="py-1.5 text-right">Out</th><th className="py-1.5 text-right">FRT %</th></tr></thead>
                <tbody>
                  {days.map((d, i) => (
                    <tr key={d} className="border-b border-slate-100">
                      <td className="py-1.5">{fmtDay(d)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(row.daily[i].inflow)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(row.daily[i].closure)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(row.daily[i].within)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(row.daily[i].out)}</td>
                      <td className="py-1.5 text-right tabular-nums">{pct(ratio(row.daily[i].within, row.daily[i].inflow))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function Panel({ title, children, legend }: { title: string; children: React.ReactNode; legend?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {legend}
      </div>
      {children}
    </div>
  );
}

function KpiTile({
  label, value, sub, subTone, color,
}: { label: string; value: string; sub: string; subTone: "up" | "down" | "flat"; color: string }) {
  const arrow = subTone === "up" ? "▲" : subTone === "down" ? "▼" : "•";
  const tone = subTone === "up" ? "text-emerald-600" : subTone === "down" ? "text-rose-600" : "text-slate-500";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-block h-7 w-7 rounded-lg" style={{ background: color }} />
        <span className="text-xs font-semibold text-slate-600">{label}</span>
      </div>
      <p className="mt-2 text-center text-2xl font-extrabold tabular-nums text-slate-800">{value}</p>
      <p className={`mt-1 text-center text-[11px] font-semibold ${tone}`}>{arrow} {sub}</p>
    </div>
  );
}

const changeText = (cur: number | null, base: number | null, isPct: boolean, baseLabel: string) => {
  if (cur === null || base === null) return { text: `no ${baseLabel} data`, tone: "flat" as const };
  if (isPct) {
    const d = (cur - base) * 100;
    return { text: `${Math.abs(d).toFixed(0)}% ${d > 0 ? "up" : d < 0 ? "down" : "same"} vs ${baseLabel}`, tone: d > 0 ? "up" as const : d < 0 ? "down" as const : "flat" as const };
  }
  if (base === 0) return { text: cur === 0 ? `same as ${baseLabel} (0)` : `vs ${baseLabel} (0)`, tone: cur > 0 ? "up" as const : "flat" as const };
  const d = ((cur - base) / base) * 100;
  return { text: `${Math.abs(d).toFixed(0)}% ${d > 0 ? "up" : d < 0 ? "down" : "same"} vs ${baseLabel} (${num(base)})`, tone: d > 0 ? "up" as const : d < 0 ? "down" as const : "flat" as const };
};

interface DataResponse {
  success: boolean;
  data: Analysis | null;
  batch: { batchId: string; fileName: string; uploadedAt: string; importedRows: number } | null;
  available: { from: string | null; to: string | null } | null;
  selected: { from: string | null; to: string | null } | null;
}

export function AltRxDashboard() {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [batch, setBatch] = useState<DataResponse["batch"]>(null);
  const [error, setError] = useState("");
  const [viewBy, setViewBy] = useState<ViewBy>("MTD");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [available, setAvailable] = useState<{ from: string | null; to: string | null } | null>(null);
  const [drill, setDrill] = useState<{ title: string; key: string; kind: "agent" | "brand" | "type" } | null>(null);

  // The server filters the Dump to the selected created-day range, so every figure here is for that range.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    hrmsApi.get<DataResponse>(`/api/process-performance/alt-rx/data${suffix}`)
      .then((res) => {
        if (cancelled) return;
        setAnalysis(res.data ?? null);
        setBatch(res.batch ?? null);
        setAvailable(res.available ?? null);
        // First load: show the whole Dump, so the range inputs start at its first and last day.
        if (!from && !to && res.selected) {
          setFrom(res.selected.from ?? "");
          setTo(res.selected.to ?? "");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "The dashboard could not be loaded.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const keepIdx = useMemo(() => (analysis ? analysis.days.map((_, i) => i) : []), [analysis]);
  const monthDays = useMemo(() => (analysis ? analysis.days : []), [analysis]);
  const allMonth = true;

  const view = useMemo(() => {
    if (!analysis) return null;
    const daily = keepIdx.map((i) => analysis.daily[i]);
    const headline = allMonth ? analysis.headline : sumCounts(daily);
    const weeks = weekTotals(monthDays, daily);
    const agents = scopeRows(analysis.agents.rows, keepIdx, analysis.days, allMonth);
    const types = scopeRows(analysis.types.rows, keepIdx, analysis.days, allMonth);
    const brands = scopeRows(analysis.brands.rows, keepIdx, analysis.days, allMonth);
    const shown = viewBy === "MTD" ? headline : weeks[WEEK_LABELS.indexOf(viewBy)];
    return { daily, headline, weeks, agents, types, brands, shown };
  }, [analysis, keepIdx, monthDays, allMonth, viewBy]);

  if (loading && !analysis) return <Spinner />;

  if (!analysis || !view) {
    return (
      <div className="space-y-4">
        <Banner />
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">No ALT RX Dump has been uploaded yet.</p>
          <p className="mt-1 text-xs text-slate-500">Upload the ticket Dump on the Uploader page. The dashboard shows it as soon as the upload is imported.</p>
        </div>
        {error && <ErrorBox message={error} />}
      </div>
    );
  }

  const h = view.shown;
  const w1 = view.weeks[0];
  const comparison = (cur: number | null, base: number | null, isPct: boolean) => changeText(cur, base, isPct, "Week-1");
  const kpiCards: Array<{ label: string; value: string; cur: number | null; base: number | null; isPct: boolean; color: string }> = [
    { label: "Total Inflow", value: num(h.inflow), cur: h.inflow, base: w1.inflow, isPct: false, color: COLORS.inflow },
    { label: "Total Closure", value: num(h.closure), cur: h.closure, base: w1.closure, isPct: false, color: COLORS.closure },
    { label: "Closure %", value: pct(ratio(h.closure, h.inflow)), cur: ratio(h.closure, h.inflow), base: ratio(w1.closure, w1.inflow), isPct: true, color: COLORS.closurePct },
    { label: "Within TAT", value: num(h.within), cur: h.within, base: w1.within, isPct: false, color: COLORS.within },
    { label: "Out of TAT", value: num(h.out), cur: h.out, base: w1.out, isPct: false, color: COLORS.out },
    { label: "FRT %", value: pct(ratio(h.within, h.inflow)), cur: ratio(h.within, h.inflow), base: ratio(w1.within, w1.inflow), isPct: true, color: COLORS.frt },
  ];

  const dailyChart = monthDays.map((d, i) => ({
    date: fmtDay(d), inflow: view.daily[i].inflow, closure: view.daily[i].closure,
    frt: ratio(view.daily[i].within, view.daily[i].inflow),
  }));
  const weekChart = WEEK_LABELS.map((w, i) => ({
    week: w, inflow: view.weeks[i].inflow, closure: view.weeks[i].closure, within: view.weeks[i].within, out: view.weeks[i].out,
    frt: ratio(view.weeks[i].within, view.weeks[i].inflow),
  }));

  const brandRows = view.brands;
  const brandsWithTraffic = brandRows.filter((r) => r.mtd.inflow > 0 || r.mtd.closure > 0);
  const brandShown = brandsWithTraffic.length > 0 ? brandsWithTraffic : brandRows;

  return (
    <div className="space-y-4">
      <Banner
        right={(
          <>
            <DateRangeInputs
              from={from}
              to={to}
              min={available?.from ?? undefined}
              max={available?.to ?? undefined}
              onFrom={setFrom}
              onTo={setTo}
              onReset={() => { setFrom(available?.from ?? ""); setTo(available?.to ?? ""); }}
            />
            <label className="flex flex-col rounded-lg bg-white px-3 py-1.5 text-[11px] text-slate-500">
              View By
              <select value={viewBy} onChange={(e) => setViewBy(e.target.value as ViewBy)} className="mt-0.5 bg-transparent text-sm font-semibold text-slate-800 outline-none">
                <option value="MTD">MTD</option>
                {WEEK_LABELS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
          </>
        )}
      />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-600">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <span className="font-semibold text-slate-800">{batch?.fileName ?? "ALT RX Dump"}</span>
        {batch?.uploadedAt && <span>· uploaded {batch.uploadedAt.slice(0, 16).replace("T", " ")}</span>}
        <span>· {analysis.file.rows} rows · {fmtDay(monthDays[0] ?? analysis.days[0] ?? "")} to {fmtDay(monthDays[monthDays.length - 1] ?? "")}</span>
        {(analysis.skipped.duplicateTicketIds > 0 || analysis.skipped.missingDate > 0) && (
          <span className="text-amber-700">· skipped {analysis.skipped.duplicateTicketIds} duplicate ticket(s), {analysis.skipped.missingDate} without a created time</span>
        )}
      </div>

      {error && <ErrorBox message={error} />}

      {analysis.headline.tickets === 0 && available?.from && available?.to && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            No tickets were created between {fmtDay(from)} and {fmtDay(to)}.
            This Dump covers {fmtDay(available.from)} to {fmtDay(available.to)}.
          </span>
          <button
            type="button"
            onClick={() => { setFrom(available.from ?? ""); setTo(available.to ?? ""); }}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            Show {fmtDay(available.from)} to {fmtDay(available.to)}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="grid grid-cols-2 gap-3 xl:col-span-1">
          {kpiCards.map((k) => {
            const c = comparison(k.cur, k.base, k.isPct);
            return <KpiTile key={k.label} label={k.label} value={k.value} sub={c.text} subTone={c.tone} color={k.color} />;
          })}
        </div>
        <div className="xl:col-span-2">
          <Panel
            title="Daily Trend (Inflow vs Closure)"
            legend={<ChartLegend />}
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyChart} margin={{ top: 18, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="n" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                  <Tooltip formatter={(v, n) => (n === "FRT %" ? pct(Number(v)) : num(Number(v)))} />
                  <Bar yAxisId="n" dataKey="inflow" name="Inflow" fill={COLORS.inflow} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="n" dataKey="closure" name="Closure" fill={COLORS.closure} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="p" type="monotone" dataKey="frt" name="FRT %" stroke={COLORS.closurePct} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Weekly Trend (Inflow vs Closure)" legend={<ChartLegend />}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekChart} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="inflow" name="Inflow" fill={COLORS.inflow} radius={[4, 4, 0, 0]} />
                <Bar dataKey="closure" name="Closure" fill={COLORS.closure} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="TAT Performance" legend={<ChartLegend />}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekChart} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="within" name="Within TAT" fill={COLORS.closure} radius={[4, 4, 0, 0]} />
                <Bar dataKey="out" name="Out of TAT" fill={COLORS.out} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="FRT % Trend">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekChart} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                <Tooltip formatter={(v) => pct(Number(v))} />
                <Line type="monotone" dataKey="frt" name="FRT %" stroke={COLORS.frt} strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <TableCard title="Brand Wise Performance (All Metrics)">
        <MetricGrid title="Brand Wise Performance" nameHeader="Over All Brands" rows={brandShown} days={monthDays} metric="inflow" onRow={(k) => setDrill({ title: "Brand", key: k, kind: "brand" })} />
      </TableCard>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TableCard title="Brand Wise Closure">
          <MetricGrid title="Brand Wise Closure" nameHeader="Over All Brands" rows={brandShown} days={monthDays} metric="closure" onRow={(k) => setDrill({ title: "Brand", key: k, kind: "brand" })} />
        </TableCard>
        <TableCard title="Brand Wise Closure %">
          <MetricGrid title="Brand Wise Closure %" nameHeader="Over All Brands" rows={brandShown} days={monthDays} metric="closurePct" onRow={(k) => setDrill({ title: "Brand", key: k, kind: "brand" })} />
        </TableCard>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <TableCard title="Agent Wise Closure">
          <MetricGrid title="Agent Wise Closure" nameHeader="Agent" rows={view.agents} days={monthDays} metric="closure" onRow={(k) => setDrill({ title: "Agent", key: k, kind: "agent" })} />
        </TableCard>
        <TableCard title="Agent Wise Open (not yet closed)">
          <MetricGrid title="Agent Wise Open" nameHeader="Agent" rows={view.agents} days={monthDays} metric="open" onRow={(k) => setDrill({ title: "Agent", key: k, kind: "agent" })} />
        </TableCard>
      </div>
      <TableCard title="Comments Wise Performance">
        <MetricGrid title="Comments Wise Performance" nameHeader="Comment Type" rows={view.types} days={monthDays} metric="inflow" onRow={(k) => setDrill({ title: "Comment type", key: k, kind: "type" })} />
      </TableCard>

      {drill && (
        <DetailDrawer
          title={drill.title}
          rowKey={drill.key}
          days={monthDays}
          rows={drill.kind === "agent" ? view.agents : drill.kind === "brand" ? view.brands : view.types}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

function Banner({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl px-5 py-4 text-white md:flex-row md:items-center md:justify-between" style={{ background: NAVY }}>
      <div className="flex items-center gap-4">
        <span className="text-2xl font-black tracking-tight">
          Alt<span className="text-amber-400">Rx</span>
        </span>
        <div>
          <h2 className="text-lg font-bold">AltRx Process Performance Dashboard</h2>
          <p className="text-xs text-slate-300">Inbound Performance | Agent Performance | Comment Analysis | Brand Wise Performance</p>
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

function ChartLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COLORS.inflow }} />Inflow</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COLORS.closure }} />Closure</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: COLORS.closurePct }} />FRT %</span>
    </div>
  );
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
