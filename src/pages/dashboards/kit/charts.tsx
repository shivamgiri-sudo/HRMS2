import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { InsightPoint, InsightUnit } from "../../../../backend/src/modules/dashboards/role-insights/types";
import { formatUnit } from "./format";
import { SERIES_COLORS, TONE, type Tone } from "./tone";

/* Dependency-free SVG charts: instant paint, ~no bundle cost, consistent look. */

const fmt = (v: number | null | undefined, unit?: InsightUnit) => { const f = formatUnit(v ?? null, unit); return `${f.text}${f.suffix}`; };

export function HealthRing({ value, label, size = 88, onDark = false }: { value: number; label: string; size?: number; onDark?: boolean }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 80 ? "#34d399" : v >= 60 ? "#fbbf24" : "#fb7185";
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${v}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={onDark ? "rgba(255,255,255,.18)" : "#e2e8f0"} strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className={cn("kit-num text-[22px] font-black", onDark ? "fill-white" : "fill-slate-900")}>{Math.round(v)}</text>
      </svg>
      <p className={cn("max-w-[110px] text-[12px] font-semibold leading-4", onDark ? "text-white/80" : "text-slate-600")}>{label}</p>
    </div>
  );
}

export function TrendChart({ points, unit, height = 180, color = SERIES_COLORS[0], area = true, keys }: {
  points: InsightPoint[]; unit?: InsightUnit; height?: number; color?: string; area?: boolean;
  keys?: Array<{ key: string; label: string; tone?: Tone }>;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const series = keys?.length ? keys : [{ key: "value", label: "", tone: undefined }];
  const vals = points.flatMap((p) => series.map((s) => Number(p[s.key])).filter(Number.isFinite));
  if (points.length < 2 || !vals.length) return <ChartEmpty />;
  const W = 640, H = height, L = 36, R = 10, T = 10, B = 22;
  const min = Math.min(0, ...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v: number) => T + (1 - (v - min) / span) * (H - T - B);
  const ticks = [0, 0.5, 1].map((f) => min + f * span);
  const step = Math.max(1, Math.ceil(points.length / 7));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const rel = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(points.length - 1, Math.round(((rel - L) / (W - L - R)) * (points.length - 1))))); }}>
        {ticks.map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e8edf4" /><text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{fmt(t, unit)}</text></g>
        ))}
        {series.map((s, si) => {
          const col = s.tone ? TONE[s.tone].hex : si === 0 && !keys ? color : SERIES_COLORS[si % SERIES_COLORS.length];
          const pts = points.map((p, i) => [x(i), Number(p[s.key])] as const).filter(([, v]) => Number.isFinite(v));
          const d = pts.map(([px, v], i) => `${i ? "L" : "M"}${px.toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          return (
            <g key={s.key}>
              {area && si === 0 ? (<>
                <defs><linearGradient id={`${id}${si}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".22" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
                <path d={`${d} L${pts[pts.length - 1][0]},${H - B} L${pts[0][0]},${H - B} Z`} fill={`url(#${id}${si})`} />
              </>) : null}
              <path d={d} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {points.map((p, i) => (i % step === 0 || i === points.length - 1) ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">{String(p.label).slice(-5)}</text> : null)}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="#94a3b8" strokeDasharray="3 3" /> : null}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute right-2 top-1 rounded-lg bg-slate-900/90 px-2.5 py-1.5 text-[11px] text-white shadow-lg">
          <p className="font-semibold">{String(points[hover].label)}</p>
          {series.map((s) => <p key={s.key}>{s.label ? `${s.label}: ` : ""}{fmt(Number(points[hover][s.key]), unit)}</p>)}
        </div>
      ) : null}
      {keys && keys.length > 1 ? <Legend items={keys.map((k, i) => ({ label: k.label, color: k.tone ? TONE[k.tone].hex : SERIES_COLORS[i % SERIES_COLORS.length] }))} /> : null}
    </div>
  );
}

