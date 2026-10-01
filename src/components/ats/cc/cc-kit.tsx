import { useId, type CSSProperties, type ReactNode } from "react";
import { Area, AreaChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CountUp, Empty, V, VIZ_CSS, fmt, rise, tooltipStyle } from "@/components/ats/overview/viz";
import { DrillProvider } from "@/components/ats/overview/drill";
import { PERIODS } from "@/components/ats/overview/shell";
import type { OverviewPeriod } from "@/hooks/useAtsOverview";
import { useCC } from "./cc-context";
export * from "./cc-viz";

/**
 * "Signal" look for the ATS Command Center: an ink hero with aurora glow, glass cards on a tinted canvas, a sliding tab
 * pill, tabular mono-ish numerals and a live pulse. Chart colours stay on the validated --v-* palette from overview/viz,
 * so everything works in light and dark. Motion is decorative and switches off under prefers-reduced-motion.
 */
export const CC_CSS = `
${VIZ_CSS}
.cc{--cc-ink:#0a1226;--cc-ink2:#10204a;--cc-glow1:#38bdf8;--cc-glow2:#8b5cf6;--cc-glow3:#34d399;--cc-card:hsl(var(--card));--cc-line:hsl(var(--border))}
.cc{color:hsl(var(--foreground))}
.cc .cc-card{color:hsl(var(--card-foreground))}
.cc .cc-hero{background:radial-gradient(120% 140% at 0% 0%,#16327a 0%,transparent 55%),radial-gradient(90% 120% at 100% 0%,#5b34c9 0%,transparent 50%),radial-gradient(80% 100% at 60% 120%,#0f766e 0%,transparent 55%),linear-gradient(135deg,var(--cc-ink),var(--cc-ink2))}
.cc .cc-grain{background-image:radial-gradient(rgba(255,255,255,.08) 1px,transparent 1px);background-size:22px 22px;mask-image:linear-gradient(180deg,#000,transparent 80%)}
.cc .cc-glass{background:var(--v-glass);backdrop-filter:blur(14px);border:1px solid var(--cc-line)}
.cc .cc-card{position:relative;background:var(--cc-card);border:1px solid var(--cc-line);border-radius:1.1rem;transition:box-shadow .25s,transform .25s,border-color .25s}
.cc .cc-card::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:linear-gradient(135deg,var(--cc-glow1),var(--cc-glow2),var(--cc-glow3));opacity:0;transition:opacity .25s;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.cc .cc-card.cc-hot:hover{transform:translateY(-2px);box-shadow:0 14px 40px -18px rgba(76,92,230,.55)}
.cc .cc-card.cc-hot:hover::before{opacity:.9}
.cc .cc-num{font-variant-numeric:tabular-nums;letter-spacing:-.02em;font-feature-settings:"tnum"}
.cc .cc-live{position:relative}
.cc .cc-live::after{content:"";position:absolute;inset:0;border-radius:99px;background:currentColor;opacity:.4;animation:cc-ping 1.8s ease-out infinite}
.cc .cc-pill{transition:transform .35s cubic-bezier(.3,.9,.3,1),width .35s cubic-bezier(.3,.9,.3,1)}
.cc .cc-sheen{background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.18) 50%,transparent 70%);background-size:200% 100%;animation:cc-sheen 3.2s linear infinite}
@keyframes cc-ping{0%{transform:scale(1);opacity:.45}80%,100%{transform:scale(2.6);opacity:0}}
@keyframes cc-sheen{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.cc .cc-live::after,.cc .cc-sheen{animation:none}.cc .cc-card,.cc .cc-pill{transition:none}}
`;

/** Wraps a Command Center page: scoped tokens, the drill engine and the page canvas. */
export function CCFrame({ children }: { children: ReactNode }) {
  return (
    <DrillProvider>
      <div className="ats-viz cc mx-auto max-w-[1680px] space-y-4 p-3 text-foreground md:p-6">
        <style>{CC_CSS}</style>
        {children}
      </div>
    </DrillProvider>
  );
}

export function CCHero({ eyebrow, title, subtitle, live, right, children }: { eyebrow: string; title: string; subtitle?: ReactNode; live?: boolean; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="cc-hero relative overflow-hidden rounded-[1.6rem] p-5 text-white shadow-xl md:p-7">
      <div className="cc-grain pointer-events-none absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-fuchsia-400/20 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-cyan-300/15 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-sky-100 backdrop-blur">
            {live && <span className="cc-live inline-block h-1.5 w-1.5 rounded-full bg-emerald-300 text-emerald-300" aria-hidden />}
            {eyebrow}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-sky-100/80">{subtitle}</p>}
        </div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {children}
    </div>
  );
}

