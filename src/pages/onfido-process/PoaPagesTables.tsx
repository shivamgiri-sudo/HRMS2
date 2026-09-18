import type { CSSProperties, ReactNode } from "react";
import { Bar, ComposedChart, LabelList, Legend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";

/**
 * Shared building blocks for the POA Internal / External / Trail pages
 * (PoaPagesViews.tsx). Data shapes mirror
 * backend/src/modules/onfido-process/onfido-poa-pages.service.ts.
 * FAR / FRR / Manual FAR / Manual FRR are intentionally absent (owner constraint).
 */

// ── Types (mirror backend) ──────────────────────────────────────────────────

export interface PoaDrill {
  title: string;
  table: "ONFIDO_POA_QUALITY" | "ONFIDO_POA_EXTERNAL_RAW" | "ONFIDO_POA_TRIAL_RAW";
  filterColumn: string;
  filterValue: string;
}
export type PoaDrillHandler = (d: PoaDrill) => void;

export interface AuditMatrixRow {
  particular: string;
  sortKey: string;
  totalQc: number;
  errors: number;
  errorBase: number;
  errorPct: number;
  classificationError: number;
  classificationPct: number;
  extractionError: number;
  extractionPct: number;
  comparisonError: number;
  comparisonPct: number;
  isGrandTotal?: boolean;
}

export interface AuditCards {
  sample: number;
  errors: number;
  accuracy: number;
  errorRate: number;
  classificationError: number;
  extractionError: number;
  comparisonError: number;
}

export interface AuditChartPoint { date: string; label: string; audits: number; errors: number; errorPct: number }

export interface RegionQualityRow {
  date: string;
  dateLabel: string;
  euQc: number; euError: number; euErrorPct: number;
  caQc: number; caError: number; caErrorPct: number;
  usQc: number; usError: number; usErrorPct: number;
  totalQc: number; totalError: number; totalErrorPct: number;
  isGrandTotal?: boolean;
}

export interface PoaAuditPage {
  cards: AuditCards;
  chartDaily: AuditChartPoint[];
  dailyArr: AuditMatrixRow[];
  weeklyArr: AuditMatrixRow[];
  tlArr: AuditMatrixRow[];
  amArr: AuditMatrixRow[];
  analystArr: AuditMatrixRow[];
  clientArr: AuditMatrixRow[];
  docArr: AuditMatrixRow[];
  topAnalysts: AuditMatrixRow[];
  topDefaulters: AuditMatrixRow[];
  regionQuality: RegionQualityRow[];
  notes: string[];
}

export interface TrailDailyPoint {
  date: string; label: string; miss: number; notMiss: number; total: number;
  tasks: number; audits: number; errors: number; errorPct: number;
}

export interface TrailDetailRow {
  date: string; dateLabel: string; analystEmail: string; clientName: string;
  manualProcessingTime: number | null; tat10Pct: number | null; tat30Pct: number | null;
  slaStatus: string; tlName: string; amName: string; status: string; reason: string; secondLevel: string;
}

export interface PoaTrailPage {
  cards: { total: number; miss: number; notMiss: number; missPct: number };
  dailyArr: TrailDailyPoint[];
  detailRows: TrailDetailRow[];
  notes: string[];
}

// ── Formatting + conditional colours (reference qualityErrorCellClass_ etc.) ─

export const fmtN = (v: number): string => Math.round(Number(v) || 0).toLocaleString("en-IN");
export const fmtPct = (v: number): string => `${(Number(v) || 0).toFixed(2)}%`;
const fmtPctOrBlank = (v: number | null): string => (v === null ? "" : fmtPct(v));

export const ERROR_PCT_GOOD_BELOW = 0.5;
export const ACCURACY_TARGET = 99.5;

interface Tone { color: string; background: string }
const GOOD: Tone = { color: "#166534", background: "#ecfdf5" };
const BAD: Tone = { color: "#991b1b", background: "#fff1f2" };
const WARN: Tone = { color: "#92400e", background: "#fffbeb" };

const errorTone = (v: number): Tone => (v < ERROR_PCT_GOOD_BELOW ? GOOD : BAD);
const accuracyTone = (v: number): Tone => (v >= ACCURACY_TARGET ? GOOD : BAD);
/** Reference AHT rule: green <= 200s, amber 201-220s, red > 220s. */
const ahtTone = (secs: number): Tone => (secs <= 200 ? GOOD : secs <= 220 ? WARN : BAD);
const toneStyle = (t: Tone): CSSProperties => ({ color: t.color, background: t.background, fontWeight: 800 });

export const QUALITY_COLORS = { audits: "#8ec5ff", errors: "#ff9aa6", errPct: "#7c3aed", task: "#a5b4fc", miss: "#ff9aa6", notMiss: "#8ec5ff" };

// ── Card shell + states ─────────────────────────────────────────────────────

const centered: CSSProperties = { padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" };

export function SectionCard({ title, sub, hc = "var(--blue)", children }: {
  title: string; sub?: string; hc?: string; children: ReactNode;
}) {
  return (
    <div className="oc-card" style={{ "--hc": hc } as CSSProperties}>
      <h3>{title}</h3>
      {sub && <div className="oc-card-sub">{sub}</div>}
      {children}
    </div>
  );
}

export interface LoadState { loading: boolean; error: string | null }

function StateMessage({ state, empty }: { state: LoadState; empty: string }) {
  if (state.loading) return <div style={centered}>Loading…</div>;
  if (state.error) return <div style={{ ...centered, color: "var(--red)" }}>Could not load: {state.error}</div>;
  return <div style={centered}>{empty}</div>;
}

export function NoteBanner({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="oc-card" style={{ "--hc": "var(--orange)" } as CSSProperties}>
      {notes.map((n) => <div key={n} style={{ fontSize: 12, color: "var(--muted-strong)" }}>{n}</div>)}
    </div>
  );
}

// ── KPI cards ───────────────────────────────────────────────────────────────

export interface CardSpec { title: string; value: string; sub: string; color: string; tone?: Tone | null }

export function KpiRow({ cards, state }: { cards: CardSpec[]; state: LoadState }) {
  const empty = state.loading || state.error !== null;
  return (
    <div className="kr" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
      {cards.map((c) => (
        <div
          key={c.title}
          className="kpi"
          style={{ "--kc": c.color, cursor: "default", ...(!empty && c.tone ? { background: c.tone.background } : {}) } as CSSProperties}
        >
          <label>{c.title}</label>
          <div className={empty ? "kv empty" : "kv"} style={!empty && c.tone ? { color: c.tone.color } : undefined}>
            {state.loading ? "…" : state.error ? "n/a" : c.value}
          </div>
          <div className="ks">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

export function auditCardSpecs(cards: AuditCards | undefined, labels: { sample: string; sampleSub: string; errors: string; errorsSub: string; accuracy: string; errorRate: string; errorRateSub: string }): CardSpec[] {
  const c = cards ?? { sample: 0, errors: 0, accuracy: 0, errorRate: 0, classificationError: 0, extractionError: 0, comparisonError: 0 };
  return [
    { title: labels.sample, value: fmtN(c.sample), sub: labels.sampleSub, color: "var(--blue)" },
    { title: labels.errors, value: fmtN(c.errors), sub: labels.errorsSub, color: "var(--red)" },
    { title: labels.accuracy, value: fmtPct(c.accuracy), sub: "Target 99.5%", color: "var(--green)", tone: c.sample > 0 ? accuracyTone(c.accuracy) : null },
    { title: labels.errorRate, value: fmtPct(c.errorRate), sub: labels.errorRateSub, color: "var(--orange)", tone: c.sample > 0 ? errorTone(c.errorRate) : null },
    { title: "Classification Error", value: fmtN(c.classificationError), sub: "Classification / Document Type / Incorrect", color: "var(--purple)" },
    { title: "Extraction Error", value: fmtN(c.extractionError), sub: "Issue date / issuer / address / expiry", color: "var(--teal)" },
    { title: "Comparison Error", value: fmtN(c.comparisonError), sub: "First / last / address comparison", color: "var(--pink)" },
  ];
}

// ── Tables ──────────────────────────────────────────────────────────────────

const GRAND_STYLE: CSSProperties = { background: "#eaf3ff", color: "#0a254d", fontWeight: 900, borderTop: "2px solid #cddcf0" };

const MATRIX_HEADERS = [
  "Total QC", "Error", "Total Error %", "Classification Error", "Classification %",
  "Extraction Error", "Extraction Error %", "Data Comparison Error", "Comparison Error %",
];

/** Deep-dive matrix: Particular | Total QC | Error | Total Error % | Classification ... | Comparison Error %. */
export function MatrixTable({ title, sub, firstHeader, rows, state, onRowClick, hc }: {
  title: string; sub?: string; firstHeader: string; rows: AuditMatrixRow[]; state: LoadState;
  onRowClick?: (row: AuditMatrixRow) => void; hc?: string;
}) {
  return (
    <SectionCard title={title} sub={sub} hc={hc}>
      {rows.length === 0 ? (
        <StateMessage state={state} empty="No data available." />
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 460 }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th>{firstHeader}</th>
                {MATRIX_HEADERS.map((h) => <th key={h} className="oc-right">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const clickable = !!onRowClick && !r.isGrandTotal;
                const cell = (extra?: CSSProperties): CSSProperties | undefined => (r.isGrandTotal ? { ...GRAND_STYLE, ...extra } : extra);
                const pctCell = (v: number) => (r.isGrandTotal ? GRAND_STYLE : toneStyle(errorTone(v)));
                return (
                  <tr
                    key={`${r.sortKey}|${r.particular}`}
                    className={clickable ? "oc-row-click" : undefined}
                    onClick={clickable ? () => onRowClick(r) : undefined}
                  >
                    <td style={cell({ fontWeight: 600 })}>{r.particular}</td>
                    <td className="oc-right" style={cell()}>{fmtN(r.totalQc)}</td>
                    <td className="oc-right" style={cell()}>{fmtN(r.errors)}</td>
                    <td className="oc-right" style={pctCell(r.errorPct)}>{fmtPct(r.errorPct)}</td>
                    <td className="oc-right" style={cell()}>{fmtN(r.classificationError)}</td>
                    <td className="oc-right" style={pctCell(r.classificationPct)}>{fmtPct(r.classificationPct)}</td>
                    <td className="oc-right" style={cell()}>{fmtN(r.extractionError)}</td>
                    <td className="oc-right" style={pctCell(r.extractionPct)}>{fmtPct(r.extractionPct)}</td>
                    <td className="oc-right" style={cell()}>{fmtN(r.comparisonError)}</td>
                    <td className="oc-right" style={pctCell(r.comparisonPct)}>{fmtPct(r.comparisonPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

/** "Day Wise - EU / CA / US Internal Quality" (grouped header, Grand Total row). */
export function RegionTable({ title, sub, rows, state }: { title: string; sub: string; rows: RegionQualityRow[]; state: LoadState }) {
  const groupHead: CSSProperties = { textAlign: "center", borderLeft: "1px solid var(--border)" };
  return (
    <SectionCard title={title} sub={sub} hc="var(--teal)">
      {rows.length === 0 ? (
        <StateMessage state={state} empty="No EU / CA / US internal quality data available." />
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 460 }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th rowSpan={2}>Date</th>
                <th colSpan={3} style={groupHead}>EU Task</th>
                <th colSpan={3} style={groupHead}>CA Task</th>
                <th colSpan={3} style={groupHead}>US Task</th>
                <th rowSpan={2} className="oc-right" style={{ borderLeft: "1px solid var(--border)" }}>Total Total QC</th>
                <th rowSpan={2} className="oc-right">Total Error</th>
                <th rowSpan={2} className="oc-right">Total Error %</th>
              </tr>
              <tr>
                {["EU", "CA", "US"].flatMap((g) => ["Total QC", "Error", "Error %"].map((h, i) => (
                  <th key={`${g}${h}`} className="oc-right" style={{ fontSize: 10, top: 34, ...(i === 0 ? { borderLeft: "1px solid var(--border)" } : {}) }}>{h}</th>
                )))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const g = r.isGrandTotal ? GRAND_STYLE : undefined;
                const p = (v: number) => (r.isGrandTotal ? GRAND_STYLE : toneStyle(errorTone(v)));
                return (
                  <tr key={r.date}>
                    <td style={{ ...g, fontWeight: 600 }}>{r.dateLabel}</td>
                    <td className="oc-right" style={g}>{fmtN(r.euQc)}</td>
                    <td className="oc-right" style={g}>{fmtN(r.euError)}</td>
                    <td className="oc-right" style={p(r.euErrorPct)}>{fmtPct(r.euErrorPct)}</td>
                    <td className="oc-right" style={g}>{fmtN(r.caQc)}</td>
                    <td className="oc-right" style={g}>{fmtN(r.caError)}</td>
                    <td className="oc-right" style={p(r.caErrorPct)}>{fmtPct(r.caErrorPct)}</td>
                    <td className="oc-right" style={g}>{fmtN(r.usQc)}</td>
                    <td className="oc-right" style={g}>{fmtN(r.usError)}</td>
                    <td className="oc-right" style={p(r.usErrorPct)}>{fmtPct(r.usErrorPct)}</td>
                    <td className="oc-right" style={g}>{fmtN(r.totalQc)}</td>
                    <td className="oc-right" style={g}>{fmtN(r.totalError)}</td>
                    <td className="oc-right" style={p(r.totalErrorPct)}>{fmtPct(r.totalErrorPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

const TRAIL_HEADERS = [
  "Date", "Analyst Email", "Client Name", "Manual Processing Time", "% Report TaT < 10m", "% Report TaT < 30m",
  "SLA Status", "TL Name", "AM Name", "Status", "Reason", "2nd Level",
];

export function TrailTable({ title, rows, state, onRowClick }: {
  title: string; rows: TrailDetailRow[]; state: LoadState; onRowClick?: (row: TrailDetailRow) => void;
}) {
  return (
    <SectionCard title={title} hc="var(--purple)">
      {rows.length === 0 ? (
        <StateMessage state={state} empty="No data available." />
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520 }}>
          <table className="oc-table">
            <thead>
              <tr>{TRAIL_HEADERS.map((h, i) => <th key={h} className={i >= 3 && i <= 5 ? "oc-right" : undefined}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.date}|${r.analystEmail}|${i}`}
                  className={onRowClick && r.analystEmail ? "oc-row-click" : undefined}
                  onClick={onRowClick && r.analystEmail ? () => onRowClick(r) : undefined}
                >
                  <td style={{ whiteSpace: "nowrap" }}>{r.dateLabel}</td>
                  <td>{r.analystEmail}</td>
                  <td>{r.clientName}</td>
                  <td className="oc-right" style={r.manualProcessingTime === null ? undefined : toneStyle(ahtTone(r.manualProcessingTime))}>
                    {r.manualProcessingTime === null ? "" : fmtN(r.manualProcessingTime)}
                  </td>
                  <td className="oc-right">{fmtPctOrBlank(r.tat10Pct)}</td>
                  <td className="oc-right">{fmtPctOrBlank(r.tat30Pct)}</td>
                  <td style={/greater/i.test(r.slaStatus) ? { color: BAD.color, fontWeight: 700 } : undefined}>{r.slaStatus}</td>
                  <td>{r.tlName}</td>
                  <td>{r.amName}</td>
                  <td>{r.status}</td>
                  <td>{r.reason}</td>
                  <td>{r.secondLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── Charts (data labels on every bar and line point, no gridlines) ──────────

const PX_PER_POINT = 72;
const MIN_CHART_WIDTH = 900;
const CHART_HEIGHT = 330;
const LABEL_FONT = 10;

const tooltipFormatter = (value: unknown, name: unknown): [string, string] => {
  const label = String(name);
  return [label.includes("%") ? fmtPct(Number(value)) : fmtN(Number(value)), label];
};

function ChartScroller({ points, children }: { points: number; children: ReactNode }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: Math.max(MIN_CHART_WIDTH, points * PX_PER_POINT) }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>{children as React.ReactElement}</ResponsiveContainer>
      </div>
    </div>
  );
}

const countLabel = (v: unknown): string => fmtN(Number(v));
const pctLabel = (v: unknown): string => fmtPct(Number(v));

const AXIS_TICK = { fontSize: 11, fill: "var(--muted)" } as const;
const X_AXIS_PROPS = { dataKey: "label", interval: 0, angle: -35, textAnchor: "end", height: 58, tickLine: false, tick: AXIS_TICK } as const;

/** Bars for audits + errors, line for error % on the right axis. */
export function AuditComboChart({ title, points, state }: { title: string; points: AuditChartPoint[]; state: LoadState }) {
  return (
    <SectionCard title={title} sub="Audits and Error as bars, Error% as a line on the right axis. Data labels on every point; scroll sideways for more dates." hc="var(--blue)">
      {points.length === 0 ? (
        <StateMessage state={state} empty="No data available." />
      ) : (
        <ChartScroller points={points.length}>
          <ComposedChart data={points} margin={{ top: 24, right: 16, left: 4, bottom: 4 }} barGap={3}>
            <XAxis {...X_AXIS_PROPS} />
            <YAxis yAxisId="count" tickLine={false} axisLine={false} width={48} allowDecimals={false} tick={AXIS_TICK} />
            <YAxis yAxisId="pct" orientation="right" tickLine={false} axisLine={false} width={52} tick={AXIS_TICK} tickFormatter={(v: number) => `${v}%`} />
            <RTooltip formatter={tooltipFormatter} />
            <Legend verticalAlign="top" height={28} />
            <Bar yAxisId="count" dataKey="audits" name="Audits" fill={QUALITY_COLORS.audits} maxBarSize={26} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="audits" position="top" fontSize={LABEL_FONT} formatter={countLabel} />
            </Bar>
            <Bar yAxisId="count" dataKey="errors" name="Error" fill={QUALITY_COLORS.errors} maxBarSize={26} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="errors" position="top" fontSize={LABEL_FONT} formatter={countLabel} />
            </Bar>
            <Line yAxisId="pct" type="monotone" dataKey="errorPct" name="Error%" stroke={QUALITY_COLORS.errPct} strokeWidth={1.5} dot={{ r: 3 }} isAnimationActive={false}>
              <LabelList dataKey="errorPct" position="top" fontSize={LABEL_FONT} fill={QUALITY_COLORS.errPct} formatter={pctLabel} />
            </Line>
          </ComposedChart>
        </ChartScroller>
      )}
    </SectionCard>
  );
}

export function TrailMissChart({ title, points, state }: { title: string; points: TrailDailyPoint[]; state: LoadState }) {
  const shown = points.filter((p) => p.miss > 0 || p.notMiss > 0);
  return (
    <SectionCard title={title} sub="Miss SLA = Greater than 30 Min; Not Miss SLA = Less Then 10 / 30 Min." hc="var(--red)">
      {shown.length === 0 ? (
        <StateMessage state={state} empty="No POA Trail SLA data available." />
      ) : (
        <ChartScroller points={shown.length}>
          <ComposedChart data={shown} margin={{ top: 24, right: 16, left: 4, bottom: 4 }} barGap={3}>
            <XAxis {...X_AXIS_PROPS} />
            <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={false} tick={AXIS_TICK} />
            <RTooltip formatter={tooltipFormatter} />
            <Legend verticalAlign="top" height={28} />
            <Bar dataKey="miss" name="Miss SLA" fill={QUALITY_COLORS.miss} maxBarSize={30} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="miss" position="top" fontSize={LABEL_FONT} formatter={countLabel} />
            </Bar>
            <Bar dataKey="notMiss" name="Not Miss SLA" fill={QUALITY_COLORS.notMiss} maxBarSize={30} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="notMiss" position="top" fontSize={LABEL_FONT} formatter={countLabel} />
            </Bar>
          </ComposedChart>
        </ChartScroller>
      )}
    </SectionCard>
  );
}

export function TrailTaskChart({ title, points, state }: { title: string; points: TrailDailyPoint[]; state: LoadState }) {
  const shown = points.filter((p) => p.tasks > 0 || p.audits > 0 || p.errors > 0);
  return (
    <SectionCard title={title} sub="Error% = Error / Audits." hc="var(--purple)">
      {shown.length === 0 ? (
        <StateMessage state={state} empty="No Task / Audit / Error data available." />
      ) : (
        <ChartScroller points={shown.length}>
          <ComposedChart data={shown} margin={{ top: 24, right: 16, left: 4, bottom: 4 }} barGap={2}>
            <XAxis {...X_AXIS_PROPS} />
            <YAxis yAxisId="count" tickLine={false} axisLine={false} width={48} allowDecimals={false} tick={AXIS_TICK} />
            <YAxis yAxisId="pct" orientation="right" tickLine={false} axisLine={false} width={52} tick={AXIS_TICK} tickFormatter={(v: number) => `${v}%`} />
            <RTooltip formatter={tooltipFormatter} />
            <Legend verticalAlign="top" height={28} />
            <Bar yAxisId="count" dataKey="tasks" name="Task" fill={QUALITY_COLORS.task} maxBarSize={20} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="tasks" position="top" fontSize={LABEL_FONT} formatter={countLabel} />
            </Bar>
            <Bar yAxisId="count" dataKey="audits" name="Audits" fill={QUALITY_COLORS.audits} maxBarSize={20} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="audits" position="top" fontSize={LABEL_FONT} formatter={countLabel} />
            </Bar>
            <Bar yAxisId="count" dataKey="errors" name="Error" fill={QUALITY_COLORS.errors} maxBarSize={20} radius={[4, 4, 0, 0]}>
              <LabelList dataKey="errors" position="top" fontSize={LABEL_FONT} formatter={countLabel} />
            </Bar>
            <Line yAxisId="pct" type="monotone" dataKey="errorPct" name="Error%" stroke={QUALITY_COLORS.errPct} strokeWidth={1.5} dot={{ r: 3 }} isAnimationActive={false}>
              <LabelList dataKey="errorPct" position="top" fontSize={LABEL_FONT} fill={QUALITY_COLORS.errPct} formatter={pctLabel} />
            </Line>
          </ComposedChart>
        </ChartScroller>
      )}
    </SectionCard>
  );
}

// ── Trail card specs ────────────────────────────────────────────────────────

export function trailCardSpecs(cards: PoaTrailPage["cards"] | undefined): CardSpec[] {
  const c = cards ?? { total: 0, miss: 0, notMiss: 0, missPct: 0 };
  return [
    { title: "Total Trail SLA", value: fmtN(c.total), sub: "Miss + Not Miss SLA", color: "var(--blue)" },
    { title: "Miss SLA", value: fmtN(c.miss), sub: "Date-wise miss count", color: "var(--red)" },
    { title: "Not Miss SLA", value: fmtN(c.notMiss), sub: "Date-wise not miss count", color: "var(--green)" },
    { title: "Miss SLA%", value: fmtPct(c.missPct), sub: "Miss SLA / Total", color: "var(--orange)" },
  ];
}