export function BarsChart({ points, keys, unit, height = 180, stacked = false }: {
  points: InsightPoint[]; keys?: Array<{ key: string; label: string; tone?: Tone }>; unit?: InsightUnit; height?: number; stacked?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const series = keys?.length ? keys : [{ key: "value", label: "", tone: "blue" as Tone }];
  if (!points.length) return <ChartEmpty />;
  const totals = points.map((p) => series.reduce((sum, s) => sum + (Number(p[s.key]) || 0), 0));
  const max = Math.max(1, ...(stacked ? totals : points.flatMap((p) => series.map((s) => Number(p[s.key]) || 0))));
  const W = 640, H = height, L = 36, B = 22, T = 8;
  const band = (W - L - 8) / points.length;
  const bw = stacked ? Math.min(34, band * 0.62) : Math.min(28, (band * 0.7) / series.length);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const step = Math.max(1, Math.ceil(points.length / 9));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - 8} y1={y(f * max)} y2={y(f * max)} stroke="#e8edf4" /><text x={L - 6} y={y(f * max) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{fmt(f * max, unit)}</text></g>)}
        {points.map((p, i) => {
          const cx = L + band * i + band / 2;
          let acc = 0;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.55}>
              {series.map((s, si) => {
                const v = Number(p[s.key]) || 0;
                const col = s.tone ? TONE[s.tone].hex : SERIES_COLORS[si % SERIES_COLORS.length];
                const x0 = stacked ? cx - bw / 2 : cx - (bw * series.length) / 2 + si * bw;
                const yTop = stacked ? y(acc + v) : y(v);
                const h = stacked ? y(acc) - y(acc + v) : H - B - y(v);
                acc += v;
                return <rect key={s.key} x={x0} y={yTop} width={bw - 1} height={Math.max(0, h)} rx="3" fill={col} />;
              })}
              <rect x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent" />
              {(i % step === 0) ? <text x={cx} y={H - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">{String(p.label).slice(-5)}</text> : null}
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <div className="pointer-events-none absolute right-2 top-1 rounded-lg bg-slate-900/90 px-2.5 py-1.5 text-[11px] text-white shadow-lg">
          <p className="font-semibold">{String(points[hover].label)}</p>
          {series.map((s) => <p key={s.key}>{s.label ? `${s.label}: ` : ""}{fmt(Number(points[hover][s.key]) || 0, unit)}</p>)}
        </div>
      ) : null}
      {series.length > 1 ? <Legend items={series.map((k, i) => ({ label: k.label, color: k.tone ? TONE[k.tone].hex : SERIES_COLORS[i % SERIES_COLORS.length] }))} /> : null}
    </div>
  );
}