/** Sliding-pill tab bar. Scrolls horizontally on narrow screens. */
export function CCTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: ReactNode; badge?: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  const idx = Math.max(0, tabs.findIndex((t) => t.id === value));
  return (
    <div className="cc-glass sticky top-2 z-30 overflow-x-auto rounded-2xl p-1.5 shadow-lg" role="tablist" aria-label="Command Center sections">
      <div className="relative grid min-w-max" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(9.5rem, 1fr))` }}>
        <span aria-hidden className="cc-pill absolute inset-y-0 left-0 rounded-xl bg-gradient-to-r from-[#1d4ed8] via-[#4f46e5] to-[#7c3aed] shadow-md"
          style={{ width: `${100 / tabs.length}%`, transform: `translateX(${idx * 100}%)` } as CSSProperties} />
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}
            className={`relative z-10 flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${t.id === value ? "text-white" : "text-muted-foreground hover:text-foreground"}`}>
            {t.icon}{t.label}{t.badge}
          </button>
        ))}
      </div>
    </div>
  );
}

type FilterKey = "period" | "branch" | "process" | "recruiter";
const selCls = "h-10 w-full rounded-xl border-border bg-card text-sm sm:w-56";

/** Shared filter bar. `show` lists only the filters the active tab's data can honour. */
export function FilterBar({ show, branches = [], processes = [], recruiters = [], periods = PERIODS, right }: {
  show: FilterKey[]; branches?: string[]; processes?: string[]; recruiters?: string[]; periods?: typeof PERIODS; right?: ReactNode;
}) {
  const cc = useCC();
  const pick = (v: string) => (v === "all" ? "" : v);
  const dropdown = (key: "branch" | "process" | "recruiter", label: string, opts: string[]) => (
    <Select value={cc[key] || "all"} onValueChange={(v) => cc.set({ [key]: pick(v) })}>
      <SelectTrigger className={selCls} aria-label={label}><SelectValue placeholder={`All ${label.toLowerCase()}`} /></SelectTrigger>
      <SelectContent><SelectItem value="all">All {label.toLowerCase()}</SelectItem>{opts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
    </Select>
  );
  return (
    <div className="cc-card flex flex-wrap items-center gap-2 p-2.5">
      {show.includes("period") && (
        <div className="inline-flex rounded-xl bg-muted p-1" role="group" aria-label="Period">
          {periods.map((p) => (
            <button key={p.key} onClick={() => cc.set({ period: p.key as OverviewPeriod })} aria-pressed={cc.period === p.key}
              className={`min-h-[34px] min-w-[44px] cursor-pointer rounded-lg px-3 text-xs font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${cc.period === p.key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{p.label}</button>
          ))}
        </div>
      )}
      {show.includes("branch") && dropdown("branch", "Branches", branches)}
      {show.includes("process") && dropdown("process", "Processes", processes)}
      {show.includes("recruiter") && dropdown("recruiter", "Recruiters", recruiters)}
      {(cc.branch || cc.process || cc.recruiter) && (
        <button onClick={() => cc.set({ branch: "", process: "", recruiter: "" })} className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10">Clear filters</button>
      )}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** Card with a header; `hot` lifts and glows on hover (use for cards that drill). */
