import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PoaExternalPage, PoaInternalPage, PoaTrailPage, type PoaDrill } from "./PoaPagesViews";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, ArrowLeft, CalendarRange, Database, FileBarChart2, FileSearch, FileText, FlaskConical, Gauge, LayoutGrid, Layers3,
  MessageSquareWarning, Radio, Search, ShieldAlert, SkipForward, TrendingDown, TrendingUp, UserCheck, Users2,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import OnfidoOverviewReport from "./OnfidoOverviewReport";
import OnfidoAnalystReport from "./OnfidoAnalystReport";
import OnfidoNameMapping from "./OnfidoNameMapping";
import OnfidoUtilizationReport from "./OnfidoUtilizationReport";
import { shiftDays } from "./onfidoReportShared";
import "./onfido-central-theme.css";

/**
 * This page's visual language is a deliberate, close copy of the "Central
 * Dashboard" reference tool (onfido-central-dashboard.vercel.app) — its exact
 * card recipe, KPI-tile anatomy and color set, read off that page's own
 * computed styles rather than approximated from a screenshot. See
 * ./onfido-central-theme.css for the extracted rules. Everything below is
 * plain markup styled by that stylesheet (not shadcn Card/Table/Select),
 * because those primitives assume this app's light theme tokens and fighting
 * that per-component was less reliable than owning the markup here.
 */

// ── Types (mirror backend onfido-process-dashboard.service.ts) ─────────────────

type Availability = "ok" | "no_data";

interface KpiValue {
  key: string;
  label: string;
  value: number | null;
  unit: "count" | "percent" | "seconds" | null;
  availability: Availability;
  note?: string;
}

interface OverviewData {
  filters: { from: string; to: string; tlName: string | null };
  doc: {
    volume: KpiValue; avgAht: KpiValue; escalationRate: KpiValue;
    auditErrorRate: KpiValue; clientEscalationLines: KpiValue;
    manualFarRate?: KpiValue; manualFrrRate?: KpiValue;
    classificationRate?: KpiValue; extractionRate?: KpiValue;
  };
  poa: {
    volume: KpiValue; avgAht: KpiValue; errorRate: KpiValue;
    classificationErrorRate: KpiValue; extractionErrorRate: KpiValue; dataComparisonErrorRate: KpiValue;
  };
}

interface MetricTlRow { tlName: string; value: number | null; note?: string }

interface TlBreakdownRow {
  tlName: string;
  docVolume: number;
  docAvgAht: number | null;
  docEscalations: number;
  docAuditErrorRate: number | null;
  escalationLines: number;
  manualFarRate: number | null;
  manualFrrRate: number | null;
  classificationRate: number | null;
  extractionRate: number | null;
}


interface TableInfo { key: string; table: string; name: string; description: string }

type RawRecord = Record<string, unknown> & { id: string; raw_data: Record<string, unknown> };

type ViewKey =
  | "overview" | "analyst" | "utilization" | "trends" | "alerts" | "attrition" | "etm" | "taskskip" | "quality"
  | "escalations" | "docraw" | "poa" | "poatrial" | "clientdoc" | "poaexternal" | "gdmcnsla" | "live" | "namemapping";
type Granularity = "daily" | "weekly" | "monthly";

interface VolumeTrendPoint { bucket: string; doc: number; poa: number }

interface AnalystSearchHit { email: string; tlName: string | null; taskCount: number }

interface AnalystPerformance {
  email: string;
  tlName: string | null;
  amName: string | null;
  qaName: string | null;
  totalTasks: KpiValue;
  avgManualProcessingTime: KpiValue;
  overallErrorRate: KpiValue;
  manualFarRate: KpiValue;
  manualFrrRate: KpiValue;
  poaTasks: KpiValue;
  poaAvgAht: KpiValue;
  poaErrorRate: KpiValue;
  monthly: { month: string; tasks: number; errorRate: number | null }[];
  peers: { email: string; tlName: string | null; tasks: number; errorRate: number | null }[];
}

interface AlertRow {
  analystEmail: string;
  tlName: string | null;
  metric: string;
  value: number;
  threshold: number;
  severity: "high" | "medium";
}

interface AttritionOverview {
  month: string;
  openingHc: KpiValue; closingHc: KpiValue; avgHc: KpiValue;
  attritionCount: KpiValue; attritionRate: KpiValue;
  scheduled: KpiValue; unplannedLeave: KpiValue;
  ulShrinkageRate: KpiValue; actualShrinkageRate: KpiValue;
}
interface AttritionMonthRow {
  month: string; openingHc: number; closingHc: number; avgHc: number;
  attritionCount: number; attritionRate: number | null;
  scheduled: number; unplannedLeave: number; actualUl: number;
  ulShrinkageRate: number | null; actualShrinkageRate: number | null;
}
interface AttritionBreakdownRow {
  label: string; rawLabel: string; month: string;
  openingHc: number; closingHc: number; avgHc: number;
  attritionCount: number; attritionRate: number | null;
  scheduled: number; unplannedLeave: number; actualUl: number;
  ulShrinkageRate: number | null; actualShrinkageRate: number | null;
  note?: string;
}
interface AttritionAonMonthRow { month: string; buckets: Record<string, number | null> }
interface AttritionReasonMonthly {
  months: string[];
  groups: { type: "Voluntary" | "Involuntary" | "Unspecified"; totals: number[]; total: number; reasons: { reason: string; counts: number[]; total: number }[] }[];
  grandTotals: number[];
  grandTotal: number;
}
interface AttritionExitRow {
  id: string;
  empId: string; empName: string; analystEmail: string; tlName: string; amName: string;
  exitDate: string; reason: string | null; attritionType: string | null;
}
type AttritionDimension = "am_name" | "tl_name" | "aon_bucket" | "location";

interface EtmQueueKpis { selected: KpiValue; latestDay: KpiValue; ytd: KpiValue }
interface EtmOverview { doc: EtmQueueKpis; poa: EtmQueueKpis }
interface EtmTrendPoint { bucket: string; doc: number; poa: number }
type EtmQueue = "doc" | "poa";
type EtmDimension = "tl_name" | "am_name" | "escalated_by_email" | "aon_bucket";
interface EtmBreakdownRow { label: string; count: number }
type EtmPivotDimension = "analyst" | "slot" | "client" | "document_type";

interface TaskSkipOverview { selected: KpiValue; latestDay: KpiValue; ytd: KpiValue }
interface TaskSkipTrendPoint { bucket: string; count: number }
interface QualityTrendPoint { bucket: string; taskCount: number; errorRate: number | null }
interface AttritionTrendPoint { bucket: string; attritionCount: number }
type TaskSkipDimension = "tl_name" | "am_name" | "unassigned_from_email" | "ims_client_name" | "task_type";
interface TaskSkipBreakdownRow { label: string; count: number }
type TaskSkipPivotDimension = "analyst" | "slot" | "client" | "task_type";

interface DayPivotRow { label: string; byDay: Record<string, number>; total: number }
interface DayPivot { days: string[]; rows: DayPivotRow[]; dayTotals: Record<string, number> }

interface QualityOverview {
  taskCount: KpiValue; overallErrorRate: KpiValue; farRate: KpiValue; frrRate: KpiValue;
  classificationErrorRate: KpiValue; extractionErrorRate: KpiValue;
  addExtractionErrorRate: KpiValue; rawExtractionErrorRate: KpiValue;
}
type QualityDimension = "ims_client_name" | "docupedia_document_name" | "tl_name" | "am_name";
interface QualityBreakdownRow { label: string; taskCount: number; overallErrorRate: number | null; farRate: number | null; frrRate: number | null }
interface DocInternalQualityOverview { taskCount: KpiValue; overallErrorRate: KpiValue }
interface QualityMetricTrendPoint {
  bucket: string;
  overallErrorRate: number | null;
  classificationErrorRate: number | null;
  extractionErrorRate: number | null;
  addExtractionErrorRate: number | null;
  rawExtractionErrorRate: number | null;
}

interface EscalationOverview {
  totalLines: KpiValue; creLines: KpiValue; crqLines: KpiValue; distinctReports: KpiValue;
}
interface EscalationTrendPoint { bucket: string; count: number; creCount: number; crqCount: number }
type EscalationDimension = "ims_client_name" | "error_category" | "tl_name" | "am_name";
interface EscalationBreakdownRow { label: string; count: number }

interface DocRawOverview {
  taskCount: KpiValue; avgAht: KpiValue; avgQueueTime: KpiValue; escalationRate: KpiValue;
}
interface DocRawTrendPoint { bucket: string; taskCount: number; avgAht: number | null }
type DocRawDimension = "ims_client_name" | "tl_name" | "am_name" | "task_type";
interface DocRawBreakdownRow { label: string; taskCount: number; avgAht: number | null; escalationRate: number | null }
interface DocTaskTypeTrendPoint { bucket: string; byTaskType: Record<string, { taskCount: number; avgAht: number | null }> }

interface PoaOverview {
  taskCount: KpiValue; avgAht: KpiValue; errorRate: KpiValue;
  classificationErrorRate: KpiValue; extractionErrorRate: KpiValue; dataComparisonErrorRate: KpiValue;
}
interface PoaTrendPoint { bucket: string; taskCount: number }
type PoaDimension = "tl_name" | "am_name";
interface PoaBreakdownRow { label: string; taskCount: number; avgAht: number | null; errorRate: number | null }
type PoaEntityDimension = "tl_name" | "am_name" | "analyst_email";
interface PoaEntityMonthCell { taskCount: number; avgAht: number | null; poaErrPct: number | null; extPoaErrPct: number | null }
interface PoaEntityMonthRow { entity: string; byMonth: Record<string, PoaEntityMonthCell> }
interface PoaDayRow {
  date: string; taskCount: number; avgAht: number | null;
  poaAudits: number; poaErrors: number; poaErrPct: number | null;
  extPoaAudits: number; extPoaErrors: number; extPoaErrPct: number | null;
}
interface PoaTrialOverview { taskCount: KpiValue; avgAht: KpiValue; considerRate: KpiValue }
interface PoaTrialTrendPoint { bucket: string; taskCount: number }
type PoaTrialDimension = "tl_name" | "am_name";
interface PoaTrialBreakdownRow { label: string; taskCount: number; avgAht: number | null; considerRate: number | null }

interface ClientDocOverview {
  totalTasks: KpiValue; docTasks: KpiValue; poaTasks: KpiValue; avgAht: KpiValue; distinctClients: KpiValue;
}
interface ClientDocTrendPoint { bucket: string; doc: number; poa: number }
interface ClientDocBreakdownRow { clientName: string; task: "DOC" | "POA"; taskCount: number; aht: number | null }
interface ClientDocRecordRow extends RawRecord { source_table: "ONFIDO_DOC_RAW" | "ONFIDO_POA_RAW" }

interface PoaExternalOverview { taskCount: KpiValue; avgAht: KpiValue; errorRate: KpiValue; distinctClients: KpiValue }
interface PoaExternalTrendPoint { bucket: string; taskCount: number; errorCount: number }
type PoaExternalDimension = "ims_client_name" | "tl_name" | "am_name" | "location";
interface PoaExternalBreakdownRow { label: string; taskCount: number; avgAht: number | null; errorRate: number | null }

interface GdMcnSlaOverview {
  avgSlaPct: KpiValue; avgGdPct: KpiValue; avgMcnPct: KpiValue; avgOccupancyPct: KpiValue; avgAvailPct: KpiValue;
}
interface GdMcnSlaTrendPoint {
  bucket: string; slaPct: number | null; gdPct: number | null; mcnPct: number | null;
  commitment: number | null; fteDelivered: number | null;
  docAht?: number | null; poaAht?: number | null;
}
/** One row of the client's "GD / MCN / SLA / APS Performance" sheet — percentages are ratios (0.93 = 93%). */
interface GdMcnSlaDetailRow {
  date: string; gmt: string; ist: string;
  gdPct: number | null; mcnPct: number | null; deficit: number | null; slaPct: number | null;
  docAht: number | null; poaAht: number | null; commitment: number | null; fteDelivered: number | null;
  apsPct: number | null; occupancyPct: number | null; availPct: number | null; isTotal: boolean;
}
interface GdMcnSlaSlotRow { slot: string; slaPct: number | null; gdPct: number | null; mcnPct: number | null; occupancyPct: number | null }

interface LiveOverview {
  docLiveTaskCount: KpiValue; docLiveAht: KpiValue; docLiveAuditCount: KpiValue; docLiveErrorCount: KpiValue;
  poaLiveTaskCount: KpiValue; poaLiveAht: KpiValue;
}
type LiveDimension = "tl_name" | "am_name";
interface LiveBreakdownRow { label: string; taskCount: number; avgAht: number | null }

interface PoaSlaBucket { label: string; count: number; pct: number | null }
interface PoaSlaMetrics {
  total: number;
  sla10: number; sla10Pct: number | null;
  sla20: number; sla20Pct: number | null;
  sla30: number; sla30Pct: number | null;
  gt30: number; gt30Pct: number | null;
  buckets: PoaSlaBucket[];
  dailyTrend: { date: string; total: number; sla10Pct: number | null; sla30Pct: number | null }[];
  weeklyTrend: { bucket: string; total: number; sla10Pct: number | null; sla30Pct: number | null }[];
  analystRows: { analyst: string; tlName: string | null; volume: number; sla10Pct: number | null; sla30Pct: number | null; avgAht: number | null }[];
}

interface AnalystQualityRow {
  analyst: string; tlName: string | null;
  intAudits: number; intErrors: number; intErrPct: number | null;
  extAudits: number; extErrors: number; extErrPct: number | null;
  overallErrPct: number | null;
}

interface AnalystRankingRow {
  email: string; tlName: string | null; amName: string | null;
  tasks: number; avgAht: number | null; errorRate: number | null; poaTasks: number;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatValue(kpi: KpiValue): string {
  if (kpi.availability === "no_data" || kpi.value === null) return "—";
  if (kpi.unit === "percent") return `${kpi.value}%`;
  if (kpi.unit === "seconds") {
    const m = Math.floor(kpi.value / 60);
    const s = kpi.value % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  return kpi.value.toLocaleString("en-IN");
}

function formatMetricValue(kpi: KpiValue): string {
  if (kpi.value === null) return "—";
  return kpi.unit === "percent" ? `${kpi.value}%` : kpi.value.toLocaleString("en-IN");
}

function formatDateTime(value: unknown): string {
  if (!value) return "-";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(d);
}

function initials(name: string): string {
  const parts = name.replace(/[-–].*$/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const AVATAR_TONES = ["var(--blue)", "var(--purple)", "var(--teal)", "var(--green)", "var(--orange)", "var(--pink)", "var(--yellow)", "var(--red)"];

/** A stable, non-judgemental color per team leader, drawn from the theme's accent set. */
function avatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

// ── KPI tile ─────────────────────────────────────────────────────────────────

const KPI_ACCENT: Record<string, string> = {
  doc_volume: "var(--blue)",
  doc_avg_aht: "var(--purple)",
  doc_escalation_rate: "var(--orange)",
  doc_audit_error_rate: "var(--red)",
  doc_client_escalation_lines: "var(--pink)",
  poa_volume: "var(--teal)",
  poa_avg_aht: "var(--purple)",
  poa_error_rate: "var(--red)",
  poa_classification_error_rate: "var(--yellow)",
  poa_extraction_error_rate: "var(--orange)",
  poa_data_comparison_error_rate: "var(--pink)",
};

/** Every KPI tile opens its own drill-down (level 2: by TL, level 3: records, level 4: record detail). */
function KpiTile({ kpi, onDrill }: { kpi: KpiValue; onDrill: (kpi: KpiValue) => void }) {
  const empty = kpi.availability === "no_data" || kpi.value === null;
  return (
    <div
      className="kpi"
      style={{ "--kc": KPI_ACCENT[kpi.key] ?? "var(--blue)" } as React.CSSProperties}
      onClick={() => onDrill(kpi)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onDrill(kpi); }}
    >
      <label>{kpi.label}</label>
      <div className={empty ? "kv empty" : "kv"}>{formatValue(kpi)}</div>
      <div className="ks" title={kpi.note}>
        {empty ? "No data in this range" : kpi.note ?? " "}
      </div>
    </div>
  );
}

function SectionHead({ hc, title, subtitle }: { hc: string; title: string; subtitle?: string }) {
  return (
    <div className="oc-section-head">
      <div className="oc-eyebrow" style={{ "--hc": hc } as React.CSSProperties}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: "var(--muted)" }}>{subtitle}</div>}
    </div>
  );
}

/** Dark tooltip matching the theme, used by the trend chart below. */
function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "8px 10px", fontSize: 12, color: "var(--text)", boxShadow: "var(--shadow)",
    }}>
      <div style={{ color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: p.color }} />
          <span style={{ color: "var(--muted-strong)" }}>{p.name}:</span>
          <strong>{p.value.toLocaleString("en-IN")}</strong>
        </div>
      ))}
    </div>
  );
}

function ChartLegendRow() {
  return (
    <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "var(--muted-strong)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--blue)" }} /> DOC
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--teal)" }} /> POA
      </span>
    </div>
  );
}

/** Task volume (bars, left axis) + AHT in seconds (line, right axis) over month-wise
 *  buckets — the Overview page's DOC/POA "Task & AHT process" trend cards
 *  (2026-09-17 dashboard feedback, items #1/#4). */