/** Horizontal ranked bars; each row can deep-link (drill-down by branch/process/etc.). */
export function RankedBars({ points, unit, max, tone = "blue", limit = 10 }: {
  points: Array<InsightPoint & { href?: string }>; unit?: InsightUnit; max?: number; tone?: Tone; limit?: number;
}) {
  const list = points.slice(0, limit);
  if (!list.length) return <ChartEmpty />;
  const top = max ?? Math.max(1, ...list.map((p) => Number(p.value) || 0));
  return (
    <ul className="space-y-2.5">
      {list.map((p, i) => {
        const v = Number(p.value);
        const w = Number.isFinite(v) ? Math.max(2, Math.min(100, (v / top) * 100)) : 0;
        const row = (
          <div className="group">
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="truncate font-medium text-slate-700 group-hover:text-blue-700">{String(p.label)}</span>
              <span className="kit-num shrink-0 font-bold text-slate-900">{fmt(Number.isFinite(v) ? v : null, unit)}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full transition-[width] duration-700", TONE[tone].solid)} style={{ width: `${w}%` }} /></div>
          </div>
        );
        return <li key={`${p.label}-${i}`}>{p.href ? <Link to={p.href} className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}

export function DonutChart({ points, unit, size = 150, centerLabel }: { points: InsightPoint[]; unit?: InsightUnit; size?: number; centerLabel?: string }) {
  const data = points.map((p) => ({ label: String(p.label), v: Number(p.value) || 0 })).filter((d) => d.v > 0);
  const total = data.reduce((s, d) => s + d.v, 0);
  if (!total) return <ChartEmpty />;
  const r = size / 2 - 14, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth="18" />
        {data.map((d, i) => {
          const len = (d.v / total) * c;
          const el = <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth="18" strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
          offset += len;
          return el;
        })}
        <text x="50%" y="48%" textAnchor="middle" className="kit-num fill-slate-900 text-[22px] font-black">{fmt(total, unit)}</text>
        <text x="50%" y="62%" textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold uppercase">{centerLabel ?? "total"}</text>
      </svg>
      <ul className="min-w-[140px] flex-1 space-y-1.5 text-[12px]">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2"><i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} /><span className="truncate text-slate-600">{d.label}</span></span>
            <span className="kit-num font-bold text-slate-900">{fmt(d.v, unit)} <span className="font-medium text-slate-400">({Math.round((d.v / total) * 100)}%)</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stage funnel with step-conversion %, each stage can deep-link. */
export function FunnelChart({ points }: { points: Array<InsightPoint & { href?: string }> }) {
  const list = points.filter((p) => Number.isFinite(Number(p.value)));
  if (!list.length) return <ChartEmpty />;
  const top = Math.max(1, ...list.map((p) => Number(p.value)));
  return (
    <ol className="space-y-1.5">
      {list.map((p, i) => {
        const v = Number(p.value);
        const prev = i ? Number(list[i - 1].value) : null;
        const conv = prev && prev > 0 ? Math.round((v / prev) * 100) : null;
        const row = (
          <div className="flex items-center gap-3">
            <div className="w-24 shrink-0 truncate text-[12px] font-medium text-slate-600 sm:w-32">{String(p.label)}</div>
            <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-slate-100">
              <div className="h-full rounded-lg transition-[width] duration-700" style={{ width: `${Math.max(3, (v / top) * 100)}%`, background: SERIES_COLORS[i % SERIES_COLORS.length], opacity: 0.9 }} />
              <span className="kit-num absolute inset-y-0 left-2 flex items-center text-[12px] font-bold text-white mix-blend-normal drop-shadow">{fmt(v)}</span>
            </div>
            <div className="w-12 shrink-0 text-right text-[11px] font-semibold text-slate-400">{conv === null ? "" : `${conv}%`}</div>
          </div>
        );
        return <li key={`${p.label}-${i}`}>{p.href ? <Link to={p.href} className="block rounded-md hover:bg-slate-50">{row}</Link> : row}</li>;
      })}
    </ol>
  );
}

/** Day-strip heatmap (e.g. attendance % per day) — 1 cell per point, tone by thresholds. */
export function HeatStrip({ points, unit, goodAt = 90, warnAt = 75 }: { points: InsightPoint[]; unit?: InsightUnit; goodAt?: number; warnAt?: number }) {
  if (!points.length) return <ChartEmpty />;
  return (
    <div className="flex flex-wrap gap-1.5">
      {points.map((p, i) => {
        const v = Number(p.value);
        const tone: Tone = !Number.isFinite(v) ? "slate" : v >= goodAt ? "green" : v >= warnAt ? "amber" : "red";
        return <div key={i} title={`${p.label}: ${fmt(Number.isFinite(v) ? v : null, unit)}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-[10px] font-bold ring-1 ring-inset" style={{ background: TONE[tone].hexSoft, color: TONE[tone].hex, boxShadow: `inset 0 0 0 1px ${TONE[tone].hex}22` }}>{String(p.label).slice(-2)}</div>;
      })}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{items.map((i) => <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-slate-500"><i className="h-2 w-2 rounded-full" style={{ background: i.color }} />{i.label}</span>)}</div>;
}

export function ChartEmpty({ text = "No data for this scope yet" }: { text?: string }) {
  return <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-200 text-[12px] text-slate-400">{text}</div>;
}