export function Card({ title, hint, icon, right, children, className = "", i = 0, hot }: { title?: string; hint?: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; i?: number; hot?: boolean }) {
  return (
    <section className={`cc-card v-rise min-w-0 p-4 ${hot ? "cc-hot" : ""} ${className}`} style={rise(i)}>
      {(title || right) && (
        <header className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            {icon && <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-violet-500/15 text-primary" aria-hidden>{icon}</span>}
            <div><h2 className="text-sm font-semibold leading-tight">{title}</h2>{hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}</div>
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Delta({ v, invert, suffix = "%" }: { v?: number | null; invert?: boolean; suffix?: string }) {
  if (v == null) return null;
  const good = invert ? v <= 0 : v >= 0, Icon = v >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${good ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-red-500/15 text-red-700 dark:text-red-300"}`}>
      <Icon className="h-3 w-3" aria-hidden />{Math.abs(v)}{suffix}<span className="sr-only"> vs previous period</span>
    </span>
  );
}

/** Headline number with delta, sparkline and click-to-drill. */
export function KpiCard({ label, value, decimals = 0, suffix = "", delta, deltaInvert, sub, icon, color = V.blue, spark, sparkKey = "v", onClick, i = 0 }: {
  label: string; value: number; decimals?: number; suffix?: string; delta?: number | null; deltaInvert?: boolean; sub?: ReactNode; icon: ReactNode; color?: string;
  spark?: Record<string, unknown>[]; sparkKey?: string; onClick?: () => void; i?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} aria-label={onClick ? `${label}: drill down` : undefined}
      className={`cc-card cc-hot v-rise flex min-w-0 flex-col overflow-hidden p-4 text-left ${onClick ? "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" : ""}`} style={rise(i)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }} aria-hidden>{icon}</span>
      </div>
      <div className="cc-num mt-2 flex items-end gap-2 text-3xl font-semibold"><CountUp value={value} decimals={decimals} suffix={suffix} /><Delta v={delta} invert={deltaInvert} /></div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
      {spark && spark.length > 1 && (
        <div className="-mx-4 -mb-4 mt-auto h-12 pt-2" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.4} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
              <Area type="monotone" dataKey={sparkKey} stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tag>
  );
}

/** Radar for comparing one entity to a baseline on 0..100 axes. */
export function RadarCompare({ axes, a, b, aLabel, bLabel }: { axes: string[]; a: number[]; b?: number[]; aLabel: string; bLabel?: string }) {
  const data = axes.map((axis, i) => ({ axis, a: a[i] ?? 0, b: b?.[i] ?? 0 }));
  return (
    <div className="h-64 w-full" role="img" aria-label={`${aLabel}${bLabel ? ` compared with ${bLabel}` : ""} on ${axes.join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={V.grid} /><PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} /><PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
          {b && <Radar name={bLabel} dataKey="b" stroke={V.violet} fill={V.violet} fillOpacity={0.12} strokeDasharray="4 3" />}
          <Radar name={aLabel} dataKey="a" stroke={V.blue} fill={V.blue} fillOpacity={0.28} strokeWidth={2} />
          <Tooltip {...tooltipStyle} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Step bars with the loss between each step, for funnels where the drop matters more than the level. */
export function Waterfall({ steps, onStep }: { steps: { key: string; label: string; n: number }[]; onStep?: (key: string) => void }) {
  if (!steps.length) return <Empty />;
  const top = Math.max(1, steps[0].n);
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].n : s.n, lost = Math.max(0, prev - s.n), keep = prev ? Math.round((s.n / prev) * 100) : null;
        const row = (
          <div className="w-full text-left">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{s.label}</span><span className="cc-num text-muted-foreground">{fmt(s.n)}{i > 0 && keep != null && <span className="ml-2 text-[11px]">{keep}% kept{lost > 0 && <span className="text-red-600 dark:text-red-300"> · −{fmt(lost)}</span>}</span>}</span></div>
            <div className="relative h-3 overflow-hidden rounded-full" style={{ background: "var(--v-track)" }}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(prev / top) * 100}%`, background: "color-mix(in srgb, var(--v-orange) 28%, transparent)" }} />
              <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${(s.n / top) * 100}%`, background: "linear-gradient(90deg,var(--v-blue),var(--v-violet))" }} />
            </div>
          </div>
        );
        return <li key={s.key}>{onStep ? <button onClick={() => onStep(s.key)} aria-label={`Drill into ${s.label}`} className="block w-full cursor-pointer rounded-lg p-1 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{row}</button> : row}</li>;
      })}
    </ol>
  );
}

/** Small live indicator for auto-refreshing data. */
export function LiveBadge({ at, onDark }: { at?: string | number | Date | null; onDark?: boolean }) {
  const t = at ? new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${onDark ? "border border-emerald-300/40 bg-emerald-400/20 text-emerald-100" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}>
      <span className="cc-live inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 text-emerald-500" aria-hidden />Live{t && <span className="font-normal opacity-80"> · {t}</span>}
    </span>
  );
}

/** Section divider with a spark icon, for grouping cards inside a tab. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-500" aria-hidden /><h2 className="text-base font-semibold tracking-tight">{title}</h2>{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</div>
      {children}
    </section>
  );
}

/** Glass chip for the hero: a live number with a caption. */
export function HeroStat({ label, value, tone = "default", sub }: { label: string; value: ReactNode; tone?: "default" | "bad" | "good"; sub?: string }) {
  const ring = tone === "bad" ? "border-red-300/40 bg-red-400/15" : tone === "good" ? "border-emerald-300/40 bg-emerald-400/15" : "border-white/15 bg-white/10";
  return (
    <div className={`min-w-[8.5rem] flex-1 rounded-2xl border px-4 py-3 backdrop-blur ${ring}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-sky-100/80">{label}</div>
      <div className="cc-num mt-0.5 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="text-[11px] text-sky-100/70">{sub}</div>}
    </div>
  );
}
