import type { CSSProperties, ReactNode } from "react";
import { CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";

/**
 * Shared types, Indian-format helpers and chart/table pieces for the 23-Sep-26 Overview,
 * Analyst Performance and Utilization formats. Types mirror the backend's
 * onfido-overview-report / onfido-analyst-report / onfido-utilization services.
 */

export type Granularity = "daily" | "weekly" | "monthly";
export interface DateRange { from: string; to: string }

export const GRANULARITY_OPTIONS: { key: Granularity; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

// ── Backend shapes ───────────────────────────────────────────────────────────

export interface Section<T> { data: T | null; error: string | null }
export interface MatrixRow { label: string; values: (number | null)[] }
export interface Matrix { buckets: string[]; rows: MatrixRow[] }

export interface ManpowerFigures {
  approvedHc: number | null; requiredHc: number | null; activeHc: number | null;
  bufferPct: number | null; shortfall: number | null;
}
export interface QueueRow extends ManpowerFigures {
  queue: "EXTRACTION" | "POA" | "ENCORD"; label: string;
  activeSource: "analysts_with_tasks" | "manual_entry" | null;
}
export interface ManpowerSection extends ManpowerFigures {
  asOf: string | null; planEffectiveFrom: string | null; approvedMissingFor: string[]; queues: QueueRow[];
}
export interface AonRow { label: string; activeHc: number; contributionPct: number | null }
export interface AonSection { asOf: string | null; rows: AonRow[]; unclassifiedHc: number; totalHc: number }

export interface OverviewReport {
  granularity: Granularity; from: string; to: string;
  manpower: Section<ManpowerSection>;
  aon: Section<AonSection>;
  bufferTrend: Section<Matrix>;
  attritionTrend: Section<Matrix>;
  shrinkageTrend: Section<Matrix>;
  docProcessingTrend: Section<Matrix>;
  taskVolumeContribution: Section<Matrix>;
  taskAht: Section<Matrix>;
  internalQuality: Section<Matrix>;
  externalQuality: Section<Matrix>;
  poaVolumeTime: Section<Matrix>;
  poaQuality: Section<Matrix>;
  etmTrend: Section<Matrix>;
  taskSkipTrend: Section<Matrix>;
  gdMcnTrend: Section<Matrix>;
  utilizationTrend: Section<Matrix>;
  creCrqTrend: Section<Matrix>;
}

// ── Indian formats ───────────────────────────────────────────────────────────

export const DASH = "-";

export function fmtInt(v: number | null | undefined): string {
  return v === null || v === undefined ? DASH : Math.round(v).toLocaleString("en-IN");
}

/** Headcount: whole numbers as-is, a fractional Required HC (Approved x 120%) to one decimal. */
export function fmtHc(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  return Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined
    ? DASH
    : v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? DASH : `${fmtNum(v, digits)}%`;
}

/** A 0.9-style ratio shown as a percentage. */
export function fmtRatioPct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? DASH : fmtPct(v * 100, digits);
}

/** 2026-07-31 -> 31/07/2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return DASH;
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** "2026-07 16:05:00" style timestamps -> DD/MM/YYYY HH:mm */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  return `${fmtDate(value)} ${value.slice(11, 16)}`.trim();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Axis label for a backend bucket: "Jul-26" (monthly), "WC 13/07" (weekly), "13/07" (daily). */
export function bucketAxisLabel(bucket: string, granularity: Granularity): string {
  if (granularity === "monthly") return `${MONTHS[Number(bucket.slice(5, 7)) - 1] ?? ""}-${bucket.slice(2, 4)}`;
  const short = `${bucket.slice(8, 10)}/${bucket.slice(5, 7)}`;
  return granularity === "weekly" ? `WC ${short}` : short;
}

/** The date `days` before/after an ISO day (negative = before). */
export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First/last day of a month or week, used to turn the Daily/Weekly/Monthly presets into a range. */
export function presetRange(till: string, granularity: Granularity): DateRange {
  const end = new Date(`${till}T00:00:00Z`);
  const start = new Date(end);
  if (granularity === "weekly") start.setUTCDate(end.getUTCDate() - 6);
  else if (granularity === "monthly") start.setUTCDate(1);
  return { from: start.toISOString().slice(0, 10), to: till };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

/** Chart x-axis label that says WHICH week/day a bucket is (a bare ISO date does not). */
export function formatBucketTick(bucket: string, granularity: Granularity): string {
  if (granularity === "monthly" || !/^\d{4}-\d{2}-\d{2}$/.test(bucket)) return bucket;
  if (granularity === "weekly") return `WC ${shortDate(bucket)}`;
  return `${shortDate(bucket)} (${WEEKDAYS[new Date(`${bucket}T00:00:00Z`).getUTCDay()]})`;
}

/** Human label for the period a from/to range covers, shown above range-based tables. */
export function describePeriod(range: DateRange, granularity: Granularity): string {
  if (!range.from || !range.to) return "";
  const year = range.to.slice(0, 4);
  if (range.from === range.to) return `Day: ${shortDate(range.from)} ${year} (${WEEKDAYS[new Date(`${range.from}T00:00:00Z`).getUTCDay()]})`;
  const span = `${shortDate(range.from)} ${range.from.slice(0, 4)} to ${shortDate(range.to)} ${year}`;
  if (granularity === "weekly") return `Week commencing ${shortDate(range.from)} ${range.from.slice(0, 4)} (${span})`;
  if (granularity === "monthly") return `${MONTHS[new Date(`${range.to}T00:00:00Z`).getUTCMonth()]} ${year} (${span})`;
  return span;
}

// ── UI pieces ────────────────────────────────────────────────────────────────

export function GranularityPills({ value, onChange }: { value: Granularity; onChange: (g: Granularity) => void }) {
  return (
    <div className="oc-pillbar" role="group" aria-label="Range">
      {GRANULARITY_OPTIONS.map((o) => (
        <button
          key={o.key} type="button" className={o.key === value ? "oc-pill-btn active" : "oc-pill-btn"}
          onClick={() => onChange(o.key)} aria-pressed={o.key === value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionCard({ title, subtitle, accent = "var(--blue)", right, children }: {
  title: string; subtitle?: string; accent?: string; right?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="oc-card" style={{ "--hc": accent } as CSSProperties}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3>{title}</h3>
          {subtitle && <div className="oc-card-sub">{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div style={{ padding: "28px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>{children}</div>;
}

export function SectionState({ loading, error, empty, emptyText, children }: {
  loading: boolean; error: string | null | undefined; empty: boolean; emptyText: string; children: ReactNode;
}) {
  if (loading) return <EmptyNote>Loading...</EmptyNote>;
  if (error) return <EmptyNote>Could not load this section: {error}</EmptyNote>;
  if (empty) return <EmptyNote>{emptyText}</EmptyNote>;
  return <>{children}</>;
}

const SERIES_COLORS = ["var(--blue)", "var(--orange)", "var(--teal)", "var(--purple)", "var(--red)", "var(--yellow)", "var(--green)", "var(--muted-strong)"];

export interface MatrixFormat { unit: "count" | "percent" | "seconds"; digits?: number }

export function formatMatrixValue(v: number | null, fmt: MatrixFormat): string {
  if (v === null) return DASH;
  if (fmt.unit === "percent") return fmtPct(v, fmt.digits ?? 1);
  if (fmt.unit === "seconds") return `${fmtInt(v)}s`;
  return fmtInt(v);
}

/**
 * Line chart with data labels, one line per matrix row. `secondAxisFrom` puts every row at or
 * after that index on a right-hand axis (AHT and Volume have different scales). A null value
 * is a gap in the line, never a zero.
 */
export function MatrixLineChart({ matrix, granularity, format, secondAxisFrom, formats, height = 300 }: {
  matrix: Matrix; granularity: Granularity; format: MatrixFormat; secondAxisFrom?: number; formats?: MatrixFormat[]; height?: number;
}) {
  const data = matrix.buckets.map((b, i) => {
    const row: Record<string, string | number | null> = { bucket: bucketAxisLabel(b, granularity) };
    matrix.rows.forEach((r) => { row[r.label] = r.values[i]; });
    return row;
  });
  const fmtFor = (idx: number): MatrixFormat => formats?.[idx] ?? format;
  const dual = secondAxisFrom !== undefined;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 28, right: 24, left: 4, bottom: 8 }}>
        <CartesianGrid stroke="rgba(148,163,184,0.18)" vertical={false} />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11, fill: "var(--muted)" }}
          tickFormatter={(v: number) => formatMatrixValue(v, fmtFor(0))} />
        {dual && (
          <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={56}
            tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: number) => formatMatrixValue(v, fmtFor(secondAxisFrom!))} />
        )}
        <RTooltip formatter={(v: number | null, name: string) => {
          const idx = matrix.rows.findIndex((r) => r.label === name);
          return [formatMatrixValue(v, fmtFor(idx)), name];
        }} />
        <Legend verticalAlign="top" align="left" height={32} iconType="plainline" wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
        {matrix.rows.map((r, i) => {
          const color = SERIES_COLORS[i % SERIES_COLORS.length];
          const onRight = dual && i >= secondAxisFrom!;
          return (
            <Line key={r.label} yAxisId={onRight ? "right" : "left"} type="monotone" dataKey={r.label} name={r.label}
              stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false}>
              <LabelList dataKey={r.label} position={i % 2 === 0 ? "top" : "bottom"} offset={8} fontSize={9} fontWeight={700} fill={color}
                formatter={(v: number | null) => (v === null || v === undefined ? "" : formatMatrixValue(v, fmtFor(i)))} />
            </Line>
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** The sheet's "row = task type / metric, column = period" grid. */
export function MatrixTable({ matrix, granularity, format, formats, labelHeader }: {
  matrix: Matrix; granularity: Granularity; format: MatrixFormat; formats?: MatrixFormat[]; labelHeader: string;
}) {
  return (
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <table className="oc-table">
        <thead>
          <tr>
            <th>{labelHeader}</th>
            {matrix.buckets.map((b) => <th key={b} className="oc-right">{bucketAxisLabel(b, granularity)}</th>)}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((r, idx) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {r.values.map((v, i) => (
                <td key={matrix.buckets[i]} className="oc-right">{formatMatrixValue(v, formats?.[idx] ?? format)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** True when a matrix has no real number at all (so the chart would be a blank frame). */
export function matrixIsEmpty(m: Matrix | null | undefined): boolean {
  return !m || m.buckets.length === 0 || m.rows.every((r) => r.values.every((v) => v === null));
}