function TaskAhtTrendChart({ points, barLabel, lineLabel, barColor: barC = "var(--blue)", lineColor = "var(--orange)" }: {
  points: { bucket: string; taskCount: number; avgAht: number | null }[];
  barLabel: string; lineLabel: string; barColor?: string; lineColor?: string;
}) {
  if (points.length === 0) {
    return <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>;
  }
  const data = points.map((p) => ({ ...p, avgAht: p.avgAht ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <YAxis yAxisId="count" tickLine={false} axisLine={false} width={48} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <YAxis yAxisId="aht" orientation="right" tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: lineColor }} tickFormatter={(v: number) => `${v}s`} />
        <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
        <Legend verticalAlign="top" align="left" height={28} iconType="square" wrapperStyle={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }} />
        <Bar yAxisId="count" dataKey="taskCount" name={barLabel} fill={barC} radius={[4, 4, 0, 0]} maxBarSize={44}>
          <LabelList dataKey="taskCount" position="top" fontSize={10} fontWeight={700} fill="var(--muted-strong)"
            formatter={(v: number) => v.toLocaleString("en-IN")} />
        </Bar>
        <Line yAxisId="aht" type="monotone" dataKey="avgAht" name={lineLabel} stroke={lineColor} strokeWidth={2} dot={{ r: 3 }} connectNulls>
          <LabelList dataKey="avgAht" position="top" offset={10} fontSize={10} fontWeight={700} fill={lineColor}
            formatter={(v: number) => `${v}s`} />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const TASK_TYPE_COLORS = ["var(--blue)", "var(--teal)", "var(--orange)", "var(--purple)", "var(--red)", "var(--yellow)", "var(--green)"];

/** Pivots the bucket→task-type map into one row per bucket with one field per task
 *  type, ordered by total volume descending (dominant category's line/legend first). */
function pivotTaskTypeTrend(points: DocTaskTypeTrendPoint[], metric: "taskCount" | "avgAht") {
  const taskTypes = new Set<string>();
  for (const p of points) for (const tt of Object.keys(p.byTaskType)) taskTypes.add(tt);
  const totals = new Map<string, number>();
  for (const tt of taskTypes) {
    let sum = 0;
    for (const p of points) sum += p.byTaskType[tt]?.taskCount ?? 0;
    totals.set(tt, sum);
  }
  const orderedTypes = [...taskTypes].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  const rows = points.map((p) => {
    const row: Record<string, string | number | null> = { bucket: p.bucket };
    for (const tt of orderedTypes) row[tt] = p.byTaskType[tt]?.[metric] ?? null;
    return row;
  });
  return { rows, taskTypes: orderedTypes };
}

/** "process_labelling_document_raw_extraction" -> "Labelling Document Raw Extraction". */
function prettyTaskType(raw: string): string {
  return raw
    .replace(/^process_/i, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Task-type-wise monthly Task/AHT chart — Overview items #2/#3 (2026-09-17 feedback, refined
 *  2026-09-18): Task volume renders as labelled grouped bars, AHT as labelled lines whose
 *  value labels alternate above/below and step outward per series so the numbers of nearby
 *  lines do not sit on top of each other. */
function TaskTypeSeriesChart({ points, metric, valueSuffix }: {
  points: DocTaskTypeTrendPoint[]; metric: "taskCount" | "avgAht"; valueSuffix?: string;
}) {
  const { rows, taskTypes } = useMemo(() => pivotTaskTypeTrend(points, metric), [points, metric]);
  if (rows.length === 0) {
    return <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>;
  }
  const fmt = (v: number) => (metric === "taskCount" ? v.toLocaleString("en-IN") : `${v}${valueSuffix ?? ""}`);
  const axis = (
    <>
      <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
      <YAxis tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11, fill: "var(--muted)" }}
        tickFormatter={(v: number) => fmt(v)} />
      <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
      <Legend verticalAlign="top" align="left" height={40} iconType="square" wrapperStyle={{ fontSize: 10, fontWeight: 700, color: "var(--text)" }} />
    </>
  );
  if (metric === "taskCount") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={rows} margin={{ top: 28, right: 16, left: 0, bottom: 0 }} barGap={3} barCategoryGap="18%">
          {axis}
          {taskTypes.map((tt, i) => {
            const color = TASK_TYPE_COLORS[i % TASK_TYPE_COLORS.length];
            return (
              <Bar key={tt} dataKey={tt} name={prettyTaskType(tt)} fill={color} radius={[3, 3, 0, 0]} maxBarSize={30}>
                <LabelList dataKey={tt} position="top" fontSize={9} fontWeight={700} fill={color}
                  formatter={(v: number | null) => (v == null ? "" : fmt(v))} />
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={rows} margin={{ top: 32, right: 24, left: 0, bottom: 8 }}>
        {axis}
        {taskTypes.map((tt, i) => {
          const color = TASK_TYPE_COLORS[i % TASK_TYPE_COLORS.length];
          const above = i % 2 === 0;
          return (
            <Line key={tt} type="monotone" dataKey={tt} name={prettyTaskType(tt)} stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls>
              <LabelList dataKey={tt} position={above ? "top" : "bottom"} offset={8 + Math.floor(i / 2) * 12} fontSize={9} fontWeight={700} fill={color}
                formatter={(v: number | null) => (v == null ? "" : fmt(v))} />
            </Line>
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** GD %/MCN %/SLA % over month-wise buckets — Overview page's "Month-wise GD & MCN
 *  Trend" card (2026-09-17 feedback item #6), reusing the existing gd-mcn-sla/trend
 *  endpoint at monthly granularity instead of its usual day-wise view. */
function GdMcnPercentChart({ points }: { points: GdMcnSlaTrendPoint[] }) {
  if (points.length === 0) {
    return <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: number) => `${v}%`} />
        <RTooltip content={<DarkTooltip />} />
        <Legend verticalAlign="top" align="left" height={28} iconType="line" wrapperStyle={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }} />
        <Line type="monotone" dataKey="gdPct" name="GD %" stroke="var(--blue)" strokeWidth={2} dot={{ r: 3 }} connectNulls>
          <LabelList dataKey="gdPct" position="top" fontSize={10} fontWeight={700} fill="var(--blue)" formatter={(v: number) => `${v}%`} />
        </Line>
        <Line type="monotone" dataKey="mcnPct" name="MCN %" stroke="var(--teal)" strokeWidth={2} dot={{ r: 3 }} connectNulls>
          <LabelList dataKey="mcnPct" position="bottom" fontSize={10} fontWeight={700} fill="var(--teal)" formatter={(v: number) => `${v}%`} />
        </Line>
        <Line type="monotone" dataKey="slaPct" name="SLA %" stroke="var(--orange)" strokeWidth={2} dot={{ r: 3 }} connectNulls>
          <LabelList dataKey="slaPct" position="top" offset={12} fontSize={10} fontWeight={700} fill="var(--orange)" formatter={(v: number) => `${v}%`} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Client escalation (CRE vs CRQ) line count per month-wise bucket, as two side-by-side bars
 *  so each trend reads on its own instead of hiding inside one combined total — Overview page's
 *  "Month-wise Client Escalation Trend" card (2026-09-17 feedback item #7; split into CRE/CRQ
 *  per 2026-09-18 feedback since the combined bar was masking which queue drove a spike). */
function EscalationCountChart({ points }: { points: EscalationTrendPoint[] }) {
  if (points.length === 0) {
    return <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={points} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted)" }} />
        <Bar dataKey="creCount" name="CRE" fill="var(--red)" radius={[4, 4, 0, 0]} maxBarSize={28}>
          <LabelList dataKey="creCount" position="top" fontSize={10} fill="var(--muted)" />
        </Bar>
        <Bar dataKey="crqCount" name="CRQ" fill="var(--teal)" radius={[4, 4, 0, 0]} maxBarSize={28}>
          <LabelList dataKey="crqCount" position="top" fontSize={10} fill="var(--muted)" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Single AHT line (seconds) over daily/weekly/monthly buckets — the Trends
 *  page's "DOC AHT Trend" card (2026-09-17 feedback). */
function AhtLineChart({ points }: { points: { bucket: string; avgAht: number | null }[] }) {
  if (points.length === 0) {
    return <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>;
  }
  const data = points.map((p) => ({ ...p, avgAht: p.avgAht ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: number) => `${v}s`} />
        <RTooltip content={<DarkTooltip />} />
        <Line type="monotone" dataKey="avgAht" name="Avg AHT" stroke="var(--teal)" strokeWidth={2} dot={{ r: 3 }} connectNulls>
          <LabelList dataKey="avgAht" position="top" fontSize={10} fontWeight={700} fill="var(--teal)" formatter={(v: number) => `${v}s`} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Quality scorecard bar chart — mirrors the reference's buildScorecardBar().
 * Bars are threshold-colored: green (< 1%), orange (1–1.5%), red (≥ 1.5%).
 * Each bar is one quality metric; the height is its error %.
 */
function barColor(v: number): string {
  if (v >= 1.5) return "var(--red)";
  if (v >= 1.0) return "var(--orange)";
  if (v > 0)    return "var(--green)";
  return "var(--muted)";
}

function ScorecardBarTooltip({ active, payload }: { active?: boolean; payload?: { payload: { name: string; value: number } }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8,
      padding: "8px 12px", fontSize: 12, color: "var(--text)", boxShadow: "var(--shadow)",
    }}>
      <div style={{ color: "var(--muted-strong)", fontWeight: 700, marginBottom: 2 }}>{d.name}</div>
      <div>Error: <strong style={{ color: barColor(d.value ?? 0) }}>{(d.value ?? 0).toFixed(3)}%</strong></div>
    </div>
  );
}

function ScorecardBarChart({ metrics, title, hc }: { metrics: { name: string; value: number | null }[]; title: string; hc?: string }) {
  const data = metrics.filter((m) => m.value !== null).map((m) => ({ name: m.name, value: m.value as number }));
  if (data.length === 0) {
    return <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>;
  }
  const maxVal = Math.max(...data.map((d) => d.value), 0);
  const xDomainMax = maxVal > 0 ? parseFloat((maxVal * 1.55).toFixed(2)) : 2;
  return (
    <div className="oc-card" style={{ "--hc": hc ?? "var(--red)" } as React.CSSProperties}>
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 44 + 60)}>
        <BarChart data={data} margin={{ top: 8, right: 64, left: 0, bottom: 32 }} layout="vertical">
          <CartesianGrid horizontal={false} stroke="rgba(42,58,82,0.18)" strokeDasharray="3 3" />
          <XAxis
            type="number" domain={[0, xDomainMax]}
            tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickFormatter={(v: number) => `${v.toFixed(2)}%`}
            label={{ value: "Error %", position: "insideBottom", offset: -20, fontSize: 11, fill: "var(--muted)" }}
          />
          <YAxis
            type="category" dataKey="name" width={160}
            tickLine={false} axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-strong)", fontWeight: 600 }}
          />
          <RTooltip content={<ScorecardBarTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={26}>
            {data.map((d, i) => (
              <Cell key={i} fill={barColor(d.value)} fillOpacity={0.85} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: number) => v > 0 ? `${v.toFixed(2)}%` : "–"}
              style={{ fontSize: 12, fontWeight: 700, fill: "var(--muted-strong)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4, fontSize: 11 }}>
        {[{ c: "var(--green)", l: "< 1% (Good)" }, { c: "var(--orange)", l: "1–1.5% (Warning)" }, { c: "var(--red)", l: "≥ 1.5% (Breach)" }].map(({ c, l }) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--muted)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c, flexShrink: 0 }} /> {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Green < 1.0%, orange 1.0-1.5%, red >= 1.5%, muted for zero/no data — the
 *  reference dashboard's own buildTrendTable() thresholds. */
function metricCellColor(pct: number | null): string {
  if (pct === null || pct === 0) return "var(--muted)";
  return pct >= 1.5 ? "var(--red)" : pct >= 1.0 ? "var(--orange)" : "var(--green)";
}

/** Metric-rows x time-bucket-columns table — mirrors the reference dashboard's
 *  buildTrendTable() (Quality page month/week/day-wise trend tables,
 *  2026-09-17 feedback). Each row is one metric so a reviewer reads a metric's
 *  trajectory across a whole row instead of hunting one card per bucket. */
function MetricTrendTable({ title, columns, rows, hc }: {
  title: string; columns: string[]; rows: { label: string; values: (number | null)[] }[]; hc?: string;
}) {
  return (
    <div className="oc-card" style={{ "--hc": hc ?? "var(--red)" } as React.CSSProperties}>
      <h3>{title}</h3>
      {columns.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left", minWidth: 160 }}>Metric</th>
                {columns.map((c) => <th key={c} className="oc-right">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ textAlign: "left", fontWeight: 600 }}>{r.label}</td>
                  {r.values.map((v, i) => (
                    <td key={columns[i]} className="oc-right" style={{ color: metricCellColor(v), fontWeight: 700 }}>
                      {v !== null ? `${v}%` : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Smooth filled area-line chart for the quality trend — mirrors the reference's
 * multi-series line chart with 20% fill, tension 0.35, point markers.
 */
function QualityAreaChart({ points, title, hc }: { points: { bucket: string; taskCount: number; errorRate: number | null }[]; title: string; hc?: string }) {
  if (points.length === 0) {
    return null;
  }
  const data = points.map((p) => ({ ...p, errorRate: p.errorRate ?? 0 }));
  return (
    <div className="oc-card" style={{ "--hc": hc ?? "var(--red)" } as React.CSSProperties}>
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="qAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--red)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--red)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
          <RTooltip content={<DarkTooltip />} />
          <Area
            type="monotone" dataKey="errorRate" name="Error Rate %"
            stroke="var(--red)" strokeWidth={2} fill="url(#qAreaGrad)"
            dot={{ r: 3, fill: "var(--red)", stroke: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 6 }}
          >
            <LabelList dataKey="errorRate" position="top" fontSize={10} fill="var(--red)"
              formatter={(v: number) => v > 0 ? `${v.toFixed(2)}%` : "–"} />
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Views whose backend query actually accepts a TL/AM filter — Trends (company-wide
 *  volume only), Alerts (per-analyst thresholds) and Analyst Performance (its own
 *  search box) don't take one, so the Executive Filters TL/AM dropdowns hide there
 *  rather than silently doing nothing when changed. */
const FILTERABLE_VIEWS = new Set<ViewKey>([
  "overview", "attrition", "quality", "etm", "taskskip", "escalations", "docraw", "poa", "poatrial", "clientdoc", "poaexternal",
]);

const VIEW_TABS: { key: ViewKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "analyst", label: "Analyst Performance", icon: Users2 },
  { key: "utilization", label: "Utilization", icon: Gauge },
  { key: "trends", label: "Trends", icon: TrendingUp },
  { key: "alerts", label: "Alerts", icon: AlertTriangle },
  { key: "attrition", label: "Attrition & Shrinkage", icon: TrendingDown },
  { key: "quality", label: "Quality", icon: ShieldAlert },
  { key: "etm", label: "ETM", icon: FileSearch },
  { key: "taskskip", label: "Task Skip", icon: SkipForward },
  { key: "escalations", label: "Client Escalations", icon: MessageSquareWarning },
  { key: "docraw", label: "DOC Raw", icon: Database },
  { key: "poa", label: "POA (Internal/External)", icon: FileText },
  { key: "poatrial", label: "POA Trial", icon: FlaskConical },
  { key: "clientdoc", label: "Client & Document Report", icon: FileBarChart2 },
  { key: "gdmcnsla", label: "GD MCN SLA APS", icon: Gauge },
  { key: "live", label: "Live", icon: Radio },
  { key: "namemapping", label: "Name Mapping (HR)", icon: UserCheck },
];

function TabBar({ view, onChange }: { view: ViewKey; onChange: (v: ViewKey) => void }) {
  return (
    <div className="oc-tabbar">
      {VIEW_TABS.map((t) => (
        <div
          key={t.key}
          className={t.key === view ? "oc-tab active" : "oc-tab"}
          onClick={() => onChange(t.key)}
          role="tab"
          aria-selected={t.key === view}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange(t.key); }}
        >
          <t.icon className="h-3.5 w-3.5" /> {t.label}
        </div>
      ))}
    </div>
  );
}

/**
 * Trends view — a single volume chart with a daily/weekly/monthly granularity
 * toggle, mirroring Central Dashboard's Trends tab. Real re-aggregation of the
 * same DOC/POA tables the Overview KPIs read, at the API's `/volume-trend` route.
 */
function TrendsView({ range }: { range: { from: string; to: string } }) {
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const query = useQuery({
    queryKey: ["onfido-process", "volume-trend", range, granularity],
    queryFn: () =>
      hrmsApi.get<{ data: VolumeTrendPoint[] }>(
        `/api/onfido-process/volume-trend?from=${range.from}&to=${range.to}&granularity=${granularity}`
      ),
  });
  const points = query.data?.data ?? [];

  // 2026-09-17 feedback: "TRENDS PAGE need all trends monthly weekly daily" — the
  // reference dashboard's Trends tab (rTrend()) renders 5 charts total; this port
  // has 4 (Tasks/AHT/Overall Err%/POA Err%) since FAR%/FRR% are excluded per
  // explicit instruction not to add FAR/FRR/Manual FAR/Manual FRR anywhere.
  const docAhtQuery = useQuery({
    queryKey: ["onfido-process", "doc-raw-trend", range, granularity],
    queryFn: () => hrmsApi.get<{ data: DocRawTrendPoint[] }>(`/api/onfido-process/doc-raw/trend?from=${range.from}&to=${range.to}&granularity=${granularity}`),
  });
  const overallErrQuery = useQuery({
    queryKey: ["onfido-process", "quality-trend", range, granularity],
    queryFn: () => hrmsApi.get<{ data: QualityTrendPoint[] }>(`/api/onfido-process/quality/trend?from=${range.from}&to=${range.to}&granularity=${granularity}`),
  });
  const poaErrQuery = useQuery({
    queryKey: ["onfido-process", "poa-quality-trend", range, granularity],
    queryFn: () => hrmsApi.get<{ data: QualityTrendPoint[] }>(`/api/onfido-process/poa/quality-trend?from=${range.from}&to=${range.to}&granularity=${granularity}`),
  });
  const docAhtPoints = docAhtQuery.data?.data ?? [];
  const overallErrPoints = overallErrQuery.data?.data ?? [];
  const poaErrPoints = poaErrQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Total Tasks Trend</h3>
          <div className="oc-pillbar">
            {(["daily", "weekly", "monthly"] as Granularity[]).map((g) => (
              <button key={g} className={g === granularity ? "oc-pill-btn active" : "oc-pill-btn"} onClick={() => setGranularity(g)}>
                {g[0].toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          {points.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No volume in this range yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4} barCategoryGap={points.length <= 3 ? "35%" : "20%"}>
                <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
                <Bar dataKey="doc" name="DOC" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  <LabelList dataKey="doc" position="inside" fill="#fff" fontSize={10} />
                </Bar>
                <Bar dataKey="poa" name="POA" fill="var(--teal)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  <LabelList dataKey="poa" position="inside" fill="#fff" fontSize={10} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        {points.length > 0 && <ChartLegendRow />}
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <h3>DOC AHT Trend</h3>
        <AhtLineChart points={docAhtPoints} />
      </div>
      <QualityAreaChart points={overallErrPoints} title="DOC Overall Error % Trend" hc="var(--red)" />
      <QualityAreaChart points={poaErrPoints} title="POA Error % Trend" hc="var(--purple)" />
    </div>
  );
}

/**
 * Alerts view — real computed threshold breaches (GET /alerts), not a fixed
 * placeholder sequence: every value here is COUNT/SUM arithmetic over the same
 * onfido_doc_external_audit_raw / onfido_poa_quality_raw tables the rest of
 * this dashboard reads.
 */
function AlertsView({ range }: { range: { from: string; to: string } }) {
  const query = useQuery({
    queryKey: ["onfido-process", "alerts", range],
    queryFn: () => hrmsApi.get<{ data: AlertRow[] }>(`/api/onfido-process/alerts?from=${range.from}&to=${range.to}`),
  });
  const alerts = query.data?.data ?? [];
  const high = alerts.filter((a) => a.severity === "high").length;
  const medium = alerts.filter((a) => a.severity === "medium").length;

  return (
    <div className="space-y-4">
      <div className="kr" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="kpi" style={{ "--kc": "var(--red)" } as React.CSSProperties}>
          <label>High Alerts</label>
          <div className="kv">{high}</div>
          <div className="ks">Value at least 1.5&times; over threshold</div>
        </div>
        <div className="kpi" style={{ "--kc": "var(--yellow)" } as React.CSSProperties}>
          <label>Medium Alerts</label>
          <div className="kv">{medium}</div>
          <div className="ks">Over threshold, under 1.5&times;</div>
        </div>
      </div>
      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <h3>Alert Details</h3>
        <div className="oc-card-sub">Analysts currently over a quality threshold for the selected range.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead>
              <tr><th>Analyst</th><th>TL</th><th>Metric</th><th className="oc-right">Value</th><th className="oc-right">Threshold</th><th className="oc-right">Severity</th></tr>
            </thead>
            <tbody>
              {alerts.length === 0 && <tr className="oc-empty-row"><td colSpan={6}>No alerts in this range</td></tr>}
              {alerts.slice(0, 200).map((a, i) => (
                <tr key={`${a.analystEmail}-${a.metric}-${i}`}>
                  <td>{a.analystEmail}</td>
                  <td>{a.tlName ?? "-"}</td>
                  <td>{a.metric}</td>
                  <td className="oc-right">{a.value}%</td>
                  <td className="oc-right" style={{ color: "var(--muted)" }}>{a.threshold}%</td>
                  <td className="oc-right">
                    <span className={a.severity === "high" ? "oc-badge-pill oc-severity-high" : "oc-badge-pill oc-severity-medium"}>
                      {a.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {alerts.length > 200 && <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>Showing first 200 of {alerts.length}</div>}
      </div>
    </div>
  );
}

/**
 * Analyst Performance view — search box + full profile (KPIs, month trend,
 * peer ranking within the same TL), all from GET /analyst-performance/:email.
 */
function AnalystPerformanceView({ range }: { range: { from: string; to: string } }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [showSuggest, setShowSuggest] = useState(false);

  const searchQuery = useQuery({
    queryKey: ["onfido-process", "analyst-search", query],
    queryFn: () => hrmsApi.get<{ data: AnalystSearchHit[] }>(`/api/onfido-process/analyst-search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2,
  });

  const perfQuery = useQuery({
    queryKey: ["onfido-process", "analyst-performance", selected, range],
    queryFn: () =>
      hrmsApi.get<{ data: AnalystPerformance }>(
        `/api/onfido-process/analyst-performance/${encodeURIComponent(selected!)}?from=${range.from}&to=${range.to}`
      ),
    enabled: !!selected,
  });

  const rankingQuery = useQuery({
    queryKey: ["onfido-process", "analyst-ranking", range],
    queryFn: () => hrmsApi.get<{ data: AnalystRankingRow[] }>(`/api/onfido-process/analyst-ranking?from=${range.from}&to=${range.to}`),
  });

  const suggestions = searchQuery.data?.data ?? [];
  const perf = perfQuery.data?.data;
  const rankedPeers = perf ? [...perf.peers].sort((a, b) => b.tasks - a.tasks) : [];
  const rank = perf ? rankedPeers.findIndex((p) => p.email.toLowerCase() === perf.email.toLowerCase()) + 1 : 0;
  const rankingRows = rankingQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="oc-filterbar">
        <div className="oc-eyebrow"><Search className="h-3.5 w-3.5" /> Analyst Performance</div>
        <div className="oc-search-wrap">
          <input
            type="text"
            className="oc-input"
            style={{ width: "100%" }}
            placeholder="Search by analyst email…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
          />
          {showSuggest && suggestions.length > 0 && (
            <div className="oc-suggest">
              {suggestions.map((s) => (
                <div key={`${s.email}-${s.tlName}`} className="oc-suggest-item" onMouseDown={() => { setSelected(s.email); setQuery(s.email); }}>
                  <span>{s.email}</span>
                  <span style={{ color: "var(--muted)" }}>{s.tlName} · {s.taskCount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Default ranking table — always visible; shows top 50 analysts by DOC task volume */}
      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <h3>Analyst Leaderboard — Top 50 by DOC Tasks</h3>
        <div className="oc-card-sub">Ranked by DOC task count. Click a row to load that analyst's full profile above.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>Rank</th><th>Analyst</th><th>TL</th><th>AM</th><th className="oc-right">DOC Tasks</th><th className="oc-right">Avg AHT</th><th className="oc-right">Error Rate</th><th className="oc-right">POA Tasks</th></tr></thead>
            <tbody>
              {rankingRows.length === 0 && <tr className="oc-empty-row"><td colSpan={8}>{rankingQuery.isLoading ? "Loading…" : "No data in this range"}</td></tr>}
              {rankingRows.map((r, i) => (
                <tr key={r.email} className="oc-row-click"
                  style={r.email.toLowerCase() === selected?.toLowerCase() ? { background: "rgba(47,109,246,0.08)", fontWeight: 700 } : undefined}
                  onClick={() => { setSelected(r.email); setQuery(r.email); }}>
                  <td style={{ color: "var(--muted)", fontWeight: 700 }}>{i + 1}</td>
                  <td>{r.email}</td>
                  <td>{r.tlName ?? "—"}</td>
                  <td>{r.amName ?? "—"}</td>
                  <td className="oc-right">{r.tasks.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.avgAht !== null ? `${r.avgAht}s` : "—"}</td>
                  <td className="oc-right" style={{ color: r.errorRate !== null && r.errorRate > 2 ? "var(--red)" : r.errorRate !== null && r.errorRate < 1 ? "var(--good)" : undefined }}>
                    {r.errorRate !== null ? `${r.errorRate}%` : "—"}
                  </td>
                  <td className="oc-right">{r.poaTasks > 0 ? r.poaTasks.toLocaleString("en-IN") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!selected && (
        <div className="oc-card" style={{ textAlign: "center", padding: "20px 0", color: "var(--muted)", fontSize: 13 }}>
          Click a row above or search by email to see a full analyst profile.
        </div>
      )}

      {selected && perfQuery.isLoading && (
        <div className="oc-card" style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 13 }}>Loading…</div>
      )}

      {selected && perfQuery.isError && (
        <div className="oc-card" style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 13 }}>
          No records for this analyst in the selected range.
        </div>
      )}

      {perf && (
        <>
          <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="oc-avatar" style={{ background: avatarTone(perf.email), width: 36, height: 36, fontSize: 13 }}>
                {initials(perf.email.split("@")[0])}
              </span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{perf.email}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  TL: {perf.tlName ?? "-"} · AM: {perf.amName ?? "-"} · QA: {perf.qaName ?? "-"}
                </div>
              </div>
              {rank > 0 && (
                <span className="oc-badge" style={{ marginLeft: "auto" }}>Rank {rank} of {rankedPeers.length} in TL team</span>
              )}
            </div>
          </div>

          <div className="kr">
            <KpiPlain kpi={perf.totalTasks} kc="var(--blue)" />
            <KpiPlain kpi={perf.avgManualProcessingTime} kc="var(--purple)" />
            <KpiPlain kpi={perf.overallErrorRate} kc="var(--red)" />
          </div>
          <div className="kr" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <KpiPlain kpi={perf.poaTasks} kc="var(--teal)" />
            <KpiPlain kpi={perf.poaAvgAht} kc="var(--teal)" />
            <KpiPlain kpi={perf.poaErrorRate} kc="var(--teal)" />
          </div>

          <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
            <h3>Month-Wise Performance</h3>
            {perf.monthly.length === 0 ? (
              <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No monthly data in range.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={perf.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                  <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                  <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
                  <Bar dataKey="tasks" name="Tasks" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    <LabelList dataKey="tasks" position="top" fontSize={10} fill="var(--muted)" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
            <h3>Peer Ranking (Same TL)</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="oc-table">
                <thead><tr><th>Rank</th><th>Analyst</th><th className="oc-right">Tasks</th><th className="oc-right">Error Rate</th></tr></thead>
                <tbody>
                  {rankedPeers.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>No peers found</td></tr>}
                  {rankedPeers.slice(0, 30).map((p, i) => (
                    <tr key={p.email} className={p.email.toLowerCase() === perf.email.toLowerCase() ? "oc-row-self" : ""}>
                      <td><span className="oc-rank-badge">{i + 1}</span></td>
                      <td>{p.email}</td>
                      <td className="oc-right">{p.tasks}</td>
                      <td className="oc-right">{p.errorRate !== null ? `${p.errorRate}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiPlain({ kpi, kc }: { kpi: KpiValue; kc: string }) {
  const empty = kpi.availability === "no_data" || kpi.value === null;
  return (
    <div className="kpi" style={{ "--kc": kc } as React.CSSProperties}>
      <label>{kpi.label}</label>
      <div className={empty ? "kv empty" : "kv"}>{formatValue(kpi)}</div>
      <div className="ks">{empty ? "No data in this range" : kpi.note ?? " "}</div>
    </div>
  );
}

/** A single-choice pill row, used by every breakdown selector below. */
/**
 * Generic drill-down for a breakdown-table row (Attrition/ETM/Task Skip by
 * TL/AM/AON/Location/etc.) — per the Drill-Down Mandate, every grid on this
 * platform gets a clickable row, no exceptions. Reuses the raw-data table
 * picker's own generic filterColumn/filterValue query param, so no new
 * per-table backend endpoint was needed — level 2 here is the record list,
 * level 3 (click a row) reuses the existing RecordDrawer.
 */
function BreakdownDrilldownSheet({
  open, title, tableKey, filterColumn, filterValue, range, onOpenChange, onOpenRecord,
}: {
  open: boolean; title: string; tableKey: string; filterColumn: string; filterValue: string;
  range: { from: string; to: string };
  onOpenChange: (v: boolean) => void; onOpenRecord: (record: RawRecord, table: string) => void;
}) {
  const recordsQuery = useQuery({
    queryKey: ["onfido-process", "breakdown-records", tableKey, filterColumn, filterValue, range],
    queryFn: () =>
      hrmsApi.get<{ data: { table: string; rows: RawRecord[]; total: number } }>(
        `/api/onfido-process/records/${tableKey}?from=${range.from}&to=${range.to}&filterColumn=${filterColumn}&filterValue=${encodeURIComponent(filterValue)}&limit=100`
      ),
    enabled: open,
  });
  const records = recordsQuery.data?.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 !text-[color:var(--text)]">
            <Layers3 className="h-4 w-4" style={{ color: "var(--muted)" }} /> {title}
          </SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">{filterValue}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <p className="mb-2" style={{ fontSize: 11, color: "var(--muted)" }}>Click a record for its full detail.</p>
          <table className="oc-table">
            <thead><tr><th>Date</th><th>Who</th><th>Detail</th></tr></thead>
            <tbody>
              {(records?.rows ?? []).length === 0 && (
                <tr className="oc-empty-row"><td colSpan={3}>{recordsQuery.isLoading ? "Loading…" : "No records"}</td></tr>
              )}
              {(records?.rows ?? []).map((r) => {
                const row = r as Record<string, unknown>;
                const date = row.work_date ?? row.skip_date ?? row.report_date ?? row.report_completed_date ?? row.task_complete_date;
                const who = row.emp_name ?? row.analyst_name ?? row.analyst_email ?? row.escalated_by_email ?? "-";
                const detail = row.attrition_reason ?? row.overall_result ?? row.ims_client_name ?? row.task_type ?? row.document_type ?? "-";
                return (
                  <tr key={r.id} className="oc-row-click" onClick={() => onOpenRecord(r, records!.table)}>
                    <td style={{ fontSize: 11 }}>{formatDateTime(date)}</td>
                    <td style={{ fontSize: 11 }}>{String(who)}</td>
                    <td style={{ fontSize: 11 }}>{String(detail)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {records && (
            <div className="mt-2" style={{ fontSize: 11, color: "var(--muted)" }}>
              Showing {records.rows.length} of {records.total.toLocaleString("en-IN")}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Two separate inference traps, both worth spelling out since the fix for each looks redundant
 * on its own:
 *
 * `options` is typed with a plain `string` key rather than `{ key: T }[]` — every call site
 * passes an options array literal without `as const`, so a `T`-typed key would widen inference to
 * plain `string` (the literal `"daily"` etc. has no narrower type to offer). The cast in the
 * click handler below is safe because the option keys a caller supplies are always members of T
 * by construction (they're this pill group's own state values).
 *
 * `onChange` uses `NoInfer<T>` because every call site passes a raw `useState` setter
 * (`Dispatch<SetStateAction<Granularity>>`), and contravariant inference from that parameter's
 * union type (`Granularity | ((prev: Granularity) => Granularity)`) pulled T back to its `string`
 * constraint even with `options` fixed above — confirmed by isolating the two changes. `NoInfer`
 * forces T to be inferred from `value` alone, which already carries the real narrow union.
 */
function PillGroup<T extends string>({ options, value, onChange }: { options: { key: string; label: string }[]; value: T; onChange: (v: NoInfer<T>) => void }) {
  return (
    <div className="oc-pillbar">
      {options.map((o) => (
        <button key={o.key} className={o.key === value ? "oc-pill-btn active" : "oc-pill-btn"} onClick={() => onChange(o.key as T)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Attrition & Shrinkage view — real per-employee-per-day data from
 * onfido_agent_daily_raw (the ETM/Attrition workbook's "Agent Wise" sheet).
 * Attrition%/Shrinkage% are inherently monthly ratios (see the backend's own
 * comment on getAttritionOverview), so the KPI tiles always resolve to the
 * most recent month with data in the selected range — never a blended
 * multi-month rate — and every tile's note says which month that is.
 */
/** Shared TL/AM query-string suffix — every filterable view's endpoints accept
 *  the same two optional params, appended the same way. */
function tlAmQS(tlFilter: string, amFilter: string): string {
  return (tlFilter ? `&tlName=${encodeURIComponent(tlFilter)}` : "") + (amFilter ? `&amName=${encodeURIComponent(amFilter)}` : "");
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

// ── Attrition & Shrinkage — laid out and formatted to match the business's own
//    reference dashboard ("attrition correction file", 2026-09-15). ─────────────

/** The reference dashboard's chart palette, taken from its own COLORS object. */
const AC = {
  navy: "#0b4f8a", blue: "#1769aa", teal: "#008c95", green: "#2e7d32", orange: "#e47d22",
  purple: "#7656a6", pink: "#bd4f7a", yellow: "#b78300", red: "#c0392b",
  text: "#0b2540", muted: "#486581", axis: "#c9d7e3", groupBg: "#deebf7",
};
const AON_ORDER = ["0 to 30", "31 to 60", "61 to 90", "Above 90"];
const AON_COLORS: Record<string, string> = { "0 to 30": AC.teal, "31 to 60": AC.blue, "61 to 90": AC.orange, "Above 90": AC.purple };

/** Rounds an axis maximum up to 1, 2, 5 or 10 × a power of ten, as the reference does. */
function niceMax(value: number, minimum: number): number {
  const v = Math.max(Number(value) || 0, minimum || 1);
  const power = Math.pow(10, Math.floor(Math.log10(v)));
  const s = v / power;
  return (s <= 1 ? 1 : s <= 2 ? 2 : s <= 5 ? 5 : 10) * power;
}
/** Whole numbers without decimals, everything else to two places — "26", "15.89". */
const fx2 = (v: number) => (Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : v.toFixed(2));
const fmtNum = (v: number) => Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${fx2(Number(v))}%`);
/** "2026-01" → "Jan-26". */
function monLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" })}-${String(y).slice(2)}`;
}
/** The reference's conditional formatting: any rate above zero is flagged red, exactly zero green. */
const pctStyle = (v: number | null | undefined): React.CSSProperties =>
  v === null || v === undefined ? { color: AC.muted } : { color: Number(v) > 0 ? "#c0392b" : "#217a39", fontWeight: 900 };

/** Five even intervals from zero, as the reference's axes use (0/10/…/50). */
const axisTicks = (max: number) => [0, 1, 2, 3, 4, 5].map((i) => Math.round((max * i) / 5 * 100) / 100);

const LABEL_ABOVE = -14;
const LABEL_MIN_GAP = 19;

/** Zero gets no label, as in the reference: a zero bar or a line on the axis
 *  needs none, and a row of "0" badges along the baseline buries the real ones. */
const hasLabel = (v: unknown) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v)) && Number(v) !== 0;

/**
 * Keeps the data labels of several series apart where they share an x position
 * — a port of the reference's buildSeparatedYPositions. Every label starts just
 * above its point; any that would sit closer than LABEL_MIN_GAP px to the one
 * above it is pushed down. Each series may use its own axis maximum (a combo
 * chart's bars and lines do). Returns, per series key, a vertical offset for
 * each data index, applied relative to the point's real rendered position.
 */
function separateLabels(
  data: Record<string, unknown>[], series: { key: string; max: number }[], plotHeight: number,
): Record<string, number[]> {
  const out: Record<string, number[]> = Object.fromEntries(series.map((s) => [s.key, data.map(() => LABEL_ABOVE)]));
  data.forEach((row, i) => {
    const items = series
      .filter((s) => hasLabel(row[s.key]))
      .map((s) => {
        const py = plotHeight * (1 - Math.min(Number(row[s.key]), s.max) / (s.max || 1));
        return { key: s.key, py, target: py + LABEL_ABOVE };
      })
      .sort((a, b) => a.target - b.target);
    for (let j = 1; j < items.length; j++) {
      if (items[j].target - items[j - 1].target < LABEL_MIN_GAP) items[j].target = items[j - 1].target + LABEL_MIN_GAP;
    }
    for (const it of items) out[it.key][i] = it.target - it.py;
  });
  return out;
}

/** Rounded badge data label, as the reference draws them. `dy` is either one
 *  offset for every point or a per-index array from separateLabels(). */
function pillLabel(color: string, suffix: string, dy: number | number[]) {
  return (props: { x?: number | string; y?: number | string; width?: number | string; value?: number | string | null; index?: number }) => {
    const { x, y, width, value, index } = props;
    if (!hasLabel(value)) return null;
    const cx = Number(x) + (Number(width) || 0) / 2;
    const text = `${fx2(Number(value))}${suffix}`;
    const w = text.length * 5.8 + 12;
    const offset = Array.isArray(dy) ? (dy[index ?? 0] ?? LABEL_ABOVE) : dy;
    const cy = Number(y) + offset;
    return (
      <g pointerEvents="none">
        <rect x={cx - w / 2} y={cy - 8} width={w} height={16} rx={5} fill="#fff" stroke={color} strokeWidth={1.2} />
        <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fontWeight={800} fill={color}>{text}</text>
      </g>
    );
  };
}

/** Tooltip for the attrition charts: adds the % suffix to rate series and skips
 *  points with no value (the shared DarkTooltip would throw on a null). */
function AttrTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number | null; color: string; dataKey?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  if (!rows.length) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${AC.axis}`, borderRadius: 10, padding: "8px 10px", fontSize: 12, color: AC.text, boxShadow: "0 8px 24px rgba(11,79,138,.12)" }}>
      <div style={{ color: AC.muted, marginBottom: 4, fontWeight: 700 }}>{label}</div>
      {rows.map((p) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
          <span style={{ color: AC.muted }}>{p.name}:</span>
          <strong>{/%$/.test(p.name) ? fmtPct(Number(p.value)) : fmtNum(Number(p.value))}</strong>
        </div>
      ))}
    </div>
  );
}

function AttrKpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="oc-card" style={{ padding: "12px 14px", borderRadius: 14, borderBottom: `3px solid ${accent}` }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", color: AC.text }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: AC.text, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: AC.muted, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function AttrSection({ title, color, right, sub, children }: {
  title: string; color: string; right?: React.ReactNode; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="oc-card" style={{ "--hc": color, borderTop: `3px solid ${color}` } as React.CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 style={{ marginBottom: 0 }}>{title}</h3>
        {right}
      </div>
      {sub && <div className="oc-card-sub" style={{ margin: "6px 0 0" }}>{sub}</div>}
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function AttrEmpty({ loading, message }: { loading?: boolean; message: string }) {
  return <div style={{ padding: "28px 0", textAlign: "center", fontSize: 13, color: AC.muted }}>{loading ? "Loading…" : message}</div>;
}

const LEGEND_STYLE: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: AC.text };
const AXIS_TICK = { fontSize: 11, fontWeight: 700, fill: AC.text };

/** Bars for attrition count (right axis) with Attrition % and UL Shrinkage %
 *  lines (left axis) — the reference's month-wise and AM/AON/TL combo charts. */
function AttrComboChart({ data, barColor, height = 300, rotateLabels = false }: {
  data: { label: string; count: number; attrPct: number | null; ulPct: number | null }[];
  barColor: string; height?: number; rotateLabels?: boolean;
}) {
  const pctMax = niceMax(Math.max(0, ...data.map((d) => Math.max(d.attrPct ?? 0, d.ulPct ?? 0))), 10);
  const countMax = niceMax(Math.max(0, ...data.map((d) => d.count)), 5);
  const bottom = rotateLabels ? 56 : 4;
  // Plot height ≈ chart height less the top margin, legend row, bottom margin and x-axis band.
  const offsets = separateLabels(
    data,
    [{ key: "count", max: countMax }, { key: "attrPct", max: pctMax }, { key: "ulPct", max: pctMax }],
    height - 30 - 28 - bottom - 30,
  );
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 30, right: 8, left: 0, bottom }}>
        <XAxis
          dataKey="label" tickLine={false} axisLine={{ stroke: AC.axis }} interval={0}
          angle={rotateLabels ? -35 : 0} textAnchor={rotateLabels ? "end" : "middle"}
          tick={rotateLabels ? { ...AXIS_TICK, fontSize: 10 } : AXIS_TICK}
        />
        <YAxis yAxisId="pct" domain={[0, pctMax]} ticks={axisTicks(pctMax)} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}%`} tick={{ ...AXIS_TICK, fontSize: 10 }} />
        <YAxis yAxisId="count" orientation="right" domain={[0, countMax]} ticks={axisTicks(countMax)} allowDecimals={false} tickLine={false} axisLine={false} width={36} tick={{ ...AXIS_TICK, fontSize: 10, fill: AC.blue }} />
        <RTooltip content={<AttrTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
        <Legend verticalAlign="top" align="left" height={28} iconType="square" wrapperStyle={LEGEND_STYLE} />
        <Bar yAxisId="count" dataKey="count" name="Attrition Count" fill={barColor} maxBarSize={44}>
          <LabelList dataKey="count" content={pillLabel(barColor, "", offsets.count)} />
        </Bar>
        <Line yAxisId="pct" type="monotone" dataKey="attrPct" name="Attrition %" stroke={AC.red} strokeWidth={1.9} dot={false} connectNulls>
          <LabelList dataKey="attrPct" content={pillLabel(AC.red, "%", offsets.attrPct)} />
        </Line>
        <Line yAxisId="pct" type="monotone" dataKey="ulPct" name="UL Shrinkage %" stroke={AC.orange} strokeWidth={1.9} dot={false} connectNulls>
          <LabelList dataKey="ulPct" content={pillLabel(AC.orange, "%", offsets.ulPct)} />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Several smooth lines with badge labels — the AON month-wise and the
 *  Voluntary vs Involuntary charts. */
function AttrLineChart({ data, series, suffix, minMax, height = 300 }: {
  data: Record<string, string | number | null>[];
  series: { key: string; name: string; color: string }[];
  suffix: string; minMax: number; height?: number;
}) {
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0)))), minMax);
  const offsets = separateLabels(data, series.map((s) => ({ key: s.key, max })), height - 30 - 28 - 4 - 30);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 30, right: 18, left: 0, bottom: 4 }}>
        {/* Padding keeps the first and last points' labels clear of the axis and the card edge. */}
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: AC.axis }} interval={0} tick={AXIS_TICK} padding={{ left: 36, right: 36 }} />
        <YAxis domain={[0, max]} ticks={axisTicks(max)} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${v}${suffix}`} tick={{ ...AXIS_TICK, fontSize: 10 }} />
        <RTooltip content={<AttrTooltip />} />
        <Legend verticalAlign="top" align="left" height={28} iconType="square" wrapperStyle={LEGEND_STYLE} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} connectNulls>
            <LabelList dataKey={s.key} content={pillLabel(s.color, suffix, offsets[s.key])} />
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

interface AttrTableRow {
  key: string; month: string; label?: string; rawLabel?: string;
  openingHc: number; closingHc: number; avgHc: number;
  attritionCount: number; attritionRate: number | null;
  scheduled: number; unplannedLeave: number; actualUl: number;
  ulShrinkageRate: number | null; actualShrinkageRate: number | null;
}

/** The reference's detail table (Month / AM / TL / AON wise), with its
 *  conditional formatting on the three rate columns. */
function AttrDetailTable({ rows, labelHeader, loading, onRowClick, maxHeight }: {
  rows: AttrTableRow[]; labelHeader?: string; loading?: boolean;
  onRowClick?: (r: AttrTableRow) => void; maxHeight?: number;
}) {
  const colSpan = labelHeader ? 12 : 11;
  return (
    <div style={{ overflowX: "auto", maxHeight, overflowY: maxHeight ? "auto" : undefined }}>
      <table className="oc-table">
        <thead>
          <tr>
            <th>Month</th>
            {labelHeader && <th>{labelHeader}</th>}
            <th className="oc-right">Opening HC</th><th className="oc-right">Closing HC</th><th className="oc-right">Avg HC</th>
            <th className="oc-right">Attrition</th><th className="oc-right">Attrition %</th><th className="oc-right">Scheduled</th>
            <th className="oc-right">UL</th><th className="oc-right">Actual UL</th>
            <th className="oc-right">UL Shrinkage</th><th className="oc-right">Actual Shrinkage</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr className="oc-empty-row"><td colSpan={colSpan}>{loading ? "Loading…" : "No data"}</td></tr>}
          {rows.map((r) => (
            <tr key={r.key} className={onRowClick ? "oc-row-click" : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              <td>{monLabel(r.month)}</td>
              {labelHeader && <td style={{ fontWeight: 700 }}>{r.label}</td>}
              <td className="oc-right">{fmtNum(r.openingHc)}</td>
              <td className="oc-right">{fmtNum(r.closingHc)}</td>
              <td className="oc-right">{fx2(r.avgHc)}</td>
              <td className="oc-right">{fmtNum(r.attritionCount)}</td>
              <td className="oc-right" style={pctStyle(r.attritionRate)}>{fmtPct(r.attritionRate)}</td>
              <td className="oc-right">{fmtNum(r.scheduled)}</td>
              <td className="oc-right">{fmtNum(r.unplannedLeave)}</td>
              <td className="oc-right">{fmtNum(r.actualUl)}</td>
              <td className="oc-right" style={pctStyle(r.ulShrinkageRate)}>{fmtPct(r.ulShrinkageRate)}</td>
              <td className="oc-right" style={pctStyle(r.actualShrinkageRate)}>{fmtPct(r.actualShrinkageRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Month-on-month reason-wise attrition count, grouped Voluntary / Involuntary. */
function AttrReasonTable({ data, loading }: { data: AttritionReasonMonthly | undefined; loading: boolean }) {
  if (!data || data.months.length === 0) return <AttrEmpty loading={loading} message="No exits in this range." />;
  const groupRow: React.CSSProperties = { background: AC.groupBg, color: AC.navy, fontWeight: 900 };
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="oc-table">
        <thead>
          <tr>
            <th>Reason</th>
            {data.months.map((m) => <th key={m} className="oc-right">{monLabel(m)}</th>)}
            <th className="oc-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g) => [
            <tr key={`${g.type}-total`} style={groupRow}>
              <td style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>{g.type} Total</td>
              {g.totals.map((n, i) => <td key={i} className="oc-right">{fmtNum(n)}</td>)}
              <td className="oc-right">{fmtNum(g.total)}</td>
            </tr>,
            ...g.reasons.map((r) => (
              <tr key={`${g.type}-${r.reason}`}>
                <td style={{ paddingLeft: 26, fontWeight: 700 }}>{r.reason}</td>
                {r.counts.map((n, i) => <td key={i} className="oc-right">{fmtNum(n)}</td>)}
                <td className="oc-right" style={{ fontWeight: 800 }}>{fmtNum(r.total)}</td>
              </tr>
            )),
          ])}
          <tr style={{ fontWeight: 900, background: AC.groupBg }}>
            <td style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>Grand Total</td>
            {data.grandTotals.map((n, i) => <td key={i} className="oc-right">{fmtNum(n)}</td>)}
            <td className="oc-right">{fmtNum(data.grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const breakdownToRows = (rows: AttritionBreakdownRow[]): AttrTableRow[] =>
  rows.map((r) => ({ ...r, key: `${r.month}-${r.label}` }));
const breakdownToCombo = (rows: AttritionBreakdownRow[]) =>
  rows.map((r) => ({ label: r.label, count: r.attritionCount, attrPct: r.attritionRate, ulPct: r.ulShrinkageRate }));

function AttritionView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ dimension: AttritionDimension; label: string; rawLabel: string; month: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);
  const url = (path: string) => `/api/onfido-process/attrition/${path}?from=${range.from}&to=${range.to}${qs}`;
  const key = (k: string) => ["onfido-process", `attrition-${k}`, range, tlFilter, amFilter];

  const overviewQuery = useQuery({ queryKey: key("overview"), queryFn: () => hrmsApi.get<{ data: AttritionOverview }>(url("overview")) });
  const monthlyQuery = useQuery({ queryKey: key("monthly"), queryFn: () => hrmsApi.get<{ data: AttritionMonthRow[] }>(url("monthly-detail")) });
  const trendQuery = useQuery({
    queryKey: [...key("trend"), granularity],
    queryFn: () => hrmsApi.get<{ data: AttritionTrendPoint[] }>(`${url("trend")}&granularity=${granularity}`),
    enabled: granularity !== "monthly",
  });
  const aonMonthlyQuery = useQuery({ queryKey: key("aon-monthly"), queryFn: () => hrmsApi.get<{ data: AttritionAonMonthRow[] }>(url("aon-monthly")) });
  const reasonQuery = useQuery({ queryKey: key("reason-monthly"), queryFn: () => hrmsApi.get<{ data: AttritionReasonMonthly }>(url("reason-monthly")) });
  const dimQuery = (dim: AttritionDimension) => ({
    queryKey: [...key("breakdown"), dim],
    queryFn: () => hrmsApi.get<{ data: AttritionBreakdownRow[] }>(url(`breakdown/${dim}`)),
  });
  const amQuery = useQuery(dimQuery("am_name"));
  const aonQuery = useQuery(dimQuery("aon_bucket"));
  const tlQuery = useQuery(dimQuery("tl_name"));
  const locationQuery = useQuery(dimQuery("location"));
  const exitsQuery = useQuery({ queryKey: key("exits"), queryFn: () => hrmsApi.get<{ data: AttritionExitRow[] }>(url("exits")) });

  const ov = overviewQuery.data?.data;
  const months = monthlyQuery.data?.data ?? [];
  const trendPoints = trendQuery.data?.data ?? [];
  const aonMonthly = aonMonthlyQuery.data?.data ?? [];
  const reasons = reasonQuery.data?.data;
  const am = amQuery.data?.data ?? [];
  const aon = aonQuery.data?.data ?? [];
  const tl = tlQuery.data?.data ?? [];
  const location = locationQuery.data?.data ?? [];
  const exits = exitsQuery.data?.data ?? [];

  const cur = ov?.month ? monLabel(ov.month) : "";
  const kv = (k: KpiValue | undefined) => k?.value ?? null;
  const openDrill = (dimension: AttritionDimension) => (r: AttrTableRow) =>
    setDrilldown({ dimension, label: r.label ?? "", rawLabel: r.rawLabel ?? r.label ?? "", month: r.month });

  const monthCombo = months.map((m) => ({ label: monLabel(m.month), count: m.attritionCount, attrPct: m.attritionRate, ulPct: m.ulShrinkageRate }));
  const aonSeriesPresent = AON_ORDER.filter((l) => aonMonthly.some((m) => m.buckets[l] !== null && m.buckets[l] !== undefined));
  const aonLineData = aonMonthly.map((m) => ({ label: monLabel(m.month), ...Object.fromEntries(AON_ORDER.map((l) => [l, m.buckets[l] ?? null])) }));
  const vol = reasons?.groups.find((g) => g.type === "Voluntary");
  const inv = reasons?.groups.find((g) => g.type === "Involuntary");
  const typeLineData = (reasons?.months ?? []).map((m, i) => ({ label: monLabel(m), voluntary: vol?.totals[i] ?? 0, involuntary: inv?.totals[i] ?? 0 }));
  const dimLabel = (d: AttritionDimension) => (d === "tl_name" ? "TL" : d === "am_name" ? "AM" : d === "aon_bucket" ? "AON" : "Location");

  return (
    <div className="space-y-4">
      {/* 1 · Current-month status */}
      <div className="kr k6">
        <AttrKpi label="Attrition Count" value={kv(ov?.attritionCount) === null ? "—" : fmtNum(kv(ov?.attritionCount)!)} sub={`${cur || "Latest month"} · Onfloor`} accent={AC.orange} />
        <AttrKpi label="Attrition %" value={fmtPct(kv(ov?.attritionRate))} sub="Attrition ÷ ((Opening HC + Closing HC) ÷ 2)" accent={(kv(ov?.attritionRate) ?? 0) > 0 ? AC.red : AC.green} />
        <AttrKpi label="Opening HC" value={kv(ov?.openingHc) === null ? "—" : fmtNum(kv(ov?.openingHc)!)} sub="First available day HC" accent={AC.blue} />
        <AttrKpi label="Closing HC" value={kv(ov?.closingHc) === null ? "—" : fmtNum(kv(ov?.closingHc)!)} sub="Last available day HC" accent={AC.teal} />
        <AttrKpi label="UL Shrinkage" value={fmtPct(kv(ov?.ulShrinkageRate))} sub="UL ÷ Scheduled" accent={AC.purple} />
        <AttrKpi label="Actual Shrinkage" value={fmtPct(kv(ov?.actualShrinkageRate))} sub="Actual UL ÷ Scheduled" accent={AC.pink} />
      </div>
      {ov?.month && (
        <div style={{ fontSize: 11, color: AC.muted }}>
          Current month is the latest month with data in the selected range: <strong style={{ color: AC.text }}>{cur}</strong>.
        </div>
      )}

      {/* 2 · Month-wise count, Attrition %, UL Shrinkage % */}
      <AttrSection
        title={granularity === "monthly" ? "Month Wise · Attrition Count · Attrition % · UL Shrinkage %" : `${granularity === "daily" ? "Day" : "Week"} Wise · Attrition Count`}
        color={AC.orange}
        right={<PillGroup value={granularity} onChange={setGranularity} options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]} />}
        sub={granularity === "monthly" ? undefined : "Daily and weekly show the exit count only — an attrition % needs a whole month's opening and closing headcount."}
      >
        {granularity === "monthly"
          ? (monthCombo.length === 0 ? <AttrEmpty loading={monthlyQuery.isLoading} message="No month-wise data in this range." /> : <AttrComboChart data={monthCombo} barColor={AC.blue} height={320} />)
          : (trendPoints.length === 0
            ? <AttrEmpty loading={trendQuery.isLoading} message="No exits in this range." />
            : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={trendPoints} margin={{ top: 30, right: 8, left: 0, bottom: 4 }}>
                  <XAxis dataKey="bucket" tickLine={false} axisLine={{ stroke: AC.axis }} tick={{ ...AXIS_TICK, fontSize: 10 }} />
                  <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} domain={[0, niceMax(Math.max(0, ...trendPoints.map((p) => p.attritionCount)), 5)]} tick={{ ...AXIS_TICK, fontSize: 10 }} />
                  <RTooltip content={<AttrTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
                  <Bar dataKey="attritionCount" name="Attrition Count" fill={AC.blue} maxBarSize={40}>
                    <LabelList dataKey="attritionCount" content={pillLabel(AC.blue, "", -12)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ))}
      </AttrSection>

      {/* 3 · AON month-wise Attrition % */}
      <AttrSection title="AON Month Wise · Attrition %" color={AC.yellow}>
        {aonLineData.length === 0
          ? <AttrEmpty loading={aonMonthlyQuery.isLoading} message="No AON data in this range." />
          : <AttrLineChart data={aonLineData} suffix="%" minMax={10} series={aonSeriesPresent.map((l) => ({ key: l, name: l, color: AON_COLORS[l] }))} />}
      </AttrSection>

      {/* 4 · Month-on-month Voluntary vs Involuntary */}
      <AttrSection title="Month-on-Month · Voluntary vs Involuntary Attrition" color={AC.green}>
        {typeLineData.length === 0
          ? <AttrEmpty loading={reasonQuery.isLoading} message="No exits in this range." />
          : <AttrLineChart data={typeLineData} suffix="" minMax={10} series={[{ key: "voluntary", name: "Voluntary", color: AC.green }, { key: "involuntary", name: "Involuntary", color: AC.red }]} />}
      </AttrSection>

      {/* 5 · Month-on-month reason-wise count */}
      <AttrSection title="Month-on-Month · Reason-wise Attrition Count" color={AC.teal}>
        <AttrReasonTable data={reasons} loading={reasonQuery.isLoading} />
      </AttrSection>

      {/* 6 · AM and AON current month */}
      <div className="grid gap-4 xl:grid-cols-2">
        <AttrSection title={`AM Wise · ${cur} Attrition Count · Attrition % · UL Shrinkage %`} color={AC.teal}>
          {am.length === 0 ? <AttrEmpty loading={amQuery.isLoading} message="No AM data." /> : <AttrComboChart data={breakdownToCombo(am)} barColor={AC.teal} />}
        </AttrSection>
        <AttrSection title={`AON Wise · ${cur} Attrition Count · Attrition % · UL Shrinkage %`} color={AC.yellow}>
          {aon.length === 0 ? <AttrEmpty loading={aonQuery.isLoading} message="No AON data." /> : <AttrComboChart data={breakdownToCombo(aon)} barColor={AC.yellow} />}
        </AttrSection>
      </div>

      {/* 7 · TL current month */}
      <AttrSection title={`TL Wise · ${cur} Attrition Count · Attrition % · UL Shrinkage %`} color={AC.green}>
        {tl.length === 0 ? <AttrEmpty loading={tlQuery.isLoading} message="No TL data." /> : <AttrComboChart data={breakdownToCombo(tl)} barColor={AC.green} height={380} rotateLabels />}
      </AttrSection>

      {/* 8 · Month-wise detail */}
      <AttrSection title="Month Wise Detail" color={AC.navy}>
        <AttrDetailTable rows={months.map((m) => ({ ...m, key: m.month }))} loading={monthlyQuery.isLoading} />
      </AttrSection>

      {/* 9–11 · AM, TL, AON current-month detail — rows open the records behind them */}
      <AttrSection title={`AM Wise · ${cur} Attrition & Shrinkage`} color={AC.teal}>
        <AttrDetailTable rows={breakdownToRows(am)} labelHeader="AM" loading={amQuery.isLoading} onRowClick={openDrill("am_name")} />
      </AttrSection>
      <AttrSection title={`TL Wise · ${cur} Attrition & Shrinkage`} color={AC.green}>
        <AttrDetailTable rows={breakdownToRows(tl)} labelHeader="TL" loading={tlQuery.isLoading} onRowClick={openDrill("tl_name")} maxHeight={560} />
      </AttrSection>
      <AttrSection title={`AON Wise · ${cur} Attrition & Shrinkage`} color={AC.yellow}>
        <AttrDetailTable rows={breakdownToRows(aon)} labelHeader="AON" loading={aonQuery.isLoading} onRowClick={openDrill("aon_bucket")} />
      </AttrSection>
      <AttrSection title={`Location Wise · ${cur} Attrition & Shrinkage`} color={AC.purple}>
        <AttrDetailTable rows={breakdownToRows(location)} labelHeader="Location" loading={locationQuery.isLoading} onRowClick={openDrill("location")} />
      </AttrSection>

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`Attrition — ${dimLabel(drilldown.dimension)}: ${drilldown.label}`}
          tableKey="ONFIDO_AGENT_DAILY"
          filterColumn={drilldown.dimension}
          filterValue={drilldown.rawLabel}
          range={{ from: `${drilldown.month}-01`, to: lastDayOfMonth(drilldown.month) }}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}

      <AttrSection title="Exits in Range" color={AC.red}>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>Date</th><th>Emp</th><th>Analyst Email</th><th>TL</th><th>AM</th><th>Reason</th><th>Type</th></tr></thead>
            <tbody>
              {exits.length === 0 && <tr className="oc-empty-row"><td colSpan={7}>{exitsQuery.isLoading ? "Loading…" : "No exits in this range"}</td></tr>}
              {exits.slice(0, 100).map((e) => (
                <tr
                  key={e.id}
                  className="oc-row-click"
                  onClick={async () => {
                    const res = await hrmsApi.get<{ data: RawRecord }>(`/api/onfido-process/records/ONFIDO_AGENT_DAILY/${e.id}`);
                    onOpenRecord(res.data, "ONFIDO_AGENT_DAILY");
                  }}
                >
                  <td>{e.exitDate}</td>
                  <td>{e.empName}</td>
                  <td>{e.analystEmail}</td>
                  <td>{e.tlName}</td>
                  <td>{e.amName}</td>
                  <td>{e.reason ?? "—"}</td>
                  <td>{e.attritionType ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {exits.length > 100 && <div style={{ marginTop: 10, fontSize: 11, color: AC.muted }}>Showing first 100 of {exits.length}</div>}
      </AttrSection>
    </div>
  );
}

/**
 * ETM (Escalated Task Management) view — real onfido_doc_etm_raw /
 * onfido_poa_etm_raw data. Every row in these tables is an escalated task by
 * definition, so "ETM count" is simply COUNT(*) in range.
 */
/** The reference dashboard's donut palette — reused for every distribution
 *  chart (ETM AM/TL/AON, Task Skip AM/TL/Task-Type). */
const DONUT_COLORS = [AC.blue, AC.teal, AC.purple, AC.orange, AC.pink, AC.green, AC.yellow, AC.red, AC.navy, AC.muted];

/** "AM-wise / TL-wise / AON-wise Distribution" donut + ranked-list panel —
 *  one instance per dimension, laid out three-across like the reference. */
function DonutBreakdown({
  title, rows, onSelect, tagLabel = "Donut chart",
}: { title: string; rows: { label: string; count: number }[]; onSelect?: (label: string) => void; tagLabel?: string }) {
  const top = rows.slice(0, 8);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  return (
    <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-2">
        <h3 style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--blue)", display: "inline-block", flexShrink: 0 }} />
          {title}
        </h3>
        <span style={{ fontSize: 9.5, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700, whiteSpace: "nowrap" }}>{tagLabel}</span>
      </div>
      {top.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data</div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <div style={{ position: "relative", width: 128, height: 128, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={top} dataKey="count" nameKey="label" innerRadius={38} outerRadius={60} paddingAngle={1} strokeWidth={1} stroke="#fff" isAnimationActive={false}>
                  {top.map((r, i) => (
                    <Cell key={r.label} fill={DONUT_COLORS[i % DONUT_COLORS.length]} cursor={onSelect ? "pointer" : "default"} onClick={() => onSelect?.(r.label)} />
                  ))}
                </Pie>
                <RTooltip content={<DarkTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)" }}>{total.toLocaleString("en-IN")}</div>
              <div style={{ fontSize: 9, color: "var(--muted)", fontWeight: 700 }}>Total</div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {top.map((r, i) => (
              <div
                key={r.label}
                onClick={() => onSelect?.(r.label)}
                className={onSelect ? "oc-row-click" : undefined}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2.5px 0" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: DONUT_COLORS[i % DONUT_COLORS.length], flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap" }}>
                  {r.count.toLocaleString("en-IN")} · {total > 0 ? ((r.count / total) * 100).toFixed(1) : "0.0"}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtPivotDay(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return `${String(dt.getDate()).padStart(2, "0")}-${dt.toLocaleString("en-US", { month: "short" }).toUpperCase()}-${String(dt.getFullYear()).slice(2)}`;
}

/** "Analyst / Client / Document-or-Task-Type Day-wise Trend" and "Day and
 *  Slot-wise Trend" panels — a label x day pivot with a totals row/column,
 *  horizontally scrollable once the date range spans more than a few days. */
function DayPivotTable({ title, pivot, dimensionLabel }: { title: string; pivot: DayPivot; dimensionLabel: string }) {
  const grandTotal = Object.values(pivot.dayTotals).reduce((a, b) => a + b, 0);
  return (
    <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-2">
        <h3 style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--purple)", display: "inline-block" }} />
          {title}
        </h3>
        <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700 }}>Filtered figures</span>
      </div>
      {pivot.days.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
      ) : (
        <div style={{ overflow: "auto", marginTop: 10, maxHeight: 360 }}>
          <table className="oc-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ position: "sticky", left: 0, background: "var(--panel)", zIndex: 1 }}>{dimensionLabel}</th>
                {pivot.days.map((d) => <th key={d} className="oc-right">{fmtPivotDay(d)}</th>)}
                <th className="oc-right" style={{ fontWeight: 900 }}>Grand Total</th>
              </tr>
            </thead>
            <tbody>
              {pivot.rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ position: "sticky", left: 0, background: "var(--panel)" }}>{r.label}</td>
                  {pivot.days.map((d) => <td key={d} className="oc-right">{r.byDay[d] ? r.byDay[d].toLocaleString("en-IN") : "—"}</td>)}
                  <td className="oc-right" style={{ fontWeight: 800 }}>{r.total.toLocaleString("en-IN")}</td>
                </tr>
              ))}
              <tr style={{ background: "rgba(148,163,184,0.1)", fontWeight: 800 }}>
                <td style={{ position: "sticky", left: 0, background: "rgba(148,163,184,0.1)" }}>Day</td>
                {pivot.days.map((d) => <td key={d} className="oc-right">{(pivot.dayTotals[d] ?? 0).toLocaleString("en-IN")}</td>)}
                <td className="oc-right">{grandTotal.toLocaleString("en-IN")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EtmView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [queue, setQueue] = useState<EtmQueue>("doc");
  const [dimension, setDimension] = useState<EtmDimension>("tl_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string; dimension: EtmDimension } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);
  const qKey = [range, tlFilter, amFilter, queue] as const;
  const dimLabel = (d: EtmDimension) => (d === "escalated_by_email" ? "Escalated By" : d === "aon_bucket" ? "AON" : d === "tl_name" ? "TL" : "AM");

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "etm-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: EtmOverview }>(`/api/onfido-process/etm/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "etm-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: EtmTrendPoint[] }>(`/api/onfido-process/etm/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "etm-breakdown", range, queue, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: EtmBreakdownRow[] }>(`/api/onfido-process/etm/breakdown/${queue}/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });

  // AM/TL/AON-wise distribution — current range and latest-day variants, three
  // dimensions each, matching the reference's two donut-trio rows.
  const amCurrent = useQuery({
    queryKey: ["onfido-process", "etm-breakdown", ...qKey, "am_name"],
    queryFn: () => hrmsApi.get<{ data: EtmBreakdownRow[] }>(`/api/onfido-process/etm/breakdown/${queue}/am_name?from=${range.from}&to=${range.to}${qs}`),
  });
  const tlCurrent = useQuery({
    queryKey: ["onfido-process", "etm-breakdown", ...qKey, "tl_name"],
    queryFn: () => hrmsApi.get<{ data: EtmBreakdownRow[] }>(`/api/onfido-process/etm/breakdown/${queue}/tl_name?from=${range.from}&to=${range.to}${qs}`),
  });
  const aonCurrent = useQuery({
    queryKey: ["onfido-process", "etm-breakdown", ...qKey, "aon_bucket"],
    queryFn: () => hrmsApi.get<{ data: EtmBreakdownRow[] }>(`/api/onfido-process/etm/breakdown/${queue}/aon_bucket?from=${range.from}&to=${range.to}${qs}`),
  });
  const amLatest = useQuery({
    queryKey: ["onfido-process", "etm-latest", ...qKey, "am_name"],
    queryFn: () => hrmsApi.get<{ data: { date: string | null; rows: EtmBreakdownRow[] } }>(`/api/onfido-process/etm/latest-day/${queue}/am_name?from=${range.from}&to=${range.to}${qs}`),
  });
  const tlLatest = useQuery({
    queryKey: ["onfido-process", "etm-latest", ...qKey, "tl_name"],
    queryFn: () => hrmsApi.get<{ data: { date: string | null; rows: EtmBreakdownRow[] } }>(`/api/onfido-process/etm/latest-day/${queue}/tl_name?from=${range.from}&to=${range.to}${qs}`),
  });
  const aonLatest = useQuery({
    queryKey: ["onfido-process", "etm-latest", ...qKey, "aon_bucket"],
    queryFn: () => hrmsApi.get<{ data: { date: string | null; rows: EtmBreakdownRow[] } }>(`/api/onfido-process/etm/latest-day/${queue}/aon_bucket?from=${range.from}&to=${range.to}${qs}`),
  });

  // Analyst / Slot / Client / Document-Type day-wise pivots.
  const analystPivot = useQuery({
    queryKey: ["onfido-process", "etm-pivot", ...qKey, "analyst"],
    queryFn: () => hrmsApi.get<{ data: DayPivot }>(`/api/onfido-process/etm/day-pivot/${queue}/analyst?from=${range.from}&to=${range.to}${qs}`),
  });
  const slotPivot = useQuery({
    queryKey: ["onfido-process", "etm-pivot", ...qKey, "slot"],
    queryFn: () => hrmsApi.get<{ data: DayPivot }>(`/api/onfido-process/etm/day-pivot/${queue}/slot?from=${range.from}&to=${range.to}${qs}`),
  });
  const clientPivot = useQuery({
    queryKey: ["onfido-process", "etm-pivot", ...qKey, "client"],
    queryFn: () => hrmsApi.get<{ data: DayPivot }>(`/api/onfido-process/etm/day-pivot/${queue}/client?from=${range.from}&to=${range.to}${qs}`),
  });
  const docTypePivot = useQuery({
    queryKey: ["onfido-process", "etm-pivot", ...qKey, "document_type"],
    queryFn: () => hrmsApi.get<{ data: DayPivot }>(`/api/onfido-process/etm/day-pivot/${queue}/document_type?from=${range.from}&to=${range.to}${qs}`),
    enabled: queue === "doc",
  });

  const ov = overviewQuery.data?.data;
  const q = ov ? ov[queue] : undefined;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const queueLabel = queue === "doc" ? "DOC ETM" : "POA ETM";

  return (
    <div className="space-y-4">
      <PillGroup value={queue} onChange={setQueue} options={[{ key: "doc", label: "DOC ETM" }, { key: "poa", label: "POA ETM" }]} />

      {q && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiPlain kpi={q.selected} kc="var(--blue)" />
          <KpiPlain kpi={q.latestDay} kc="var(--purple)" />
          <KpiPlain kpi={q.ytd} kc="var(--teal)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>{queueLabel} · Month-wise Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div style={{ marginTop: 14 }}>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="doc" name="DOC" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList dataKey="doc" position="inside" fill="#fff" fontSize={10} />
              </Bar>
              <Bar dataKey="poa" name="POA" fill="var(--teal)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList dataKey="poa" position="inside" fill="#fff" fontSize={10} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {points.length > 0 && <ChartLegendRow />}
        </div>
      </div>

      <div>
        <div className="mb-2" style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>
          {queueLabel} · Current Range Distribution
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <DonutBreakdown title={`${queueLabel} · AM-wise Distribution`} rows={amCurrent.data?.data ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "am_name" })} />
          <DonutBreakdown title={`${queueLabel} · TL-wise Trend`} rows={tlCurrent.data?.data ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "tl_name" })} tagLabel="Top categories" />
          <DonutBreakdown title={`${queueLabel} · AON-wise Distribution`} rows={aonCurrent.data?.data ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "aon_bucket" })} />
        </div>
      </div>

      <div>
        <div className="mb-2" style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>
          {queueLabel} · Latest Day{amLatest.data?.data.date ? ` (${fmtPivotDay(amLatest.data.data.date)})` : ""}
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <DonutBreakdown title={`${queueLabel} · Latest Day AM-wise`} rows={amLatest.data?.data.rows ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "am_name" })} />
          <DonutBreakdown title={`${queueLabel} · Latest Day TL-wise`} rows={tlLatest.data?.data.rows ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "tl_name" })} tagLabel="Top categories" />
          <DonutBreakdown title={`${queueLabel} · Latest Day AON-wise`} rows={aonLatest.data?.data.rows ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "aon_bucket" })} />
        </div>
      </div>

      <DayPivotTable title={`${queueLabel} · Analyst Day-wise Trend`} pivot={analystPivot.data?.data ?? { days: [], rows: [], dayTotals: {} }} dimensionLabel="Analyst Email" />
      <DayPivotTable title={`${queueLabel} · Selected Month Day and Slot-wise Trend`} pivot={slotPivot.data?.data ?? { days: [], rows: [], dayTotals: {} }} dimensionLabel="GMT Slot" />
      <DayPivotTable title={`${queueLabel} · Client Day-wise Trend`} pivot={clientPivot.data?.data ?? { days: [], rows: [], dayTotals: {} }} dimensionLabel="IMS Client Name" />
      {queue === "doc" && (
        <DayPivotTable title={`${queueLabel} · Document Type Day-wise Trend`} pivot={docTypePivot.data?.data ?? { days: [], rows: [], dayTotals: {} }} dimensionLabel="Document Type" />
      )}

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[
              { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
              { key: "aon_bucket", label: "AON Wise" }, { key: "escalated_by_email", label: "Escalated By" },
            ]}
          />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabel(dimension)}</th><th className="oc-right">Count</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={2}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label, dimension })}>
                  <td>{r.label}</td><td className="oc-right">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`${queueLabel} — ${dimLabel(drilldown.dimension)}: ${drilldown.label}`}
          tableKey={queue === "doc" ? "ONFIDO_DOC_ETM" : "ONFIDO_POA_ETM"}
          filterColumn={drilldown.dimension}
          filterValue={drilldown.label}
          range={range}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

/**
 * Task Skip view — real onfido_task_skip_raw data: tasks unassigned/skipped
 * by an analyst before completion.
 */
function TaskSkipView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<TaskSkipDimension>("tl_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string; dimension: TaskSkipDimension } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);
  const qKey = [range, tlFilter, amFilter] as const;
  const dimLabelOf = (d: TaskSkipDimension) => ({ tl_name: "TL", am_name: "AM", unassigned_from_email: "Analyst", ims_client_name: "Client", task_type: "Task Type" })[d];

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "taskskip-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: TaskSkipOverview }>(`/api/onfido-process/task-skip/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "taskskip-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: TaskSkipTrendPoint[] }>(`/api/onfido-process/task-skip/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "taskskip-breakdown", range, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: TaskSkipBreakdownRow[] }>(`/api/onfido-process/task-skip/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });

  // AM/TL/Task-Type-wise distribution — current range and latest-day variants.
  const amCurrent = useQuery({
    queryKey: ["onfido-process", "taskskip-breakdown", ...qKey, "am_name"],
    queryFn: () => hrmsApi.get<{ data: TaskSkipBreakdownRow[] }>(`/api/onfido-process/task-skip/breakdown/am_name?from=${range.from}&to=${range.to}${qs}`),
  });
  const tlCurrent = useQuery({
    queryKey: ["onfido-process", "taskskip-breakdown", ...qKey, "tl_name"],
    queryFn: () => hrmsApi.get<{ data: TaskSkipBreakdownRow[] }>(`/api/onfido-process/task-skip/breakdown/tl_name?from=${range.from}&to=${range.to}${qs}`),
  });
  const taskTypeCurrent = useQuery({
    queryKey: ["onfido-process", "taskskip-breakdown", ...qKey, "task_type"],
    queryFn: () => hrmsApi.get<{ data: TaskSkipBreakdownRow[] }>(`/api/onfido-process/task-skip/breakdown/task_type?from=${range.from}&to=${range.to}${qs}`),
  });
  const amLatest = useQuery({
    queryKey: ["onfido-process", "taskskip-latest", ...qKey, "am_name"],
    queryFn: () => hrmsApi.get<{ data: { date: string | null; rows: TaskSkipBreakdownRow[] } }>(`/api/onfido-process/task-skip/latest-day/am_name?from=${range.from}&to=${range.to}${qs}`),
  });
  const tlLatest = useQuery({
    queryKey: ["onfido-process", "taskskip-latest", ...qKey, "tl_name"],
    queryFn: () => hrmsApi.get<{ data: { date: string | null; rows: TaskSkipBreakdownRow[] } }>(`/api/onfido-process/task-skip/latest-day/tl_name?from=${range.from}&to=${range.to}${qs}`),
  });
  const taskTypeLatest = useQuery({
    queryKey: ["onfido-process", "taskskip-latest", ...qKey, "task_type"],
    queryFn: () => hrmsApi.get<{ data: { date: string | null; rows: TaskSkipBreakdownRow[] } }>(`/api/onfido-process/task-skip/latest-day/task_type?from=${range.from}&to=${range.to}${qs}`),
  });

  // Analyst / Slot / Client / Task-Type day-wise pivots.
  const analystPivot = useQuery({
    queryKey: ["onfido-process", "taskskip-pivot", ...qKey, "analyst"],
    queryFn: () => hrmsApi.get<{ data: DayPivot }>(`/api/onfido-process/task-skip/day-pivot/analyst?from=${range.from}&to=${range.to}${qs}`),
  });
  const slotPivot = useQuery({
    queryKey: ["onfido-process", "taskskip-pivot", ...qKey, "slot"],
    queryFn: () => hrmsApi.get<{ data: DayPivot }>(`/api/onfido-process/task-skip/day-pivot/slot?from=${range.from}&to=${range.to}${qs}`),
  });
  const clientPivot = useQuery({
    queryKey: ["onfido-process", "taskskip-pivot", ...qKey, "client"],
    queryFn: () => hrmsApi.get<{ data: DayPivot }>(`/api/onfido-process/task-skip/day-pivot/client?from=${range.from}&to=${range.to}${qs}`),
  });
  const taskTypePivot = useQuery({
    queryKey: ["onfido-process", "taskskip-pivot", ...qKey, "task_type"],
    queryFn: () => hrmsApi.get<{ data: DayPivot }>(`/api/onfido-process/task-skip/day-pivot/task_type?from=${range.from}&to=${range.to}${qs}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiPlain kpi={ov.selected} kc="var(--orange)" />
          <KpiPlain kpi={ov.latestDay} kc="var(--purple)" />
          <KpiPlain kpi={ov.ytd} kc="var(--teal)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Task Skip · Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div style={{ marginTop: 14 }}>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="count" name="Task Skip" fill="var(--orange)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList dataKey="count" position="top" fontSize={10} fill="var(--muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        </div>
      </div>

      <div>
        <div className="mb-2" style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>
          Task Skip · Current Range Distribution
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <DonutBreakdown title="Task Skip · AM-wise Distribution" rows={amCurrent.data?.data ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "am_name" })} />
          <DonutBreakdown title="Task Skip · TL-wise Trend" rows={tlCurrent.data?.data ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "tl_name" })} tagLabel="Top categories" />
          <DonutBreakdown title="Task Skip · Task-wise Distribution" rows={taskTypeCurrent.data?.data ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "task_type" })} tagLabel="Pie chart" />
        </div>
      </div>

      <div>
        <div className="mb-2" style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>
          Task Skip · Latest Day{amLatest.data?.data.date ? ` (${fmtPivotDay(amLatest.data.data.date)})` : ""}
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <DonutBreakdown title="Task Skip · Latest Day AM-wise" rows={amLatest.data?.data.rows ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "am_name" })} />
          <DonutBreakdown title="Task Skip · Latest Day TL-wise" rows={tlLatest.data?.data.rows ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "tl_name" })} tagLabel="Top categories" />
          <DonutBreakdown title="Task Skip · Latest Day Task-wise" rows={taskTypeLatest.data?.data.rows ?? []} onSelect={(l) => setDrilldown({ label: l, dimension: "task_type" })} />
        </div>
      </div>

      <DayPivotTable title="Task Skip · Analyst Day-wise Trend" pivot={analystPivot.data?.data ?? { days: [], rows: [], dayTotals: {} }} dimensionLabel="Analyst" />
      <DayPivotTable title="Task Skip · Selected Month Day and Slot-wise Trend" pivot={slotPivot.data?.data ?? { days: [], rows: [], dayTotals: {} }} dimensionLabel="GMT Slot" />
      <DayPivotTable title="Task Skip · Client Day-wise Trend" pivot={clientPivot.data?.data ?? { days: [], rows: [], dayTotals: {} }} dimensionLabel="IMS Client Name" />
      <DayPivotTable title="Task Skip · Task Type Day-wise Trend" pivot={taskTypePivot.data?.data ?? { days: [], rows: [], dayTotals: {} }} dimensionLabel="Task Type" />

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[
              { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
              { key: "unassigned_from_email", label: "Analyst Wise" }, { key: "ims_client_name", label: "Client Wise" },
              { key: "task_type", label: "Task Type Wise" },
            ]}
          />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabelOf(dimension)}</th><th className="oc-right">Count</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={2}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label, dimension })}>
                  <td>{r.label}</td><td className="oc-right">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`Task Skip — ${dimLabelOf(drilldown.dimension)}: ${drilldown.label}`}
          tableKey="ONFIDO_TASK_SKIP"
          filterColumn={drilldown.dimension}
          filterValue={drilldown.label}
          range={range}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

type QualityScope = "all" | "internal" | "external";

/**
 * Quality Breakdown view — real onfido_doc_external_audit_raw data (17,179
 * rows / 340 clients / 732 document types), the richest per-task DOC table
 * this dashboard has, previously only feeding Analyst Performance and Alerts.
 */
function QualityView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<QualityDimension>("ims_client_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [scope, setScope] = useState<QualityScope>("all");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);
  const showInternal = scope !== "external";
  const showExternal = scope !== "internal";

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "quality-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: QualityOverview }>(`/api/onfido-process/quality/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "quality-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: QualityTrendPoint[] }>(`/api/onfido-process/quality/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "quality-breakdown", range, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: QualityBreakdownRow[] }>(`/api/onfido-process/quality/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });
  // The "dedicated errors-only raw table" from the old dashboard's feature list —
  // reuses the generic records endpoint's filterColumn mechanism (has_error = 1)
  // rather than a bespoke route, so every failed audit is one real record, not
  // an aggregate.
  const errorsQuery = useQuery({
    queryKey: ["onfido-process", "quality-errors", range, tlFilter, amFilter],
    queryFn: () =>
      hrmsApi.get<{ data: { rows: RawRecord[]; total: number } }>(
        `/api/onfido-process/records/ONFIDO_DOC_EXTERNAL_AUDIT?from=${range.from}&to=${range.to}${qs}&filterColumn=has_error&filterValue=1&limit=100`
      ),
  });
  // 2026-09-17 feedback additions — Int Overall Err% (internal DOC audit), POA
  // Error% and Ext POA% alongside the existing external-audit scorecard.
  // FAR%/FRR%/Manual FAR%/Manual FRR% are intentionally excluded per explicit
  // instruction not to add them anywhere on this dashboard.
  const intOverviewQuery = useQuery({
    queryKey: ["onfido-process", "quality-int-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: DocInternalQualityOverview }>(`/api/onfido-process/quality/internal-overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const poaOverviewForQualityQuery = useQuery({
    queryKey: ["onfido-process", "poa-overview-for-quality", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaOverview }>(`/api/onfido-process/poa/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const poaExternalOverviewForQualityQuery = useQuery({
    queryKey: ["onfido-process", "poa-external-overview-for-quality", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaExternalOverview }>(`/api/onfido-process/poa-external/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const metricTrendQuery = useQuery({
    queryKey: ["onfido-process", "quality-metric-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: QualityMetricTrendPoint[] }>(`/api/onfido-process/quality/metric-trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const intTrendForTableQuery = useQuery({
    queryKey: ["onfido-process", "quality-int-trend-for-table", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: QualityTrendPoint[] }>(`/api/onfido-process/quality/internal-trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const poaTrendForTableQuery = useQuery({
    queryKey: ["onfido-process", "quality-poa-trend-for-table", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: QualityTrendPoint[] }>(`/api/onfido-process/poa/quality-trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const poaExtTrendForTableQuery = useQuery({
    queryKey: ["onfido-process", "quality-poa-ext-trend-for-table", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: PoaExternalTrendPoint[] }>(`/api/onfido-process/poa-external/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const analystQualityQuery = useQuery({
    queryKey: ["onfido-process", "quality-analyst-quality", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: AnalystQualityRow[] }>(`/api/onfido-process/quality/analyst-quality?from=${range.from}&to=${range.to}${qs}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const errors = errorsQuery.data?.data;
  const dimLabel = { ims_client_name: "Client", docupedia_document_name: "Document Type", tl_name: "TL", am_name: "AM" }[dimension];
  const intOv = intOverviewQuery.data?.data;
  const poaOv = poaOverviewForQualityQuery.data?.data;
  const poaExtOv = poaExternalOverviewForQualityQuery.data?.data;

  // Build scorecard metrics from the overview KPIs
  const scorecardMetrics = ov ? ([
    { name: "Overall Error %", value: ov.overallErrorRate?.value ?? null, external: true },
    { name: "Classification Error %", value: ov.classificationErrorRate?.value ?? null, external: true },
    { name: "Extraction Error %", value: ov.extractionErrorRate?.value ?? null, external: true },
    { name: "Add. Extraction Error %", value: ov.addExtractionErrorRate?.value ?? null, external: true },
    { name: "Raw Extraction Error %", value: ov.rawExtractionErrorRate?.value ?? null, external: true },
    { name: "Int Overall Error %", value: intOv?.overallErrorRate?.value ?? null, external: false },
    { name: "POA Error %", value: poaOv?.errorRate?.value ?? null, external: false },
    { name: "Ext POA %", value: poaExtOv?.errorRate?.value ?? null, external: true },
  ] as const).filter((m) => (m.external ? showExternal : showInternal)).map(({ name, value }) => ({ name, value })) : [];

  // Merge the 3 extra trend sources (internal DOC, POA internal, POA external)
  // into the same bucket set the metric-trend table renders as columns.
  const metricTrendRows = useMemo(() => {
    const metricPoints = metricTrendQuery.data?.data ?? [];
    const intPoints = intTrendForTableQuery.data?.data ?? [];
    const poaPoints = poaTrendForTableQuery.data?.data ?? [];
    const poaExtPoints = poaExtTrendForTableQuery.data?.data ?? [];
    const buckets = [...new Set([
      ...metricPoints.map((p) => p.bucket), ...intPoints.map((p) => p.bucket),
      ...poaPoints.map((p) => p.bucket), ...poaExtPoints.map((p) => p.bucket),
    ])].sort();
    const byBucket = <T,>(arr: T[], key: (t: T) => string) => new Map(arr.map((t) => [key(t), t]));
    const metricByBucket = byBucket(metricPoints, (p) => p.bucket);
    const intByBucket = byBucket(intPoints, (p) => p.bucket);
    const poaByBucket = byBucket(poaPoints, (p) => p.bucket);
    const poaExtByBucket = byBucket(poaExtPoints, (p) => p.bucket);
    const rowDefs: { label: string; external: boolean; getVal: (bucket: string) => number | null }[] = [
      { label: "Overall Error %", external: true, getVal: (b) => metricByBucket.get(b)?.overallErrorRate ?? null },
      { label: "Classification Error %", external: true, getVal: (b) => metricByBucket.get(b)?.classificationErrorRate ?? null },
      { label: "Extraction Error %", external: true, getVal: (b) => metricByBucket.get(b)?.extractionErrorRate ?? null },
      { label: "Add. Extraction Error %", external: true, getVal: (b) => metricByBucket.get(b)?.addExtractionErrorRate ?? null },
      { label: "Raw Extraction Error %", external: true, getVal: (b) => metricByBucket.get(b)?.rawExtractionErrorRate ?? null },
      { label: "Int Overall Error %", external: false, getVal: (b) => intByBucket.get(b)?.errorRate ?? null },
      { label: "POA Error %", external: false, getVal: (b) => poaByBucket.get(b)?.errorRate ?? null },
      {
        label: "Ext POA %", external: true, getVal: (b) => {
          const p = poaExtByBucket.get(b);
          return p && p.taskCount > 0 ? Math.round((p.errorCount / p.taskCount) * 1000) / 10 : null;
        },
      },
    ];
    const visible = rowDefs.filter((r) => (r.external ? showExternal : showInternal));
    return { columns: buckets, rows: visible.map((r) => ({ label: r.label, values: buckets.map(r.getVal) })) };
  }, [metricTrendQuery.data, intTrendForTableQuery.data, poaTrendForTableQuery.data, poaExtTrendForTableQuery.data, showInternal, showExternal]);
  // Error Rate Trend chart follows the slicer: internal DOC audits vs the external audit table.
  const errorTrendPoints = scope === "internal" ? (intTrendForTableQuery.data?.data ?? []) : points;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="oc-eyebrow">Dashboard</span>
        <PillGroup
          value={scope} onChange={setScope}
          options={[{ key: "all", label: "All" }, { key: "internal", label: "Internal Quality" }, { key: "external", label: "External Quality" }]}
        />
      </div>
      {ov && showExternal && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiPlain kpi={ov.taskCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.overallErrorRate} kc="var(--red)" />
          <KpiPlain kpi={ov.farRate} kc="var(--orange)" />
        </div>
      )}
      {((showInternal && (intOv || poaOv)) || (showExternal && poaExtOv)) && (
        <div className="kr" style={{ gridTemplateColumns: `repeat(${(showInternal ? (intOv ? 1 : 0) + (poaOv ? 1 : 0) : 0) + (showExternal && poaExtOv ? 1 : 0)}, 1fr)` }}>
          {showInternal && intOv && <KpiPlain kpi={intOv.overallErrorRate} kc="var(--purple)" />}
          {showInternal && poaOv && <KpiPlain kpi={poaOv.errorRate} kc="var(--teal)" />}
          {showExternal && poaExtOv && <KpiPlain kpi={poaExtOv.errorRate} kc="var(--orange)" />}
        </div>
      )}

      {scorecardMetrics.length > 0 && (
        <ScorecardBarChart
          metrics={scorecardMetrics}
          title="Quality Scorecard — Error Rates by Stage"
          hc="var(--red)"
        />
      )}

      <MetricTrendTable
        title={`Quality Metric Trend — ${granularity[0].toUpperCase()}${granularity.slice(1)}-wise`}
        columns={metricTrendRows.columns}
        rows={metricTrendRows.rows}
        hc="var(--purple)"
      />

      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Error Rate Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">Errors ÷ tasks audited per bucket{scope === "internal" ? " — internal DOC audits" : scope === "external" ? " — external audits" : ""}.</div>
        {errorTrendPoints.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={errorTrendPoints.map((p) => ({ ...p, errorRate: p.errorRate ?? 0 }))} margin={{ top: 28, right: 40, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="qTrendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--red)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--red)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(42,58,82,0.25)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
              <RTooltip content={<DarkTooltip />} />
              <Area
                type="monotone" dataKey="errorRate" name="Error Rate %"
                stroke="var(--red)" strokeWidth={2} fill="url(#qTrendGrad)"
                dot={{ r: 3, fill: "var(--red)", stroke: "var(--card)", strokeWidth: 2 }}
                activeDot={{ r: 6 }}
              >
                <LabelList dataKey="errorRate" position="top" fontSize={12} fill="var(--red)"
                  formatter={(v: number) => v > 0 ? `${v.toFixed(2)}%` : "–"} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {showExternal && (
      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[
              { key: "ims_client_name", label: "Client Wise" }, { key: "docupedia_document_name", label: "Document Type Wise" },
              { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
            ]}
          />
        </div>
        <div className="oc-card-sub">Top 50 by task count.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabel}</th><th className="oc-right">Tasks</th><th className="oc-right">Error Rate</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={3}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
                  <td>{r.label}</td>
                  <td className="oc-right">{r.taskCount.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.overallErrorRate !== null ? `${r.overallErrorRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {showExternal && (
      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <h3>Errors Only</h3>
        <div className="oc-card-sub">Every failed audit as its own record — not an aggregate. Click a row for its full detail.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>Date</th><th>Client</th><th>Analyst</th><th>Error Category</th><th>Error Breakdown</th></tr></thead>
            <tbody>
              {(errors?.rows ?? []).length === 0 && (
                <tr className="oc-empty-row"><td colSpan={5}>{errorsQuery.isLoading ? "Loading…" : "No errors in this range"}</td></tr>
              )}
              {(errors?.rows ?? []).map((r) => {
                const row = r as Record<string, unknown>;
                return (
                  <tr key={r.id} className="oc-row-click" onClick={() => onOpenRecord(r, "ONFIDO_DOC_EXTERNAL_AUDIT")}>
                    <td>{formatDateTime(row.report_date)}</td>
                    <td>{String(row.ims_client_name ?? "-")}</td>
                    <td>{String(row.analyst_email ?? "-")}</td>
                    <td>{String(row.error_category ?? "-")}</td>
                    <td>{String(row.error_breakdown ?? "-")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {errors && (
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
            Showing {errors.rows.length} of {errors.total.toLocaleString("en-IN")}
          </div>
        )}
      </div>
      )}

      {(() => {
        const allRows = analystQualityQuery.data?.data ?? [];
        const loading = analystQualityQuery.isLoading;
        const errColor = (v: number | null) =>
          v === null ? undefined : v > 2 ? "var(--red)" : v > 1 ? "var(--warn)" : "var(--good)";
        const fmtErr = (v: number | null) => v !== null ? `${v}%` : "—";

        const top20perf = [...allRows]
          .filter((r) => r.extAudits + r.intAudits >= 5)
          .sort((a, b) => (a.overallErrPct ?? 999) - (b.overallErrPct ?? 999))
          .slice(0, 20);
        const top20def = [...allRows]
          .filter((r) => r.extAudits + r.intAudits >= 5)
          .sort((a, b) => (b.overallErrPct ?? 0) - (a.overallErrPct ?? 0))
          .slice(0, 20);

        const AnalystQualityTable = ({ rows, title, sub }: { rows: AnalystQualityRow[]; title: string; sub: string }) => (
          <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 style={{ marginBottom: 0 }}>{title}</h3>
                <div className="oc-card-sub">{sub}</div>
              </div>
              <PillGroup
                value={granularity} onChange={setGranularity}
                options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
              />
            </div>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table className="oc-table">
                <thead>
                  <tr>
                    <th>Analyst</th><th>TL</th>
                    <th className="oc-right">Int Audits</th>
                    <th className="oc-right">Int Err%</th>
                    <th className="oc-right">Ext Audits</th>
                    <th className="oc-right">Ext Err%</th>
                    <th className="oc-right">Overall Err%</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr className="oc-empty-row"><td colSpan={7}>{loading ? "Loading…" : "No data in this range"}</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.analyst}>
                      <td style={{ fontSize: 11 }}>{r.analyst}</td>
                      <td style={{ fontSize: 11 }}>{r.tlName ?? "—"}</td>
                      <td className="oc-right">{r.intAudits > 0 ? r.intAudits.toLocaleString("en-IN") : "—"}</td>
                      <td className="oc-right" style={{ color: errColor(r.intErrPct), fontWeight: r.intErrPct !== null ? 700 : undefined }}>{fmtErr(r.intErrPct)}</td>
                      <td className="oc-right">{r.extAudits > 0 ? r.extAudits.toLocaleString("en-IN") : "—"}</td>
                      <td className="oc-right" style={{ color: errColor(r.extErrPct), fontWeight: r.extErrPct !== null ? 700 : undefined }}>{fmtErr(r.extErrPct)}</td>
                      <td className="oc-right" style={{ color: errColor(r.overallErrPct), fontWeight: r.overallErrPct !== null ? 700 : undefined }}>{fmtErr(r.overallErrPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: "var(--muted)" }}>
              Conditional formatting: <span style={{ color: "var(--good)", fontWeight: 700 }}>Green</span> = &lt;1% · <span style={{ color: "var(--warn)", fontWeight: 700 }}>Amber</span> = 1–2% · <span style={{ color: "var(--red)", fontWeight: 700 }}>Red</span> = &gt;2%
            </div>
          </div>
        );

        return (
          <>
            <AnalystQualityTable
              rows={allRows}
              title="Analyst Quality Score"
              sub="Internal error % (from DOC internal audit), external error % (from external audit), overall combined."
            />
            <AnalystQualityTable
              rows={top20perf}
              title="Top 20 Performers"
              sub="Analysts with the lowest overall error rate (min 5 audits)."
            />
            <AnalystQualityTable
              rows={top20def}
              title="Top 20 Defaulters"
              sub="Analysts with the highest overall error rate (min 5 audits)."
            />
          </>
        );
      })()}

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`Quality — ${dimLabel}`}
          tableKey="ONFIDO_DOC_EXTERNAL_AUDIT"
          filterColumn={dimension}
          filterValue={drilldown.label}
          range={range}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

type EscalationSourceSlicer = "ALL" | "CRE" | "CRQ";

/**
 * Client Escalations view — CRE and CRQ are two file formats for the same
 * real thing (a client reporting an error back on a DOC report): CRE is the
 * current format (Jan'26 onward, 510 lines), CRQ is the earlier format the
 * client used before switching (2022-2026, 2,251 lines). Every query here
 * combines both — see the backend's own comment on why — so a client's true
 * escalation count is never split across two tabs.
 */
function EscalationsView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<EscalationDimension>("ims_client_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [source, setSource] = useState<EscalationSourceSlicer>("ALL");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);
  const sourceQS = source === "ALL" ? "" : `&source=${source}`;

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "escalation-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: EscalationOverview }>(`/api/onfido-process/escalations/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "escalation-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: EscalationTrendPoint[] }>(`/api/onfido-process/escalations/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "escalation-breakdown", range, dimension, tlFilter, amFilter, source],
    queryFn: () => hrmsApi.get<{ data: EscalationBreakdownRow[] }>(`/api/onfido-process/escalations/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}${sourceQS}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const dimLabel = { ims_client_name: "Client", error_category: "Error Category", tl_name: "TL", am_name: "AM" }[dimension];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="oc-eyebrow">Queue</span>
        <PillGroup
          value={source} onChange={setSource}
          options={[{ key: "ALL", label: "CRE + CRQ" }, { key: "CRE", label: "CRE" }, { key: "CRQ", label: "CRQ" }]}
        />
      </div>
      {ov && source === "ALL" && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <KpiPlain kpi={ov.totalLines} kc="var(--red)" />
          <KpiPlain kpi={ov.creLines} kc="var(--orange)" />
          <KpiPlain kpi={ov.crqLines} kc="var(--orange)" />
          <KpiPlain kpi={ov.distinctReports} kc="var(--purple)" />
        </div>
      )}
      {ov && source !== "ALL" && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(1, 1fr)" }}>
          <KpiPlain kpi={source === "CRE" ? ov.creLines : ov.crqLines} kc="var(--orange)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Client Escalation Trend{source === "ALL" ? "" : ` — ${source}`}</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">CRE vs CRQ client-reported error lines per bucket, shown separately so a spike in one queue doesn't hide inside the other.</div>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted)" }} />
              {source !== "CRQ" && (
                <Bar dataKey="creCount" name="CRE" fill="var(--red)" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="creCount" position="top" fontSize={10} fill="var(--muted)" />
                </Bar>
              )}
              {source !== "CRE" && (
                <Bar dataKey="crqCount" name="CRQ" fill="var(--teal)" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="crqCount" position="top" fontSize={10} fill="var(--muted)" />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[
              { key: "ims_client_name", label: "Client Wise" }, { key: "error_category", label: "Error Category" },
              { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
            ]}
          />
        </div>
        <div className="oc-card-sub">Top 50 by escalation line count. Click a row to see the underlying reports.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabel}</th><th className="oc-right">Lines</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={2}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
                  <td>{r.label}</td>
                  <td className="oc-right">{r.count.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <EscalationDrilldownSheet
          open={!!drilldown}
          title={`Escalations — ${dimLabel}`}
          dimension={dimension}
          filterValue={drilldown.label}
          range={range}
          tlFilter={tlFilter}
          amFilter={amFilter}
          source={source}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

/**
 * Escalations' own drill-down sheet — unlike BreakdownDrilldownSheet, CRE and
 * CRQ are two physically separate tables, so this hits the dedicated
 * /escalations/records endpoint (which UNIONs both) instead of the generic
 * single-table /records/:table route. Each row already carries which table it
 * came from (`escalation_source`), so the row click still opens the exact
 * same shared RecordDrawer via onOpenRecord — no new detail endpoint needed.
 */
function EscalationDrilldownSheet({
  open, title, dimension, filterValue, range, tlFilter, amFilter, source, onOpenChange, onOpenRecord,
}: {
  open: boolean; title: string; dimension: EscalationDimension; filterValue: string;
  range: { from: string; to: string }; tlFilter: string; amFilter: string; source: EscalationSourceSlicer;
  onOpenChange: (v: boolean) => void; onOpenRecord: (record: RawRecord, table: string) => void;
}) {
  const qs = tlAmQS(tlFilter, amFilter);
  const recordsQuery = useQuery({
    queryKey: ["onfido-process", "escalation-records", dimension, filterValue, range, tlFilter, amFilter, source],
    queryFn: () =>
      hrmsApi.get<{ data: { rows: (RawRecord & { escalation_source: "CRE" | "CRQ" })[]; total: number } }>(
        `/api/onfido-process/escalations/records/${dimension}?from=${range.from}&to=${range.to}${qs}&value=${encodeURIComponent(filterValue)}&limit=100${source === "ALL" ? "" : `&source=${source}`}`
      ),
    enabled: open,
  });
  const records = recordsQuery.data?.data;
  const tableForSource = (source: "CRE" | "CRQ") => (source === "CRE" ? "ONFIDO_DOC_ESCALATION_CRE" : "ONFIDO_DOC_ESCALATION_CRQ");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 !text-[color:var(--text)]">
            <MessageSquareWarning className="h-4 w-4" style={{ color: "var(--muted)" }} /> {title}
          </SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">{filterValue}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <p className="mb-2" style={{ fontSize: 11, color: "var(--muted)" }}>Click a record for its full detail.</p>
          <table className="oc-table">
            <thead><tr><th>Date</th><th>Format</th><th>Analyst</th><th>Error Category</th><th>Error Breakdown</th></tr></thead>
            <tbody>
              {(records?.rows ?? []).length === 0 && (
                <tr className="oc-empty-row"><td colSpan={5}>{recordsQuery.isLoading ? "Loading…" : "No records"}</td></tr>
              )}
              {(records?.rows ?? []).map((r) => {
                const row = r as Record<string, unknown>;
                return (
                  <tr key={r.id} className="oc-row-click" onClick={() => onOpenRecord(r, tableForSource(r.escalation_source))}>
                    <td style={{ fontSize: 11 }}>{formatDateTime(row.report_completed_date)}</td>
                    <td style={{ fontSize: 11 }}>{r.escalation_source}</td>
                    <td style={{ fontSize: 11 }}>{String(row.analyst_email ?? "-")}</td>
                    <td style={{ fontSize: 11 }}>{String(row.error_category ?? "-")}</td>
                    <td style={{ fontSize: 11 }}>{String(row.error_breakdown ?? "-")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {records && (
            <div className="mt-2" style={{ fontSize: 11, color: "var(--muted)" }}>
              Showing {records.rows.length} of {records.total.toLocaleString("en-IN")}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * DOC Raw view — every processed DOC task (audited or not), from
 * onfido_doc_raw. Distinct from the Quality tab (which only ever sees
 * *audited* tasks) — this is the real total-volume/AHT/escalation-rate
 * source, same as the old dashboard's own "DOC Raw" sheet.
 */
function DocRawView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<DocRawDimension>("ims_client_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "doc-raw-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: DocRawOverview }>(`/api/onfido-process/doc-raw/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "doc-raw-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: DocRawTrendPoint[] }>(`/api/onfido-process/doc-raw/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "doc-raw-breakdown", range, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: DocRawBreakdownRow[] }>(`/api/onfido-process/doc-raw/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const dimLabel = { ims_client_name: "Client", tl_name: "TL", am_name: "AM", task_type: "Task Type" }[dimension];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiPlain kpi={ov.taskCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.avgAht} kc="var(--teal)" />
          <KpiPlain kpi={ov.escalationRate} kc="var(--red)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>DOC Raw Volume Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">Every processed DOC task, audited or not — real task count per bucket.</div>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="taskCount" name="Tasks" fill="var(--blue)" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="taskCount" position="top" fontSize={10} fill="var(--muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <h3>DOC Avg AHT Trend</h3>
        <div className="oc-card-sub">Average handling time per bucket, excluding process_labelling_document_raw_extraction task type.</div>
        <TaskAhtTrendChart points={points} barLabel="DOC Tasks" lineLabel="DOC Avg AHT" barColor="var(--blue)" lineColor="var(--teal)" />
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[
              { key: "ims_client_name", label: "Client Wise" }, { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
              { key: "task_type", label: "Task Type Wise" },
            ]}
          />
        </div>
        <div className="oc-card-sub">Top 50 by task count. Click a row for its raw records.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabel}</th><th className="oc-right">Tasks</th><th className="oc-right">Avg AHT</th><th className="oc-right">Escalation Rate</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
                  <td>{r.label}</td>
                  <td className="oc-right">{r.taskCount.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.avgAht !== null ? `${r.avgAht}s` : "—"}</td>
                  <td className="oc-right">{r.escalationRate !== null ? `${r.escalationRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`DOC Raw — ${dimLabel}`}
          tableKey="ONFIDO_DOC_RAW"
          filterColumn={dimension}
          filterValue={drilldown.label}
          range={range}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

/** Green < 1.0%, orange 1.0-1.5%, red >= 1.5% — the reference dashboard's own
 *  POA quality thresholds (peCol/xpCol in buildGroupedTable). */
function poaCellColor(pct: number | null): string {
  if (pct === null) return "var(--muted)";
  return pct >= 1.5 ? "var(--red)" : pct >= 1.0 ? "var(--orange)" : "var(--green)";
}

/** Entity x month grouped table (AM/TL/Analyst Wise POA tables, 2026-09-17
 *  feedback) — each month spans 4 sub-columns (Task/AHT/POA Err%/Ext POA%),
 *  mirroring the reference dashboard's buildGroupedTable(). */
function PoaEntityMonthTable({ title, months, rows, entityLabel, onRowClick }: {
  title: string; months: string[]; rows: PoaEntityMonthRow[]; entityLabel: string;
  onRowClick?: (entity: string) => void;
}) {
  return (
    <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
      <h3>{title}</h3>
      {months.length === 0 || rows.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th rowSpan={2} style={{ textAlign: "left", position: "sticky", left: 0, background: "var(--card)", zIndex: 2 }}>{entityLabel}</th>
                {months.map((mo) => (
                  <th key={mo} colSpan={4} style={{ textAlign: "center", borderLeft: "1px solid var(--border)" }}>{mo}</th>
                ))}
              </tr>
              <tr>
                {months.map((mo) => (
                  <Fragment key={mo}>
                    <th style={{ borderLeft: "1px solid var(--border)", fontSize: 10 }}>Task</th>
                    <th style={{ fontSize: 10 }}>AHT</th>
                    <th style={{ fontSize: 10 }}>POA Err%</th>
                    <th style={{ fontSize: 10 }}>Ext POA%</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entity} className={onRowClick ? "oc-row-click" : undefined} onClick={() => onRowClick?.(r.entity)}>
                  <td style={{ textAlign: "left", position: "sticky", left: 0, background: "var(--card)", fontWeight: 600 }}>
                    {r.entity.split("@")[0]}
                  </td>
                  {months.map((mo) => {
                    const c = r.byMonth[mo];
                    return (
                      <Fragment key={mo}>
                        <td className="oc-right" style={{ borderLeft: "1px solid var(--border)" }}>{c ? c.taskCount.toLocaleString("en-IN") : "–"}</td>
                        <td className="oc-right">{c?.avgAht != null ? `${c.avgAht}s` : "–"}</td>
                        <td className="oc-right" style={{ color: poaCellColor(c?.poaErrPct ?? null), fontWeight: 700 }}>
                          {c?.poaErrPct != null ? `${c.poaErrPct}%` : "–"}
                        </td>
                        <td className="oc-right" style={{ color: poaCellColor(c?.extPoaErrPct ?? null), fontWeight: 700 }}>
                          {c?.extPoaErrPct != null ? `${c.extPoaErrPct}%` : "–"}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Day-wise POA detail — 9 columns (2026-09-17 feedback item #5). */
function PoaDayWiseTable({ rows }: { rows: PoaDayRow[] }) {
  return (
    <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
      <h3>Day-wise POA Detail</h3>
      {rows.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 420 }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th>Date</th><th className="oc-right">POA Task</th><th className="oc-right">POA AHT</th>
                <th className="oc-right">POA Audits</th><th className="oc-right">POA Error</th><th className="oc-right">POA Err%</th>
                <th className="oc-right">Ext POA Audits</th><th className="oc-right">Ext POA Error</th><th className="oc-right">Ext POA%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  <td className="oc-right">{r.taskCount.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.avgAht != null ? `${r.avgAht}s` : "–"}</td>
                  <td className="oc-right">{r.poaAudits.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.poaErrors.toLocaleString("en-IN")}</td>
                  <td className="oc-right" style={{ color: poaCellColor(r.poaErrPct), fontWeight: 700 }}>{r.poaErrPct != null ? `${r.poaErrPct}%` : "–"}</td>
                  <td className="oc-right">{r.extPoaAudits.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.extPoaErrors.toLocaleString("en-IN")}</td>
                  <td className="oc-right" style={{ color: poaCellColor(r.extPoaErrPct), fontWeight: 700 }}>{r.extPoaErrPct != null ? `${r.extPoaErrPct}%` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * POA view — POA Raw + POA Trial for volume/AHT, POA Quality for error
 * rates. Three separate tables with no row-level link between them, merged
 * by TL/AM label in application code (same reasoning as the backend's own
 * comment on getPoaBreakdown) — so the breakdown drill-down opens the POA
 * Raw records specifically (the volume source), not a blended view.
 */
type PoaSubView = "internal" | "external";

/** Combines the POA (internal raw data) and POA External Dashboard views into one tab with a
 *  slicer to switch between them (2026-09-18 feedback) -- they were two separate top-level tabs
 *  covering the same POA queue from two different data sources, which made it easy to miss that
 *  the "other" POA view existed at all. */
function PoaCombinedView(props: {
  range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void;
}) {
  const [subView, setSubView] = useState<PoaSubView>("internal");
  return (
    <div className="space-y-4">
      <PillGroup
        value={subView}
        onChange={setSubView}
        options={[{ key: "internal", label: "POA (Internal)" }, { key: "external", label: "POA External" }]}
      />
      {subView === "internal"
        ? <PoaFormatPage kind="internal" {...props} legacy={<PoaView {...props} />} legacyTitle="Month-wise trends & previous POA layout" legacyOpen />
        : <PoaFormatPage kind="external" {...props} legacy={<PoaExternalView {...props} />} legacyTitle="Previous POA External layout" />}
    </div>
  );
}

/** POA Internal / External / Trail pages in the reference "Central Dashboard" format (2026-09-18
 *  feedback: "I need the same"). The earlier layout is kept underneath, not deleted, so nothing
 *  that was reachable before disappears. */
function PoaFormatPage({
  kind, range, tlFilter, amFilter, onOpenRecord, legacy, legacyTitle, legacyOpen,
}: {
  kind: "internal" | "external" | "trail";
  range: { from: string; to: string }; tlFilter: string; amFilter: string;
  onOpenRecord: (r: RawRecord, table: string) => void;
  legacy: React.ReactNode; legacyTitle: string; legacyOpen?: boolean;
}) {
  const [drill, setDrill] = useState<PoaDrill | null>(null);
  const pageProps = { range, tlFilter, amFilter, onDrill: setDrill };
  return (
    <div className="space-y-4">
      {kind === "internal" && <PoaInternalPage {...pageProps} />}
      {kind === "external" && <PoaExternalPage {...pageProps} />}
      {kind === "trail" && <PoaTrailPage {...pageProps} />}
      {drill && (
        <BreakdownDrilldownSheet
          open={!!drill}
          title={drill.title}
          tableKey={drill.table}
          filterColumn={drill.filterColumn}
          filterValue={drill.filterValue}
          range={range}
          onOpenChange={(v) => { if (!v) setDrill(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
      <details className="oc-card" open={legacyOpen} style={{ "--hc": "var(--muted)" } as React.CSSProperties}>
        <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>{legacyTitle}</summary>
        <div className="space-y-4" style={{ marginTop: 12 }}>{legacy}</div>
      </details>
    </div>
  );
}

function PoaView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<PoaDimension>("tl_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string; column: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "poa-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaOverview }>(`/api/onfido-process/poa/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "poa-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: PoaTrendPoint[] }>(`/api/onfido-process/poa/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "poa-breakdown", range, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaBreakdownRow[] }>(`/api/onfido-process/poa/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });
  // Month-wise "Task & AHT + Int/Ext Err%" section (2026-09-17 feedback, POA page)
  // — Ext POA Err% comes from the separate POA External Dashboard table.
  const poaExternalOverviewQuery = useQuery({
    queryKey: ["onfido-process", "poa-external-overview-for-poa", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaExternalOverview }>(`/api/onfido-process/poa-external/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const poaCombinedTrendQuery = useQuery({
    queryKey: ["onfido-process", "poa-combined-trend", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: DocRawTrendPoint[] }>(`/api/onfido-process/poa/combined-trend?from=${range.from}&to=${range.to}${qs}&granularity=monthly`),
  });
  const poaWeeklyTrendQuery = useQuery({
    queryKey: ["onfido-process", "poa-weekly-trend", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: DocRawTrendPoint[] }>(`/api/onfido-process/poa/combined-trend?from=${range.from}&to=${range.to}${qs}&granularity=weekly`),
  });
  const poaDailyTrendQuery = useQuery({
    queryKey: ["onfido-process", "poa-daily-trend", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: DocRawTrendPoint[] }>(`/api/onfido-process/poa/combined-trend?from=${range.from}&to=${range.to}${qs}&granularity=daily`),
  });
  const poaQualityTrendQuery = useQuery({
    queryKey: ["onfido-process", "poa-quality-trend-for-poa", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: QualityTrendPoint[] }>(`/api/onfido-process/poa/quality-trend?from=${range.from}&to=${range.to}${qs}`),
  });
  const poaExternalTrendQuery = useQuery({
    queryKey: ["onfido-process", "poa-external-trend-for-poa", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaExternalTrendPoint[] }>(`/api/onfido-process/poa-external/trend?from=${range.from}&to=${range.to}${qs}`),
  });
  const poaSlaMetricsQuery = useQuery({
    queryKey: ["onfido-process", "poa-sla-metrics", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaSlaMetrics }>(`/api/onfido-process/poa/sla-metrics?from=${range.from}&to=${range.to}${qs}`),
  });
  // Entity x month grouped tables (AM/TL/Analyst Wise) + day-wise detail —
  // company-wide (no tl/am filter), matching the reference dashboard's own tables.
  const amGridQuery = useQuery({
    queryKey: ["onfido-process", "poa-entity-grid-am", range],
    queryFn: () => hrmsApi.get<{ data: { months: string[]; rows: PoaEntityMonthRow[] } }>(`/api/onfido-process/poa/entity-month-grid/am_name?from=${range.from}&to=${range.to}`),
  });
  const tlGridQuery = useQuery({
    queryKey: ["onfido-process", "poa-entity-grid-tl", range],
    queryFn: () => hrmsApi.get<{ data: { months: string[]; rows: PoaEntityMonthRow[] } }>(`/api/onfido-process/poa/entity-month-grid/tl_name?from=${range.from}&to=${range.to}`),
  });
  const analystGridQuery = useQuery({
    queryKey: ["onfido-process", "poa-entity-grid-analyst", range],
    queryFn: () => hrmsApi.get<{ data: { months: string[]; rows: PoaEntityMonthRow[] } }>(`/api/onfido-process/poa/entity-month-grid/analyst_email?from=${range.from}&to=${range.to}`),
  });
  const dayDetailQuery = useQuery({
    queryKey: ["onfido-process", "poa-day-detail", range],
    queryFn: () => hrmsApi.get<{ data: PoaDayRow[] }>(`/api/onfido-process/poa/day-detail?from=${range.from}&to=${range.to}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const dimLabel = { tl_name: "TL", am_name: "AM" }[dimension];
  const poaCombinedTrend = poaCombinedTrendQuery.data?.data ?? [];
  const poaWeeklyTrend = poaWeeklyTrendQuery.data?.data ?? [];
  const poaDailyTrend = poaDailyTrendQuery.data?.data ?? [];
  const poaMonthlyErrPct = useMemo(() => {
    const byBucket = new Map<string, { bucket: string; intErrPct: number | null; extErrPct: number | null }>();
    for (const r of poaQualityTrendQuery.data?.data ?? []) {
      byBucket.set(r.bucket, { bucket: r.bucket, intErrPct: r.errorRate, extErrPct: null });
    }
    for (const r of poaExternalTrendQuery.data?.data ?? []) {
      const existing = byBucket.get(r.bucket) ?? { bucket: r.bucket, intErrPct: null, extErrPct: null };
      existing.extErrPct = r.taskCount > 0 ? Math.round((r.errorCount / r.taskCount) * 1000) / 10 : null;
      byBucket.set(r.bucket, existing);
    }
    return [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  }, [poaQualityTrendQuery.data, poaExternalTrendQuery.data]);

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <KpiPlain kpi={ov.taskCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.avgAht} kc="var(--teal)" />
          <KpiPlain kpi={ov.errorRate} kc="var(--red)" />
          {poaExternalOverviewQuery.data?.data && <KpiPlain kpi={poaExternalOverviewQuery.data.data.errorRate} kc="var(--orange)" />}
        </div>
      )}
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiPlain kpi={ov.classificationErrorRate} kc="var(--purple)" />
          <KpiPlain kpi={ov.extractionErrorRate} kc="var(--purple)" />
          <KpiPlain kpi={ov.dataComparisonErrorRate} kc="var(--purple)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <h3>Month-wise POA Task &amp; AHT</h3>
        <TaskAhtTrendChart points={poaCombinedTrend} barLabel="POA Tasks" lineLabel="POA Avg AHT" barColor="var(--blue)" lineColor="var(--orange)" />
      </div>
      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <h3>Week-wise POA Task &amp; AHT</h3>
        <TaskAhtTrendChart points={poaWeeklyTrend} barLabel="POA Tasks" lineLabel="POA Avg AHT" barColor="var(--teal)" lineColor="var(--orange)" />
      </div>
      <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
        <h3>Day-wise POA Task &amp; AHT</h3>
        <TaskAhtTrendChart points={poaDailyTrend} barLabel="POA Tasks" lineLabel="POA Avg AHT" barColor="var(--purple)" lineColor="var(--orange)" />
      </div>

      {/* POA SLA Section */}
      {(() => {
        const sla = poaSlaMetricsQuery.data?.data;
        if (!sla && !poaSlaMetricsQuery.isLoading) return null;
        return (
          <>
            <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
              <h3>POA SLA</h3>
              <div className="oc-card-sub">SLA compliance based on manual processing time from POA Raw reports.</div>
              {poaSlaMetricsQuery.isLoading ? (
                <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>Loading…</div>
              ) : sla && (
                <>
                  <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: 8 }}>
                    {[
                      { label: "SLA < 10 Min", value: sla.sla10Pct, sub: `${sla.sla10.toLocaleString("en-IN")} cases`, target: "Target 97.5%", color: "var(--teal)" },
                      { label: "SLA < 20 Min", value: sla.sla20Pct, sub: `${sla.sla20.toLocaleString("en-IN")} cases`, target: "", color: "var(--blue)" },
                      { label: "SLA < 30 Min", value: sla.sla30Pct, sub: `${sla.sla30.toLocaleString("en-IN")} cases`, target: "Target 99.5%", color: "var(--orange)" },
                      { label: "> 30 Min Risk", value: sla.gt30Pct, sub: `${sla.gt30.toLocaleString("en-IN")} cases`, target: "SLA leakage", color: "var(--red)" },
                    ].map((k) => (
                      <div key={k.label} className="oc-kpi-plain" style={{ "--kc": k.color } as React.CSSProperties}>
                        <div className="oc-kpi-label">{k.label}</div>
                        <div className="oc-kpi-value">{k.value !== null ? `${k.value}%` : "—"}</div>
                        <div className="oc-kpi-note">{k.sub}</div>
                        {k.target && <div className="oc-kpi-note" style={{ color: "var(--muted)", fontSize: 10 }}>{k.target}</div>}
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>SLA Bucket Split</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={sla.buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted)" }} />
                        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} tick={{ fontSize: 10, fill: "var(--muted)" }} />
                        <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
                        <Bar dataKey="count" name="Count" fill="var(--teal)" radius={[4, 4, 0, 0]}>
                          <LabelList dataKey="count" position="top" fontSize={10} fill="var(--muted)" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Day-wise SLA Trend</div>
                      <div style={{ overflowX: "auto", maxHeight: 220, overflowY: "auto" }}>
                        <table className="oc-table" style={{ fontSize: 11 }}>
                          <thead><tr><th>Date</th><th className="oc-right">Total</th><th className="oc-right">SLA&lt;10%</th><th className="oc-right">SLA&lt;30%</th></tr></thead>
                          <tbody>
                            {sla.dailyTrend.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>No data</td></tr>}
                            {sla.dailyTrend.map((r) => (
                              <tr key={r.date}>
                                <td>{r.date}</td>
                                <td className="oc-right">{r.total.toLocaleString("en-IN")}</td>
                                <td className="oc-right">{r.sla10Pct !== null ? `${r.sla10Pct}%` : "—"}</td>
                                <td className="oc-right">{r.sla30Pct !== null ? `${r.sla30Pct}%` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Week-wise SLA Trend</div>
                      <div style={{ overflowX: "auto", maxHeight: 220, overflowY: "auto" }}>
                        <table className="oc-table" style={{ fontSize: 11 }}>
                          <thead><tr><th>Week</th><th className="oc-right">Total</th><th className="oc-right">SLA&lt;10%</th><th className="oc-right">SLA&lt;30%</th></tr></thead>
                          <tbody>
                            {sla.weeklyTrend.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>No data</td></tr>}
                            {sla.weeklyTrend.map((r) => (
                              <tr key={r.bucket}>
                                <td>{r.bucket}</td>
                                <td className="oc-right">{r.total.toLocaleString("en-IN")}</td>
                                <td className="oc-right">{r.sla10Pct !== null ? `${r.sla10Pct}%` : "—"}</td>
                                <td className="oc-right">{r.sla30Pct !== null ? `${r.sla30Pct}%` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Analyst-wise SLA</div>
                    <div style={{ overflowX: "auto", maxHeight: 280, overflowY: "auto" }}>
                      <table className="oc-table" style={{ fontSize: 11 }}>
                        <thead><tr><th>Analyst</th><th>TL</th><th className="oc-right">Volume</th><th className="oc-right">SLA&lt;10%</th><th className="oc-right">SLA&lt;30%</th><th className="oc-right">Avg AHT</th></tr></thead>
                        <tbody>
                          {sla.analystRows.length === 0 && <tr className="oc-empty-row"><td colSpan={6}>No data</td></tr>}
                          {sla.analystRows.map((r) => (
                            <tr key={r.analyst}>
                              <td>{r.analyst}</td>
                              <td>{r.tlName ?? "—"}</td>
                              <td className="oc-right">{r.volume.toLocaleString("en-IN")}</td>
                              <td className="oc-right">{r.sla10Pct !== null ? `${r.sla10Pct}%` : "—"}</td>
                              <td className="oc-right">{r.sla30Pct !== null ? `${r.sla30Pct}%` : "—"}</td>
                              <td className="oc-right">{r.avgAht !== null ? `${r.avgAht}s` : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        );
      })()}

      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <h3>Month-wise POA Error % — Internal vs External</h3>
        {poaMonthlyErrPct.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={poaMonthlyErrPct} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: number) => `${v}%`} />
              <RTooltip content={<DarkTooltip />} />
              <Legend verticalAlign="top" align="left" height={28} iconType="line" wrapperStyle={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }} />
              <Line type="monotone" dataKey="intErrPct" name="POA Err% (Internal)" stroke="var(--red)" strokeWidth={2} dot={{ r: 3 }} connectNulls>
                <LabelList dataKey="intErrPct" position="top" fontSize={10} fontWeight={700} fill="var(--red)" formatter={(v: number | null) => (v == null ? "" : `${v}%`)} />
              </Line>
              <Line type="monotone" dataKey="extErrPct" name="Ext POA Err%" stroke="var(--orange)" strokeWidth={2} dot={{ r: 3 }} connectNulls>
                <LabelList dataKey="extErrPct" position="bottom" fontSize={10} fontWeight={700} fill="var(--orange)" formatter={(v: number | null) => (v == null ? "" : `${v}%`)} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>POA Volume Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">POA Raw + POA Trial reports combined — real task count per bucket.</div>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="taskCount" name="Reports" fill="var(--blue)" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="taskCount" position="top" fontSize={10} fill="var(--muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[{ key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" }]}
          />
        </div>
        <div className="oc-card-sub">Volume from POA Raw + Trial, error rate from POA Quality. Click a row for the raw POA reports behind it.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabel}</th><th className="oc-right">Reports</th><th className="oc-right">Avg AHT</th><th className="oc-right">Error Rate</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label, column: dimension })}>
                  <td>{r.label}</td>
                  <td className="oc-right">{r.taskCount.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.avgAht !== null ? `${r.avgAht}s` : "—"}</td>
                  <td className="oc-right">{r.errorRate !== null ? `${r.errorRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PoaEntityMonthTable
        title="AM Wise — Month-wise POA Detail"
        entityLabel="AM"
        months={amGridQuery.data?.data.months ?? []}
        rows={amGridQuery.data?.data.rows ?? []}
        onRowClick={(entity) => setDrilldown({ label: entity, column: "am_name" })}
      />
      <PoaEntityMonthTable
        title="TL Wise — Month-wise POA Detail"
        entityLabel="TL"
        months={tlGridQuery.data?.data.months ?? []}
        rows={tlGridQuery.data?.data.rows ?? []}
        onRowClick={(entity) => setDrilldown({ label: entity, column: "tl_name" })}
      />
      <PoaEntityMonthTable
        title="Analyst Wise — Month-wise POA Detail (Top 50)"
        entityLabel="Analyst"
        months={analystGridQuery.data?.data.months ?? []}
        rows={analystGridQuery.data?.data.rows ?? []}
        onRowClick={(entity) => setDrilldown({ label: entity, column: "analyst_email" })}
      />
      <PoaDayWiseTable rows={dayDetailQuery.data?.data ?? []} />

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`POA Raw — ${drilldown.column}`}
          tableKey="ONFIDO_POA_RAW"
          filterColumn={drilldown.column}
          filterValue={drilldown.label}
          range={range}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

function PoaTrialView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<PoaTrialDimension>("tl_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "poa-trial-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaTrialOverview }>(`/api/onfido-process/poa-trial/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "poa-trial-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: PoaTrialTrendPoint[] }>(`/api/onfido-process/poa-trial/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "poa-trial-breakdown", range, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaTrialBreakdownRow[] }>(`/api/onfido-process/poa-trial/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const dimLabel = { tl_name: "TL", am_name: "AM" }[dimension];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiPlain kpi={ov.taskCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.avgAht} kc="var(--teal)" />
          <KpiPlain kpi={ov.considerRate} kc="var(--orange)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>POA Trial Volume Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">onfido_poa_trial_raw only — not combined with POA Raw.</div>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="taskCount" name="Reports" fill="var(--blue)" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="taskCount" position="top" fontSize={10} fill="var(--muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[{ key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" }]}
          />
        </div>
        <div className="oc-card-sub">Click a row for the raw POA Trial reports behind it.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabel}</th><th className="oc-right">Reports</th><th className="oc-right">Avg AHT</th><th className="oc-right">Consider Rate</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
                  <td>{r.label}</td>
                  <td className="oc-right">{r.taskCount.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.avgAht !== null ? `${r.avgAht}s` : "—"}</td>
                  <td className="oc-right">{r.considerRate !== null ? `${r.considerRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`POA Trial — ${dimLabel}`}
          tableKey="ONFIDO_POA_TRIAL_RAW"
          filterColumn={dimension}
          filterValue={drilldown.label}
          range={range}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

/**
 * Item #6 of the 2026-09-12 client feedback: "DOC Check and POA Client and
 * document wise need report" — a Document Name filter, month/week trend, and
 * a Client Name / Task / AHT breakdown. DOC and POA are two physically
 * separate raw tables (onfido_doc_raw, onfido_poa_raw), same UNION-with-a-tag
 * shape as EscalationsView above — "Task" in the breakdown table is which
 * queue the row came from (DOC or POA), the one dimension the client's own
 * request can actually mean given DOC's own per-row task-type field is blank
 * on 99.9% of rows (see the backend's getClientDocBreakdown comment).
 */
type ClientDocQueue = "DOC" | "POA";
type ClientDocGroupBy = "document" | "client";
interface ClientDocSeriesPoint { bucket: string; taskCount: number; avgAht: number | null }
interface ClientDocRankingRow { label: string; taskCount: number; avgAht: number | null }
interface ClientDocOptions { taskTypes: string[]; clients: string[]; documents: string[] }
interface ClientDocDrill { queue: ClientDocQueue; clientName?: string; documentName?: string; taskType?: string }

function ClientDocView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [queue, setQueue] = useState<ClientDocQueue>("DOC");
  const [drilldown, setDrilldown] = useState<ClientDocDrill | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

  const optionsQuery = useQuery({
    queryKey: ["onfido-process", "clientdoc-options", range, queue],
    queryFn: () => hrmsApi.get<{ data: ClientDocOptions }>(`/api/onfido-process/client-doc/options?from=${range.from}&to=${range.to}&queue=${queue}`),
    staleTime: 5 * 60_000,
  });
  const options = optionsQuery.data?.data ?? { taskTypes: [], clients: [], documents: [] };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="oc-eyebrow">Queue</span>
        <PillGroup value={queue} onChange={setQueue} options={[{ key: "DOC", label: "DOC Check" }, { key: "POA", label: "POA" }]} />
      </div>

      <ClientDocSection
        key={`document-${queue}`} groupBy="document" queue={queue} range={range} qs={qs} options={options}
        onDrill={(d) => setDrilldown(d)}
      />
      <ClientDocSection
        key={`client-${queue}`} groupBy="client" queue={queue} range={range} qs={qs} options={options}
        onDrill={(d) => setDrilldown(d)}
      />

      {drilldown && (
        <ClientDocDrilldownSheet
          open={!!drilldown}
          clientName={drilldown.clientName}
          task={drilldown.queue}
          documentName={drilldown.documentName ?? ""}
          taskType={drilldown.taskType}
          range={range}
          tlFilter={tlFilter}
          amFilter={amFilter}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

/** One "Document-wise" or "Client-wise" block: pick a document/client and (DOC only) a task type,
 *  choose Monthly/Weekly, see Task volume (bars) and AHT (line) with data labels, plus a ranking. */
function ClientDocSection({
  groupBy, queue, range, qs, options, onDrill,
}: {
  groupBy: ClientDocGroupBy; queue: ClientDocQueue; range: { from: string; to: string }; qs: string;
  options: ClientDocOptions; onDrill: (d: ClientDocDrill) => void;
}) {
  const [value, setValue] = useState("");
  const [taskType, setTaskType] = useState("");
  const [granularity, setGranularity] = useState<"monthly" | "weekly">("monthly");
  const isDoc = groupBy === "document";
  const noun = isDoc ? "Document" : "Client";
  const choices = isDoc ? options.documents : options.clients;
  const filterQS = `&queue=${queue}&groupBy=${groupBy}${value ? `&value=${encodeURIComponent(value)}` : ""}${taskType ? `&taskType=${encodeURIComponent(taskType)}` : ""}`;

  const seriesQuery = useQuery({
    queryKey: ["onfido-process", "clientdoc-series", range, qs, queue, groupBy, value, taskType, granularity],
    queryFn: () => hrmsApi.get<{ data: ClientDocSeriesPoint[] }>(`/api/onfido-process/client-doc/series?from=${range.from}&to=${range.to}${qs}${filterQS}&granularity=${granularity}`),
  });
  const rankingQuery = useQuery({
    queryKey: ["onfido-process", "clientdoc-ranking", range, qs, queue, groupBy, taskType],
    queryFn: () => hrmsApi.get<{ data: ClientDocRankingRow[] }>(`/api/onfido-process/client-doc/ranking?from=${range.from}&to=${range.to}${qs}&queue=${queue}&groupBy=${groupBy}${taskType ? `&taskType=${encodeURIComponent(taskType)}` : ""}`),
  });
  const points = seriesQuery.data?.data ?? [];
  const ranking = rankingQuery.data?.data ?? [];
  const hc = isDoc ? "var(--blue)" : "var(--teal)";
  const scopeText = [value || `All ${noun.toLowerCase()}s`, taskType ? prettyTaskType(taskType) : null].filter(Boolean).join(" · ");

  return (
    <div className="oc-card" style={{ "--hc": hc } as React.CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 style={{ marginBottom: 0 }}>{noun}-wise Task &amp; AHT — {queue === "DOC" ? "DOC Check" : "POA"}</h3>
        <PillGroup
          value={granularity} onChange={setGranularity}
          options={[{ key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
        />
      </div>
      <div className="oc-filterbar" style={{ marginTop: 8 }}>
        <div className="oc-field">
          <label>{noun} Name</label>
          <select className="oc-select" style={{ minWidth: 220 }} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">All {noun.toLowerCase()}s</option>
            {choices.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {queue === "DOC" && (
          <div className="oc-field">
            <label>Task Type</label>
            <select className="oc-select" style={{ minWidth: 220 }} value={taskType} onChange={(e) => setTaskType(e.target.value)}>
              <option value="">All task types</option>
              {options.taskTypes.map((t) => <option key={t} value={t}>{prettyTaskType(t)}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="oc-card-sub">{scopeText} · {range.from} to {range.to}</div>

      {points.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
          {seriesQuery.isLoading ? "Loading…" : "No data in this range."}
        </div>
      ) : (
        <TaskAhtTrendChart points={points} barLabel={`${queue} Tasks`} lineLabel={`${queue} Avg AHT`} barColor={hc} lineColor="var(--orange)" />
      )}

      <div style={{ overflowX: "auto", maxHeight: 420, marginTop: 8 }}>
        <table className="oc-table">
          <thead><tr><th>{noun} Name</th><th className="oc-right">Tasks</th><th className="oc-right">Avg AHT</th></tr></thead>
          <tbody>
            {ranking.length === 0 && <tr className="oc-empty-row"><td colSpan={3}>{rankingQuery.isLoading ? "Loading…" : "No data"}</td></tr>}
            {ranking.map((r) => (
              <tr
                key={r.label} className="oc-row-click"
                onClick={() => {
                  if (isDoc && r.label === "(unspecified)") return; // no document name to filter records by
                  onDrill(isDoc
                    ? { queue, documentName: r.label, taskType: taskType || undefined }
                    : { queue, clientName: r.label, taskType: taskType || undefined });
                }}
              >
                <td>{r.label}</td>
                <td className="oc-right">{r.taskCount.toLocaleString("en-IN")}</td>
                <td className="oc-right">{r.avgAht !== null ? `${r.avgAht}s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="oc-card-sub" style={{ marginTop: 6 }}>Top 200 by volume. Click a row for the underlying reports.</div>
    </div>
  );
}

/**
 * ClientDocView's own drill-down sheet — same reasoning as
 * EscalationDrilldownSheet: DOC and POA are two physically separate tables,
 * so this hits the dedicated /client-doc/records endpoint rather than the
 * generic single-table /records/:table route. Each row carries a ready-to-use
 * upload-type-code (`source_table`), so the row click opens the same shared
 * RecordDrawer via onOpenRecord with no extra mapping step.
 */
function ClientDocDrilldownSheet({
  open, clientName, task, documentName, taskType, range, tlFilter, amFilter, onOpenChange, onOpenRecord,
}: {
  open: boolean; clientName?: string; task: "DOC" | "POA"; documentName: string; taskType?: string;
  range: { from: string; to: string }; tlFilter: string; amFilter: string;
  onOpenChange: (v: boolean) => void; onOpenRecord: (record: RawRecord, table: string) => void;
}) {
  const qs = tlAmQS(tlFilter, amFilter);
  const docQS = documentName ? `&documentName=${encodeURIComponent(documentName)}` : "";
  const recordsQuery = useQuery({
    queryKey: ["onfido-process", "clientdoc-records", clientName, task, documentName, taskType, range, tlFilter, amFilter],
    queryFn: () =>
      hrmsApi.get<{ data: { rows: ClientDocRecordRow[]; total: number } }>(
        `/api/onfido-process/client-doc/records?from=${range.from}&to=${range.to}${qs}${docQS}${clientName !== undefined ? `&clientName=${encodeURIComponent(clientName)}` : ""}${taskType ? `&taskType=${encodeURIComponent(taskType)}` : ""}&task=${task}&limit=100`
      ),
    enabled: open,
  });
  const records = recordsQuery.data?.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 !text-[color:var(--text)]">
            <FileBarChart2 className="h-4 w-4" style={{ color: "var(--muted)" }} /> {clientName ?? documentName} — {task}
          </SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">
            {documentName ? `Document: ${documentName}` : "All documents"}{taskType ? ` · Task type: ${prettyTaskType(taskType)}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <p className="mb-2" style={{ fontSize: 11, color: "var(--muted)" }}>Click a record for its full detail.</p>
          <table className="oc-table">
            <thead><tr><th>Date</th><th>Document</th><th>Analyst</th><th className="oc-right">AHT</th></tr></thead>
            <tbody>
              {(records?.rows ?? []).length === 0 && (
                <tr className="oc-empty-row"><td colSpan={4}>{recordsQuery.isLoading ? "Loading…" : "No records"}</td></tr>
              )}
              {(records?.rows ?? []).map((r) => {
                const row = r as Record<string, unknown>;
                return (
                  <tr key={r.id} className="oc-row-click" onClick={() => onOpenRecord(r, r.source_table)}>
                    <td style={{ fontSize: 11 }}>{formatDateTime(row.report_date ?? row.report_completed_date)}</td>
                    <td style={{ fontSize: 11 }}>{String(row.document_name ?? "(unspecified)")}</td>
                    <td style={{ fontSize: 11 }}>{String(row.analyst_email ?? "-")}</td>
                    <td className="oc-right" style={{ fontSize: 11 }}>
                      {row.manual_processing_time_secs !== null && row.manual_processing_time_secs !== undefined
                        ? `${row.manual_processing_time_secs}s` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {records && (
            <div className="mt-2" style={{ fontSize: 11, color: "var(--muted)" }}>
              Showing {records.rows.length} of {records.total.toLocaleString("en-IN")}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Item #7 of the 2026-09-12 client feedback: "I have shared the POA External
 * Dashboard format kindly update the same. (Required New Format)" — a
 * standalone table (onfido_poa_external_raw), real headers taken directly
 * from the owner's own attachment. Single table, so this can use the generic
 * BreakdownDrilldownSheet/records route the same way DocRawView/PoaView do,
 * unlike ClientDocView/EscalationsView above which UNION two tables.
 */
function PoaExternalView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<PoaExternalDimension>("ims_client_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "poa-external-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaExternalOverview }>(`/api/onfido-process/poa-external/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "poa-external-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: PoaExternalTrendPoint[] }>(`/api/onfido-process/poa-external/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "poa-external-breakdown", range, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: PoaExternalBreakdownRow[] }>(`/api/onfido-process/poa-external/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const dimLabel = { ims_client_name: "Client", tl_name: "TL", am_name: "AM", location: "Location" }[dimension];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <KpiPlain kpi={ov.taskCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.avgAht} kc="var(--teal)" />
          <KpiPlain kpi={ov.errorRate} kc="var(--red)" />
          <KpiPlain kpi={ov.distinctClients} kc="var(--purple)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>POA External Volume &amp; Errors</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">onfido_poa_external_raw only.</div>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="taskCount" name="Reports" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList dataKey="taskCount" position="top" fontSize={10} fill="var(--muted)" />
              </Bar>
              <Bar dataKey="errorCount" name="Errors" fill="var(--red)" radius={[4, 4, 0, 0]} maxBarSize={40}>
                <LabelList dataKey="errorCount" position="top" fontSize={10} fill="var(--muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[
              { key: "ims_client_name", label: "Client Wise" }, { key: "tl_name", label: "TL Wise" },
              { key: "am_name", label: "AM Wise" }, { key: "location", label: "Location" },
            ]}
          />
        </div>
        <div className="oc-card-sub">Top 50 by report count. Click a row for the raw POA External reports behind it.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabel}</th><th className="oc-right">Reports</th><th className="oc-right">Avg AHT</th><th className="oc-right">Error Rate</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
                  <td>{r.label}</td>
                  <td className="oc-right">{r.taskCount.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.avgAht !== null ? `${r.avgAht}s` : "—"}</td>
                  <td className="oc-right">{r.errorRate !== null ? `${r.errorRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`POA External — ${dimLabel}`}
          tableKey="ONFIDO_POA_EXTERNAL_RAW"
          filterColumn={dimension}
          filterValue={drilldown.label}
          range={range}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

const fmtPctRatio = (v: number | null, dp = 1) => (v === null ? "—" : `${(v * 100).toFixed(dp)}%`);
const fmtNum2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const fmtIsoDay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return mon ? `${d}-${mon}-${y.slice(2)}` : iso;
};

/** The client's GD/MCN/SLA/APS sheet as a table: one row per hourly slot plus a highlighted Total row per day. */
function GdMcnDetailTable({ rows, loading, onSelect }: { rows: GdMcnSlaDetailRow[]; loading: boolean; onSelect: (slot: string) => void }) {
  const [viewMode, setViewMode] = useState<"all" | "total">("all");
  const [slotType, setSlotType] = useState<"gmt" | "ist">("gmt");

  const visibleRows = viewMode === "total" ? rows.filter((r) => r.isTotal) : rows;
  const slotLabel = slotType === "gmt" ? "GMT" : "IST";
  const getSlot = (r: GdMcnSlaDetailRow) => slotType === "gmt" ? r.gmt : r.ist;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 10 }}>
        <div className="oc-field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>View</label>
          <select
            className="oc-select"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as "all" | "total")}
            style={{ minWidth: 120 }}
          >
            <option value="all">All Slots</option>
            <option value="total">Total Only (Date-wise)</option>
          </select>
        </div>
        <div className="oc-field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Slot</label>
          <PillGroup
            value={slotType}
            onChange={setSlotType}
            options={[{ key: "gmt", label: "GMT" }, { key: "ist", label: "IST" }]}
          />
        </div>
      </div>
      <div style={{ overflow: "auto", maxHeight: 560 }}>
        <table className="oc-table">
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <th>{slotLabel}</th><th>Date</th>
              <th className="oc-right">GD%</th><th className="oc-right">MCN%</th><th className="oc-right">Deficit</th><th className="oc-right">SLA%</th>
              <th className="oc-right">Doc AHT</th><th className="oc-right">POA AHT</th>
              <th className="oc-right">Commitment</th><th className="oc-right">FTE Delivered</th>
              <th className="oc-right">APS%</th><th className="oc-right">Occupancy%</th><th className="oc-right">Avail%</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && <tr className="oc-empty-row"><td colSpan={13}>{loading ? "Loading…" : "No data in this range"}</td></tr>}
            {visibleRows.map((r, i) => (
              <tr key={`${r.date}-${r.gmt}-${i}`} className="oc-row-click" onClick={() => onSelect(r.gmt)}
                style={r.isTotal ? { fontWeight: 800, background: "rgba(148,163,184,0.12)" } : undefined}>
                <td>{getSlot(r)}</td><td>{fmtIsoDay(r.date)}</td>
                <td className="oc-right">{fmtPctRatio(r.gdPct)}</td>
                <td className="oc-right">{fmtPctRatio(r.mcnPct, 2)}</td>
                <td className="oc-right">{fmtPctRatio(r.deficit)}</td>
                <td className="oc-right">{fmtPctRatio(r.slaPct)}</td>
                <td className="oc-right">{fmtNum2(r.docAht)}</td>
                <td className="oc-right">{fmtNum2(r.poaAht)}</td>
                <td className="oc-right">{r.commitment ?? "—"}</td>
                <td className="oc-right">{r.fteDelivered ?? "—"}</td>
                <td className="oc-right">{fmtPctRatio(r.apsPct, 0)}</td>
                <td className="oc-right">{fmtPctRatio(r.occupancyPct, 2)}</td>
                <td className="oc-right">{fmtPctRatio(r.availPct, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Item #8 of the 2026-09-12 client feedback: "GD MCN SLA APS Day and slot
 * wise performance. (Required New Format)" — a genuinely different data
 * shape from everything else in this dashboard: not per-task records, an
 * hourly staffing/SLA fact table (24 hourly slots + 1 daily "Total" row per
 * day). No TL/AM dimension in this file, so this view is intentionally left
 * out of FILTERABLE_VIEWS — the Executive Filters TL/AM dropdowns correctly
 * hide themselves here rather than doing nothing when changed.
 */
function GdMcnSlaView({
  range, onOpenRecord,
}: { range: { from: string; to: string }; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [drilldown, setDrilldown] = useState<{ slot: string } | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "gd-mcn-sla-overview", range],
    queryFn: () => hrmsApi.get<{ data: GdMcnSlaOverview }>(`/api/onfido-process/gd-mcn-sla/overview?from=${range.from}&to=${range.to}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "gd-mcn-sla-trend", range],
    queryFn: () => hrmsApi.get<{ data: GdMcnSlaTrendPoint[] }>(`/api/onfido-process/gd-mcn-sla/trend?from=${range.from}&to=${range.to}`),
  });
  const slotQuery = useQuery({
    queryKey: ["onfido-process", "gd-mcn-sla-slot-breakdown", range],
    queryFn: () => hrmsApi.get<{ data: GdMcnSlaSlotRow[] }>(`/api/onfido-process/gd-mcn-sla/slot-breakdown?from=${range.from}&to=${range.to}`),
  });
  const detailQuery = useQuery({
    queryKey: ["onfido-process", "gd-mcn-sla-detail", range],
    queryFn: () => hrmsApi.get<{ data: GdMcnSlaDetailRow[] }>(`/api/onfido-process/gd-mcn-sla/detail?from=${range.from}&to=${range.to}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const slots = slotQuery.data?.data ?? [];
  const detailRows = detailQuery.data?.data ?? [];
  const ahtPoints = points.filter((p) => p.docAht != null || p.poaAht != null);

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
          <KpiPlain kpi={ov.avgSlaPct} kc="var(--blue)" />
          <KpiPlain kpi={ov.avgGdPct} kc="var(--teal)" />
          <KpiPlain kpi={ov.avgMcnPct} kc="var(--purple)" />
          <KpiPlain kpi={ov.avgOccupancyPct} kc="var(--orange)" />
          <KpiPlain kpi={ov.avgAvailPct} kc="var(--green)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <h3>Day-Wise Performance</h3>
        <div className="oc-card-sub">Each day's own Total row — SLA% / GD% / MCN% straight from the file, not re-averaged here.</div>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} unit="%" tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="slaPct" name="SLA %" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={30}>
                <LabelList dataKey="slaPct" position="top" fontSize={9} fill="var(--muted)" />
              </Bar>
              <Bar dataKey="gdPct" name="GD %" fill="var(--teal)" radius={[4, 4, 0, 0]} maxBarSize={30}>
                <LabelList dataKey="gdPct" position="top" fontSize={9} fill="var(--muted)" />
              </Bar>
              <Bar dataKey="mcnPct" name="MCN %" fill="var(--purple)" radius={[4, 4, 0, 0]} maxBarSize={30}>
                <LabelList dataKey="mcnPct" position="top" fontSize={9} fill="var(--muted)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {ahtPoints.length > 0 && (
        <div className="oc-card" style={{ "--hc": "var(--orange)" } as React.CSSProperties}>
          <h3>Day-Wise Doc AHT &amp; POA AHT</h3>
          <div className="oc-card-sub">Average handling time (seconds) per day, from each day's Total row.</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={ahtPoints} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={(v: number) => `${v}s`} />
              <RTooltip content={<DarkTooltip />} />
              <Legend verticalAlign="top" align="left" height={28} iconType="line" wrapperStyle={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }} />
              <Line type="monotone" dataKey="docAht" name="Doc AHT" stroke="var(--blue)" strokeWidth={2} dot={{ r: 3 }} connectNulls>
                <LabelList dataKey="docAht" position="bottom" fontSize={10} fontWeight={700} fill="var(--blue)" formatter={(v: number | null) => (v == null ? "" : `${v}s`)} />
              </Line>
              <Line type="monotone" dataKey="poaAht" name="POA AHT" stroke="var(--teal)" strokeWidth={2} dot={{ r: 3 }} connectNulls>
                <LabelList dataKey="poaAht" position="top" fontSize={10} fontWeight={700} fill="var(--teal)" formatter={(v: number | null) => (v == null ? "" : `${v}s`)} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <h3>GD / MCN / SLA / APS Performance</h3>
        <div className="oc-card-sub">Hourly slots with each day's Total row, exactly as in the uploaded sheet. Click a row for its raw record(s).</div>
        <GdMcnDetailTable rows={detailRows} loading={detailQuery.isLoading} onSelect={(slot) => setDrilldown({ slot })} />
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <h3>Slot-Wise Performance</h3>
        <div className="oc-card-sub">Averaged across every day in range — which hour slots are weakest. Click a row for the raw slot records.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>Slot (GMT)</th><th className="oc-right">SLA %</th><th className="oc-right">GD %</th><th className="oc-right">MCN %</th><th className="oc-right">Occupancy %</th></tr></thead>
            <tbody>
              {slots.length === 0 && <tr className="oc-empty-row"><td colSpan={5}>No data</td></tr>}
              {slots.map((r) => (
                <tr key={r.slot} className="oc-row-click" onClick={() => setDrilldown({ slot: r.slot })}>
                  <td>{r.slot}</td>
                  <td className="oc-right">{r.slaPct !== null ? `${r.slaPct}%` : "—"}</td>
                  <td className="oc-right">{r.gdPct !== null ? `${r.gdPct}%` : "—"}</td>
                  <td className="oc-right">{r.mcnPct !== null ? `${r.mcnPct}%` : "—"}</td>
                  <td className="oc-right">{r.occupancyPct !== null ? `${r.occupancyPct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title="GD MCN SLA — Slot"
          tableKey="ONFIDO_GD_MCN_SLA"
          filterColumn="gmt_slot"
          filterValue={drilldown.slot}
          range={range}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}
    </div>
  );
}

/**
 * Live view — deliberately not wired to Executive Filters' date range (see
 * the backend's own comment): it always shows today / this month, the same
 * way the reference dashboard's own Live Dashboard tab does. Every source
 * table here is a batch upload, so this honestly shows zero until a same-day
 * file is uploaded — not a bug, just no data yet for "today".
 */
function LiveView() {
  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "live-overview"],
    queryFn: () => hrmsApi.get<{ data: LiveOverview }>(`/api/onfido-process/live/overview`),
    refetchInterval: 60_000,
  });
  const amQuery = useQuery({
    queryKey: ["onfido-process", "live-doc-breakdown", "am_name"],
    queryFn: () => hrmsApi.get<{ data: LiveBreakdownRow[] }>(`/api/onfido-process/live/doc-breakdown/am_name`),
    refetchInterval: 60_000,
  });
  const tlQuery = useQuery({
    queryKey: ["onfido-process", "live-doc-breakdown", "tl_name"],
    queryFn: () => hrmsApi.get<{ data: LiveBreakdownRow[] }>(`/api/onfido-process/live/doc-breakdown/tl_name`),
    refetchInterval: 60_000,
  });

  const ov = overviewQuery.data?.data;
  const amRows = amQuery.data?.data ?? [];
  const tlRows = tlQuery.data?.data ?? [];

  const barChart = (title: string, rows: LiveBreakdownRow[]) => (
    <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
      <h3>{title}</h3>
      <div className="oc-card-sub">Today's DOC task count &amp; avg handling time.</div>
      {rows.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No DOC tasks uploaded for today yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted)" }} interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
            <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
            <Bar dataKey="taskCount" name="Task" fill="var(--teal)" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="taskCount" position="top" fontSize={10} fill="var(--muted)" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <KpiPlain kpi={ov.docLiveTaskCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.docLiveAht} kc="var(--teal)" />
          <KpiPlain kpi={ov.docLiveAuditCount} kc="var(--purple)" />
          <KpiPlain kpi={ov.docLiveErrorCount} kc="var(--red)" />
        </div>
      )}
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          <KpiPlain kpi={ov.poaLiveTaskCount} kc="var(--orange)" />
          <KpiPlain kpi={ov.poaLiveAht} kc="var(--orange)" />
        </div>
      )}
      {barChart("DOC Live Task & AHT — AM Wise", amRows)}
      {barChart("DOC Live Task & AHT — TL Wise", tlRows)}
    </div>
  );
}

/** Record drill-down drawer — every field the source row carried, per the Drill-Down Mandate. */
function RecordDrawer({
  open, onOpenChange, record, tableName,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; record: RawRecord | null; tableName: string;
}) {
  const rawEntries = record ? Object.entries(record.raw_data ?? {}) : [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 !text-[color:var(--text)]">
            <FileSearch className="h-4 w-4" style={{ color: "var(--muted)" }} /> Record detail
          </SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">{tableName} · {record?.id}</SheetDescription>
        </SheetHeader>
        {record && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="oc-kv-label">Indexed fields</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                {Object.entries(record)
                  .filter(([k]) => !["raw_data", "id"].includes(k))
                  .map(([k, v]) => (
                    <div key={k} className="oc-field-box">
                      <div className="oc-kv-label">{k}</div>
                      <div className="truncate" style={{ color: "var(--text)" }}>
                        {k.includes("date") || k.includes("_at") ? formatDateTime(v) : String(v ?? "-")}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <div>
              <div className="oc-kv-label">Full source row ({rawEntries.length} column(s))</div>
              <div className="mt-2 max-h-[50vh] overflow-y-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
                <table className="oc-table">
                  <tbody>
                    {rawEntries.map(([k, v]) => (
                      <tr key={k}>
                        <td className="w-1/2 align-top" style={{ color: "var(--muted-strong)", fontSize: 11 }}>{k}</td>
                        <td className="break-words" style={{ fontSize: 11 }}>{String(v ?? "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {!record && <div className="mt-4 text-sm" style={{ color: "var(--muted)" }}>None</div>}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Multi-level drill-down for one KPI tile:
 *   Level 1 is the tile itself (already on the page).
 *   Level 2 (this sheet, no TL picked yet) — the same metric broken down by Team Leader.
 *   Level 3 (a TL clicked) — the raw records behind that TL's slice of the metric.
 *   Level 4 (a record clicked) — handed off to the existing RecordDrawer via onOpenRecord.
 */
function MetricDrilldownSheet({
  kpi, range, onOpenChange, onOpenRecord,
}: {
  kpi: KpiValue | null; range: { from: string; to: string };
  onOpenChange: (v: boolean) => void; onOpenRecord: (record: RawRecord, table: string) => void;
}) {
  const [selectedTl, setSelectedTl] = useState<string | null>(null);

  useEffect(() => { setSelectedTl(null); }, [kpi?.key]);

  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "metric-breakdown", kpi?.key, range],
    queryFn: () =>
      hrmsApi.get<{ data: MetricTlRow[] }>(
        `/api/onfido-process/metric-breakdown/${kpi!.key}?from=${range.from}&to=${range.to}`
      ),
    enabled: !!kpi,
  });

  const recordsQuery = useQuery({
    queryKey: ["onfido-process", "metric-records", kpi?.key, selectedTl, range],
    queryFn: () =>
      hrmsApi.get<{ data: { table: string; rows: RawRecord[]; total: number } }>(
        `/api/onfido-process/metric-records/${kpi!.key}?from=${range.from}&to=${range.to}${selectedTl ? `&tlName=${encodeURIComponent(selectedTl)}` : ""}&limit=50`
      ),
    enabled: !!kpi && !!selectedTl,
  });

  const rows = breakdownQuery.data?.data ?? [];
  const records = recordsQuery.data?.data;

  return (
    <Sheet open={!!kpi} onOpenChange={onOpenChange}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 !text-[color:var(--text)]">
            <Layers3 className="h-4 w-4" style={{ color: "var(--muted)" }} /> {kpi?.label}
          </SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
              {kpi?.value !== null && kpi ? formatMetricValue(kpi) : ""}
            </span>
            {kpi?.note ? ` · ${kpi.note}` : ""}
          </SheetDescription>
        </SheetHeader>

        {selectedTl && (
          <button className="oc-btn-ghost mt-3 -ml-1" onClick={() => setSelectedTl(null)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Team Leader breakdown
          </button>
        )}

        {!selectedTl && (
          <div className="mt-4">
            <div className="oc-eyebrow" style={{ marginBottom: 4 }}><Users2 className="h-3.5 w-3.5" /> By Team Leader</div>
            <p className="mb-2" style={{ fontSize: 11, color: "var(--muted)" }}>Click a TL to see the records behind their number.</p>
            <table className="oc-table">
              <thead><tr><th>TL Name</th><th className="oc-right">Value</th></tr></thead>
              <tbody>
                {rows.length === 0 && (
                  <tr className="oc-empty-row"><td colSpan={2}>No data</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.tlName} className="oc-row-click" onClick={() => setSelectedTl(r.tlName)}>
                    <td>
                      <span className="oc-avatar" style={{ background: avatarTone(r.tlName) }}>{initials(r.tlName)}</span>
                      {r.tlName}
                    </td>
                    <td className="oc-right">
                      <div style={{ fontWeight: 700 }}>{r.value ?? "—"}{kpi?.unit === "percent" && r.value !== null ? "%" : ""}</div>
                      {r.note && <div style={{ fontSize: 10, color: "var(--muted)" }}>{r.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedTl && (
          <div className="mt-4">
            <div className="oc-kv-label">Records — {selectedTl}</div>
            <p className="mb-2 mt-1" style={{ fontSize: 11, color: "var(--muted)" }}>Click a record for its full detail.</p>
            <table className="oc-table">
              <thead><tr><th>Date</th><th>Analyst</th><th>Result</th></tr></thead>
              <tbody>
                {(records?.rows ?? []).length === 0 && (
                  <tr className="oc-empty-row"><td colSpan={3}>No records</td></tr>
                )}
                {(records?.rows ?? []).map((r) => (
                  <tr key={r.id} className="oc-row-click" onClick={() => onOpenRecord(r, records!.table)}>
                    <td style={{ fontSize: 11 }}>
                      {formatDateTime((r as Record<string, unknown>).report_date ?? (r as Record<string, unknown>).report_completed_date ?? (r as Record<string, unknown>).task_complete_date)}
                    </td>
                    <td style={{ fontSize: 11 }}>{String((r as Record<string, unknown>).analyst_email ?? "-")}</td>
                    <td style={{ fontSize: 11 }}>{String((r as Record<string, unknown>).overall_result ?? "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records && (
              <div className="mt-2" style={{ fontSize: 11, color: "var(--muted)" }}>
                Showing {records.rows.length} of {records.total.toLocaleString("en-IN")}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

// Local-getter ISO formatting — `.toISOString()` converts to UTC first, which
// silently shifts a local-midnight Date back a day in IST (the same
// host-timezone trap fixed elsewhere in this file's backend counterpart).
// Confirmed live: with today = 6 Sep 2026, the old `iso(first)` (first-of-month
// built via `new Date(y, m, 1)`, then `.toISOString()`) resolved to "2026-08-31",
// not "2026-09-01".
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Defaulting to "1st of this month -> today" looked reasonable but was wrong
// for this dashboard specifically: every Onfido source table is filled by a
// batch upload that lags real time by days to weeks (confirmed live: the most
// recent DOC/POA/CRE/CRQ/Agent-Daily uploads all stop in mid-to-late August
// while "today" is 6 Sep), so the current-month window was almost always
// empty — every KPI across every tab showed "-" on first load, not because
// anything was broken but because the default range itself had zero rows in
// any real table. A trailing 90-day window reliably covers the last real
// upload no matter which day of the month it is opened.
function defaultRange() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 90);
  return { from: isoLocal(start), to: isoLocal(today) };
}

/**
 * `embedded` renders without the app shell, for use inside Process Operations
 * (its only entry point — /onfido-process/dashboard redirects there).
 */
export default function OnfidoProcessDashboard({ embedded = false }: { embedded?: boolean }) {
  const Shell = embedded ? Fragment : DashboardLayout;
  const [view, setView] = useState<ViewKey>("overview");
  const [range, setRange] = useState(defaultRange());
  const [tlFilter, setTlFilter] = useState<string>("");
  const [amFilter, setAmFilter] = useState<string>("");
  const [activeTable, setActiveTable] = useState<string>("ONFIDO_DOC_RAW");
  const [drawerRecord, setDrawerRecord] = useState<RawRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTableName, setDrawerTableName] = useState<string>("");
  const [metricDrilldown, setMetricDrilldown] = useState<KpiValue | null>(null);

  const filterOptionsQuery = useQuery({
    queryKey: ["onfido-process", "filter-options"],
    queryFn: () => hrmsApi.get<{ data: { tlNames: string[]; amNames: string[] } }>("/api/onfido-process/filter-options"),
    staleTime: 5 * 60 * 1000,
  });
  const filterOptions = filterOptionsQuery.data?.data ?? { tlNames: [], amNames: [] };

  function openRecord(record: RawRecord, tableName?: string) {
    setDrawerRecord(record);
    setDrawerTableName(tableName ?? activeTable);
    setDrawerOpen(true);
  }

  return (
    <Shell>
      <div className="onfido-central-theme">
        <div className="space-y-5">
          {/* Header */}
          <div>
            <div className="oc-eyebrow" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>Quality &amp; Operations</div>
            <h1 style={{ marginTop: 4, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>Onfido Process Dashboard</h1>
            <p style={{ marginTop: 4, maxWidth: 720, fontSize: 13, color: "var(--muted)" }}>
              DOC and POA queue volume, AHT, quality audits and client escalations — built from the
              report files uploaded through Bulk Upload Hub.
            </p>
          </div>

          <TabBar view={view} onChange={setView} />

          {/* Executive filters — shared across every view except Live, which is
              deliberately always "today" / "this month" and ignores the range
              entirely (see LiveView/getLiveOverview) — showing date pickers
              that have zero effect there would be misleading, not helpful. */}
          {view !== "live" && view !== "analyst" && view !== "utilization" && view !== "namemapping" && (
          <div className="oc-filterbar">
            <div className="oc-eyebrow" style={{ alignSelf: "center" }}><CalendarRange className="h-3.5 w-3.5" /> Executive Filters</div>
            <div className="oc-field">
              <label>From</label>
              <input type="date" className="oc-input" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            </div>
            <div className="oc-field">
              <label>To</label>
              <input type="date" className="oc-input" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            </div>
            {FILTERABLE_VIEWS.has(view) && (
              <div className="oc-field">
                <label>TL</label>
                <select className="oc-select" style={{ width: 200 }} value={tlFilter} onChange={(e) => setTlFilter(e.target.value)}>
                  <option value="">All TLs</option>
                  {filterOptions.tlNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {FILTERABLE_VIEWS.has(view) && (
              <div className="oc-field">
                <label>AM</label>
                <select className="oc-select" style={{ width: 200 }} value={amFilter} onChange={(e) => setAmFilter(e.target.value)}>
                  <option value="">All AMs</option>
                  {filterOptions.amNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {FILTERABLE_VIEWS.has(view) && (tlFilter || amFilter) && (
              <span className="oc-badge">
                <Users2 className="h-3 w-3" /> {[tlFilter, amFilter].filter(Boolean).join(" · ")}
                <button onClick={() => { setTlFilter(""); setAmFilter(""); }} aria-label="Clear filters">×</button>
              </span>
            )}
          </div>
          )}

          {view === "trends" && <TrendsView range={range} />}
          {view === "alerts" && <AlertsView range={range} />}
          {view === "analyst" && <OnfidoAnalystReport initialRange={{ from: shiftDays(range.to, -29), to: range.to }} />}
          {view === "utilization" && <OnfidoUtilizationReport />}
          {view === "attrition" && <AttritionView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "quality" && <QualityView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "etm" && <EtmView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "taskskip" && <TaskSkipView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "escalations" && <EscalationsView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "docraw" && <DocRawView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "poa" && <PoaCombinedView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "poatrial" && (
            <PoaFormatPage
              kind="trail" range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord}
              legacy={<PoaTrialView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
              legacyTitle="Previous POA Trial layout"
            />
          )}
          {view === "clientdoc" && <ClientDocView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "gdmcnsla" && <GdMcnSlaView range={range} onOpenRecord={openRecord} />}
          {view === "live" && <LiveView />}
          {view === "namemapping" && <OnfidoNameMapping />}

          {view === "overview" && <OnfidoOverviewReport range={range} tlFilter={tlFilter} amFilter={amFilter} />}
        </div>

        <RecordDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          record={drawerRecord}
          tableName={drawerTableName}
        />

        <MetricDrilldownSheet
          kpi={metricDrilldown}
          range={range}
          onOpenChange={(v) => { if (!v) setMetricDrilldown(null); }}
          onOpenRecord={(record, table) => openRecord(record, table)}
        />
      </div>
    </Shell>
  );
}
