/**
 * Frame shared by every Summary chart: title, subtitle, controls, notes, a reserved-height body (no layout jump), the empty state
 * and skeleton, and the "Show table" disclosure holding the text alternative as a real <table> with a <caption>. The table is always
 * in the markup (hidden while closed) so aria-controls points at a real element. Also the chart chrome helpers (ticks, grid, tooltip).
 */
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Inbox, Info } from "lucide-react";
import { AXIS_TICK, GRID_PROPS } from "@/components/analytics/analytics-kit";
import type { TextTable } from "../driveChartModel";
import { EMPTY_TEXT } from "./summaryView";

export const BTN = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 sm:min-h-8";
const BTN_ON = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-blue-700 bg-blue-700 px-3 text-xs font-semibold text-white transition-colors duration-150 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950 sm:min-h-8";
const HEIGHT = { standard: "h-[220px] sm:h-[280px]", tall: "h-[300px] sm:h-[360px]" } as const;

export function axisTick(dark: boolean) { return dark ? { ...AXIS_TICK, fill: "#94a3b8" } : AXIS_TICK; }
export function gridProps(dark: boolean) { return dark ? { ...GRID_PROPS, stroke: "#334155" } : GRID_PROPS; }
export const TOOLTIP_CURSOR = { fill: "rgba(100, 116, 139, 0.12)" };

/** Tooltip body listing exact values (recharts content renderer). */
export function TooltipCard({ title, lines }: { title: string; lines: Array<{ label: string; value: string }> }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
      <p className="mb-1 font-semibold">{title}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {lines.map((l) => (
          <div key={l.label} className="contents"><dt className="text-slate-600 dark:text-slate-300">{l.label}</dt><dd className="text-right font-semibold tabular-nums">{l.value}</dd></div>
        ))}
      </dl>
    </div>
  );
}

/** Segmented selector (type / kind): native buttons with aria-pressed. */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: ReadonlyArray<{ id: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)} className={o.id === value ? BTN_ON : BTN}>{o.label}</button>
      ))}
    </div>
  );
}

export function TextTableView({ table, id }: { table: TextTable; id?: string }) {
  return (
    <div id={id} className="relative overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-xs text-slate-800 dark:text-slate-100">
        <caption className="mb-1 text-left text-xs text-slate-600 dark:text-slate-300">{table.caption}</caption>
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            {table.columns.map((c) => <th key={c} scope="col" className="px-2 py-1 font-semibold">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              {r.map((cell, k) => (k === 0
                ? <th key={k} scope="row" className="max-w-xs break-words px-2 py-1 font-medium">{cell}</th>
                : <td key={k} className="max-w-xs break-words px-2 py-1 tabular-nums">{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One-line visible note with an icon (untracked stages, peak hour, missing times). */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-slate-700 dark:text-slate-200">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function EmptyBlock({ size = "standard", text = EMPTY_TEXT }: { size?: keyof typeof HEIGHT; text?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-center dark:border-slate-600 ${HEIGHT[size]}`}>
      <Inbox className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden />
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{text}</p>
    </div>
  );
}

export interface ChartFrameProps {
  title: string;
  subtitle?: string;
  table: TextTable;
  empty: boolean;
  /** Replaces the default empty-state wording. */
  emptyText?: string;
  /** Summary read out for the role="img" chart body. */
  aria: string;
  defaultTableOpen?: boolean;
  controls?: ReactNode;
  /** Notes under the title (untracked note, peak call-out); always visible text. */
  note?: ReactNode;
  /** "image": recharts body in a reserved-height role="img" box; "grid": an HTML table grid that is its own text alternative. */
  kind?: "image" | "grid";
  size?: keyof typeof HEIGHT;
  loading?: boolean;
  className?: string;
  children: ReactNode;
}

export default function ChartFrame({ title, subtitle, table, empty, emptyText, aria, defaultTableOpen = false, controls, note, kind = "image", size = "standard", loading = false, className, children }: ChartFrameProps) {
  const [open, setOpen] = useState(defaultTableOpen);
  const uid = useId().replaceAll(":", "");
  const titleId = `chart-title-${uid}`;
  const tableId = `chart-table-${uid}`;
  let body: ReactNode;
  if (loading) body = <div aria-busy="true" className={`animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800 ${HEIGHT[size]}`} />;
  else if (empty) body = <EmptyBlock size={size} text={emptyText} />;
  else if (kind === "grid") body = children;
  else body = <div role="img" aria-label={aria} className={`w-full min-w-0 ${HEIGHT[size]}`}>{children}</div>;
  return (
    <section aria-labelledby={titleId} className={`min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 ${className ?? ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs text-slate-600 dark:text-slate-300">{subtitle}</p>}
        </div>
        {controls}
      </div>
      {note}
      {body}
      <div className="space-y-2">
        <button type="button" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen((v) => !v)} className={BTN}>
          {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
          {open ? "Hide table" : "Show table"}
        </button>
        <div id={tableId} hidden={!open}><TextTableView table={table} /></div>
      </div>
    </section>
  );
}
