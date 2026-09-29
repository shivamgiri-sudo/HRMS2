import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Area, AreaChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/**
 * Chart tokens. Categorical slots come from the validated default palette
 * (blue / aqua / orange, all-pairs CVD-safe in light and dark); dark values are the stepped-for-dark set.
 */
export const VIZ_CSS = `
.ats-viz{--v-blue:#2a78d6;--v-aqua:#1baf7a;--v-orange:#eb6834;--v-yellow:#eda100;--v-violet:#4a3aa7;--v-red:#e34948;--v-track:rgba(100,116,139,.16);--v-grid:rgba(100,116,139,.22);--v-glass:rgba(255,255,255,.72)}
.dark .ats-viz{--v-blue:#3987e5;--v-aqua:#199e70;--v-orange:#d95926;--v-yellow:#c98500;--v-violet:#9085e9;--v-red:#e66767;--v-track:rgba(148,163,184,.18);--v-grid:rgba(148,163,184,.22);--v-glass:rgba(15,23,42,.55)}
.ats-viz .v-rise{animation:v-rise .5s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i,0)*60ms)}
.ats-viz .v-pulse{animation:v-pulse 1.8s ease-out infinite}
.ats-viz .v-card{transition:box-shadow .2s,border-color .2s}
.ats-viz .v-card:hover{box-shadow:0 8px 28px -12px rgba(30,64,175,.35);border-color:var(--v-blue)}
@keyframes v-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes v-pulse{0%{box-shadow:0 0 0 0 rgba(27,175,122,.55)}100%{box-shadow:0 0 0 10px rgba(27,175,122,0)}}
@media (prefers-reduced-motion:reduce){.ats-viz .v-rise,.ats-viz .v-pulse{animation:none}.ats-viz .v-card{transition:none}}
`;

export const V = {
  blue: "var(--v-blue)", aqua: "var(--v-aqua)", orange: "var(--v-orange)", yellow: "var(--v-yellow)",
  violet: "var(--v-violet)", red: "var(--v-red)", track: "var(--v-track)", grid: "var(--v-grid)",
};
export const fmt = (n: number) => Number(n || 0).toLocaleString("en-IN");
export const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", color: "hsl(var(--card-foreground))", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.12)" },
  itemStyle: { color: "hsl(var(--card-foreground))" },
};

export const rise = (i: number) => ({ "--i": i }) as CSSProperties;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Eases a number from its previous value to the new one. Snaps instantly under reduced motion. */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion()) { setShown(value); from.current = value; return; }
    const start = performance.now(), a = from.current, dur = 700;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - p, 3);
      setShown(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="tabular-nums">{decimals ? shown.toFixed(decimals) : fmt(Math.round(shown))}{suffix}</span>;
}

export function Delta({ v }: { v?: number | null }) {
  if (v == null) return null;
  const up = v >= 0, Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${up ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-red-500/15 text-red-700 dark:text-red-300"}`}>
      <Icon className="h-3 w-3" aria-hidden />{Math.abs(v)}%<span className="sr-only"> vs previous period</span>
    </span>
  );
}

export function Sparkline({ data, dataKey, color }: { data: Record<string, unknown>[]; dataKey: string; color: string }) {
  const id = useId().replace(/:/g, "");
  if (data.length < 2) return <div className="h-10" />;
  return (
    <div className="h-10 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.45} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={!reducedMotion()} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Radial gauge, 0–100. Numeric value always printed in the centre (no colour-only reading). */
export function Gauge({ value, color, label, sub }: { value: number; color: string; label: string; sub?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col items-center" role="img" aria-label={`${label}: ${v}%`}>
      <div className="relative h-28 w-28">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={[{ v }]} innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270} barSize={11}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="v" cornerRadius={8} fill={color} background={{ fill: "var(--v-track)" }} isAnimationActive={!reducedMotion()} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center text-xl font-semibold"><CountUp value={v} decimals={v % 1 ? 1 : 0} suffix="%" /></div>
      </div>
      <div className="mt-1 text-center text-xs font-medium">{label}</div>
      {sub && <div className="text-center text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Panel({ title, hint, icon, right, children, className = "", i = 0 }: { title: string; hint?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; i?: number }) {
  return (
    <section className={`v-card v-rise min-w-0 rounded-2xl border bg-card p-4 text-card-foreground ${className}`} style={rise(i)}>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          {icon && <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>{icon}</span>}
          <div><h2 className="text-sm font-semibold leading-tight">{title}</h2>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export const Empty = ({ text = "No data for this period" }: { text?: string }) => (
  <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">{text}</div>
);

export function RateBar({ value, color = V.blue }: { value: number; color?: string }) {
  return <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--v-track)" }} role="presentation"><div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, value)}%`, background: color }} /></div>;
}

/** Horizontal bar list: label, proportional bar, value. Accessible (text carries every number) and dependency-free. */
export function BarRows({ rows, max, color = V.blue, format = fmt, onSelect }: {
  rows: { label: string; value: number; sub?: string; color?: string }[]; max?: number; color?: string; format?: (n: number) => string; onSelect?: (label: string) => void;
}) {
  if (!rows.length) return <Empty />;
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const body = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{format(r.value)}{r.sub && <span className="ml-1.5 text-[11px]">{r.sub}</span>}</span>
            </div>
            <RateBar value={(r.value / top) * 100} color={r.color ?? color} />
          </>
        );
        return (
          <li key={r.label}>
            {onSelect
              ? <button onClick={() => onSelect(r.label)} aria-label={`Drill into ${r.label}`} className="-mx-1.5 block w-[calc(100%+0.75rem)] cursor-pointer rounded-lg px-1.5 py-1 text-left transition-colors duration-200 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{body}</button>
              : body}
          </li>
        );
      })}
    </ul>
  );
}

/** Compact stat tile used on the secondary dashboards. */
export function MiniStat({ label, value, sub, icon, color = V.blue, i = 0, onClick }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; color?: string; i?: number; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} aria-label={onClick ? `${label}: drill down` : undefined} className={`v-card v-rise min-w-0 rounded-2xl border bg-card p-4 text-left text-card-foreground shadow-sm ${onClick ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" : ""}`} style={rise(i)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }} aria-hidden>{icon}</span>
      </div>
      <div className="mt-2 truncate text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
    </Tag>
  );
}
