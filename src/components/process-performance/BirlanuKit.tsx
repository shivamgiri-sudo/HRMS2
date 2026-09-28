import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ArrowUp, ArrowDown, Eye, X, Building2 } from "lucide-react";

/** Shared look + drill-down drawer for the six Birlanu MIS slides. */

export const NAVY = "#0b2a5b";
export const GOLD = "#e0a800";
export const TOOLTIP_STYLE = { fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0" } as const;
export const PALETTE = ["#1d4ed8", "#f59e0b", "#0ea5e9", "#10b981", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#64748b", "#ec4899", "#84cc16", "#a16207", "#0f766e"];

export const int = (n: number) => Math.round(n).toLocaleString("en-IN");
export const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
export const pct2 = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)}%`;
export const lacs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const crore = (inrValue: number) => `₹${(inrValue / 1e7).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`;
export const dash = (n: number, f: (v: number) => string, show = n > 0) => (show ? f(n) : "—");
export const delta = (cur: number, prev: number | undefined): number | null => (prev && prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
export const ppDelta = (cur: number, prev: number | undefined): number | null => (prev === undefined ? null : Math.round((cur - prev) * 10) / 10);

/* ------------------------------ header + filters ------------------------------ */

export interface FilterDef { key: string; label: string; options: string[]; value: string; onChange: (v: string) => void; allLabel?: string }

export function BirlanuHeader({ title, accent, subtitle, filters, asOf }: {
  title: string; accent: string; subtitle: string; filters: FilterDef[]; asOf: string | null;
}) {
  const asOfText = asOf ? new Date(`${asOf}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-[#0b2a5b] via-[#123a7a] to-[#0b2a5b] px-4 py-3 text-white shadow-md">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-amber-300"><Building2 className="h-5 w-5" /></span>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-300">Birla Nuvo · Building a better tomorrow</p>
          <h2 className="text-lg font-extrabold leading-tight sm:text-xl">
            BIRLANU – <span className="text-amber-300">{accent}</span> {title}
          </h2>
          <p className="text-[11px] font-medium text-white/75">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {filters.map((f) => (
          <label key={f.key} className="flex flex-col text-[9px] font-semibold uppercase tracking-wide text-white/70">
            {f.label}
            <select
              value={f.value} onChange={(e) => f.onChange(e.target.value)} aria-label={f.label}
              className="mt-0.5 h-7 min-w-[92px] rounded-md border border-white/20 bg-white px-2 text-[11px] font-medium normal-case tracking-normal text-slate-800"
            >
              <option value="">{f.allLabel ?? "All"}</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        ))}
        <div className="rounded-md bg-white/10 px-2.5 py-1 text-right text-[10px] leading-tight text-white/80">
          As of<br /><span className="text-xs font-bold text-white">{asOfText}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- tiles ---------------------------------- */

export function DeltaBadge({ value, unit = "%", invert }: { value: number | null; unit?: "%" | "pp"; invert?: boolean }) {
  if (value === null) return null;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${good ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}{Math.abs(value)}{unit}
    </span>
  );
}

export function Kpi({ icon: Icon, label, value, sub, delta: d, unit, tone = "#1d4ed8", onClick, invert }: {
  icon: ComponentType<{ className?: string }>; label: string; value: string; sub?: string; delta?: number | null; unit?: "%" | "pp"; tone?: string; onClick?: () => void; invert?: boolean;
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={!onClick} title={onClick ? "Click for month-wise details" : undefined}
      className={`flex items-center gap-2 rounded-xl border border-slate-100 bg-white p-2 text-left shadow-sm transition-shadow ${onClick ? "hover:shadow-md" : "cursor-default"}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: tone }}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block truncate text-[10px] font-semibold text-slate-500">{label}</span>
        <span className="block text-base font-extrabold leading-tight text-slate-900">{value}</span>
        <span className="flex items-center gap-1">
          <DeltaBadge value={d ?? null} unit={unit} invert={invert} />
          {sub && <span className="truncate text-[9px] leading-tight text-slate-400" title={sub}>{sub}</span>}
        </span>
      </span>
    </button>
  );
}

export function BCard({ title, icon: Icon, action, children, footnote, className = "" }: {
  title: string; icon?: ComponentType<{ className?: string }>; action?: ReactNode; children: ReactNode; footnote?: string; className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-slate-100 bg-white p-3 shadow-sm ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0b2a5b] text-white"><Icon className="h-3.5 w-3.5" /></span>}
          <p className="text-[13px] font-extrabold text-[#0b2a5b]">{title}</p>
        </div>
        {action}
      </div>
      {children}
      {footnote && <p className="mt-2 border-t border-slate-100 pt-1.5 text-[10px] leading-relaxed text-slate-400">{footnote}</p>}
    </div>
  );
}

export function DetailsBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700">
      <Eye className="h-3 w-3" /> View details
    </button>
  );
}

/** Navy-header table shell: every `th` is explicitly white so it never renders faint. */
export function Th({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <th onClick={onClick} className={`whitespace-nowrap bg-[#0b2a5b] px-2 py-1.5 text-center text-[10px] font-bold text-white ${className}`}>{children}</th>;
}

export function Empty({ text = "No data for the current selection." }: { text?: string }) {
  return <p className="py-10 text-center text-xs text-slate-400">{text}</p>;
}

/* ------------------------------- drill-down drawer ------------------------------- */

export type CellFmt = "int" | "pct1" | "pct2" | "lacs" | "inr" | "hrs" | "text";
export interface DrawerCol { key: string; label: string; fmt?: CellFmt }
export interface DrawerSeries { key: string; label: string; color: string; type: "bar" | "line"; axis?: "left" | "right" }
export interface DrawerSpec {
  title: string; subtitle?: string; rows: Array<Record<string, string | number | null>>; columns: DrawerCol[]; chart?: DrawerSeries[]; xKey?: string; note?: string;
}

const FMT: Record<CellFmt, (v: number) => string> = {
  int: int, pct1, pct2, lacs, inr, hrs: (v) => `${(Math.round(v * 10) / 10).toFixed(1)} h`, text: (v) => String(v),
};
export const fmtCell = (v: string | number | null | undefined, fmt: CellFmt = "int") =>
  v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? FMT[fmt](v) : String(v);

/** Right-side slide-over drawer (per this app's drill-down rule): month-wise chart + full table for whatever was clicked. */
export function BirlanuDrawer({ spec, onClose }: { spec: DrawerSpec; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const xKey = spec.xKey ?? "month";
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={spec.title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <div className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-200 ${shown ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-start justify-between bg-gradient-to-r from-[#0b2a5b] to-[#123a7a] px-5 py-4 text-white">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Birlanu · Month-wise detail</p>
            <h3 className="text-base font-extrabold">{spec.title}</h3>
            {spec.subtitle && <p className="text-xs text-white/70">{spec.subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-white/80 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {spec.chart && spec.rows.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Trend</p>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={spec.rows} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey={xKey} tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 9 }} />
                  {spec.chart.some((s) => s.axis === "right") && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} />}
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {spec.chart.map((s) => s.type === "bar"
                    ? <Bar key={s.key} yAxisId={s.axis ?? "left"} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={26} />
                    : <Line key={s.key} yAxisId={s.axis ?? "left"} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} />)}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Table</p>
            {spec.rows.length === 0 ? <p className="rounded-lg bg-slate-50 py-6 text-center text-xs text-slate-400">None</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-center text-xs">
                  <thead>
                    <tr>{spec.columns.map((c, i) => <Th key={c.key} className={i === 0 ? "rounded-l-md text-left" : i === spec.columns.length - 1 ? "rounded-r-md" : ""}>{c.label}</Th>)}</tr>
                  </thead>
                  <tbody>
                    {spec.rows.map((r, ri) => (
                      <tr key={ri} className={ri % 2 ? "bg-slate-50" : "bg-white"}>
                        {spec.columns.map((c, i) => <td key={c.key} className={`px-2 py-1.5 ${i === 0 ? "text-left font-semibold text-slate-700" : "text-slate-600"}`}>{fmtCell(r[c.key], c.fmt)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {spec.note && <p className="text-[11px] leading-relaxed text-slate-400">{spec.note}</p>}
        </div>
      </div>
    </div>
  );
}

/** Custom div funnel (recharts' Funnel clips small stages): equal-height rows, width proportional to the value. */
export function Funnel({ stages }: { stages: Array<{ label: string; value: number; sub?: string; color: string }> }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="space-y-1.5">
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-2">
          <div className="flex-1">
            <div
              className="mx-auto flex h-11 flex-col items-center justify-center rounded-md text-white shadow-sm"
              style={{ width: `${Math.max(34, (s.value / max) * 100)}%`, backgroundColor: s.color }}
            >
              <span className="text-sm font-extrabold leading-tight">{int(s.value)}</span>
              <span className="text-[9px] font-medium leading-tight opacity-90">{s.label}</span>
            </div>
          </div>
          {s.sub && <span className="w-14 shrink-0 text-right text-[11px] font-bold text-slate-600">{s.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Donut legend list with counts and % -- avoids recharts outside labels that clip. */
export function LegendList({ items }: { items: Array<{ label: string; value: number; color: string; pct: number }> }) {
  return (
    <ul className="space-y-1">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-[11px]">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: i.color }} />
          <span className="flex-1 truncate text-slate-600" title={i.label}>{i.label}</span>
          <span className="font-bold text-slate-800">{int(i.value)}</span>
          <span className="w-12 text-right text-slate-400">({pct1(i.pct)})</span>
        </li>
      ))}
    </ul>
  );
}

export function Insights({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5">
      {items.length === 0 && <li className="text-xs text-slate-400">Not enough data in this selection.</li>}
      {items.map((t, i) => (
        <li key={t} className="flex items-start gap-2 text-[11px] leading-snug text-slate-600">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[9px] font-bold text-sky-700">{i + 1}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}
