import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, ArrowLeft, CalendarRange, Database, FileSearch, FileText, LayoutGrid, Layers3,
  MessageSquareWarning, Radio, Search, ShieldAlert, SkipForward, TrendingDown, TrendingUp, Users2,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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
}

interface TrendPoint { month: string; doc: number; poa: number }

interface TableInfo { key: string; table: string; name: string; description: string }

type RawRecord = Record<string, unknown> & { id: string; raw_data: Record<string, unknown> };

type ViewKey =
  | "overview" | "analyst" | "trends" | "alerts" | "attrition" | "etm" | "taskskip" | "quality"
  | "escalations" | "docraw" | "poa" | "live";
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
interface AttritionBreakdownRow { label: string; attritionCount: number; attritionRate: number | null; ulShrinkageRate: number | null; note?: string }
interface AttritionExitRow {
  id: string;
  empId: string; empName: string; analystEmail: string; tlName: string; amName: string;
  exitDate: string; reason: string | null; attritionType: string | null;
}
type AttritionDimension = "am_name" | "tl_name" | "aon_bucket" | "location";

interface EtmOverview { docCount: KpiValue; poaCount: KpiValue }
interface EtmTrendPoint { bucket: string; doc: number; poa: number }
type EtmQueue = "doc" | "poa";
type EtmDimension = "tl_name" | "am_name" | "escalated_by_email";
interface EtmBreakdownRow { label: string; count: number }

interface TaskSkipOverview { count: KpiValue }
interface TaskSkipTrendPoint { bucket: string; count: number }
interface QualityTrendPoint { bucket: string; taskCount: number; errorRate: number | null }
interface AttritionTrendPoint { bucket: string; attritionCount: number }
type TaskSkipDimension = "tl_name" | "am_name" | "unassigned_from_email" | "ims_client_name" | "task_type";
interface TaskSkipBreakdownRow { label: string; count: number }

interface QualityOverview {
  taskCount: KpiValue; overallErrorRate: KpiValue; farRate: KpiValue; frrRate: KpiValue;
  classificationErrorRate: KpiValue; extractionErrorRate: KpiValue;
  addExtractionErrorRate: KpiValue; rawExtractionErrorRate: KpiValue;
}
type QualityDimension = "ims_client_name" | "docupedia_document_name" | "tl_name" | "am_name";
interface QualityBreakdownRow { label: string; taskCount: number; overallErrorRate: number | null; farRate: number | null; frrRate: number | null }

interface EscalationOverview {
  totalLines: KpiValue; creLines: KpiValue; crqLines: KpiValue; distinctReports: KpiValue;
}
interface EscalationTrendPoint { bucket: string; count: number }
type EscalationDimension = "ims_client_name" | "error_category" | "tl_name" | "am_name";
interface EscalationBreakdownRow { label: string; count: number }

interface DocRawOverview {
  taskCount: KpiValue; avgAht: KpiValue; avgQueueTime: KpiValue; escalationRate: KpiValue;
}
interface DocRawTrendPoint { bucket: string; taskCount: number; avgAht: number | null }
type DocRawDimension = "ims_client_name" | "tl_name" | "am_name";
interface DocRawBreakdownRow { label: string; taskCount: number; avgAht: number | null; escalationRate: number | null }

interface PoaOverview {
  taskCount: KpiValue; avgAht: KpiValue; errorRate: KpiValue;
  classificationErrorRate: KpiValue; extractionErrorRate: KpiValue; dataComparisonErrorRate: KpiValue;
}
interface PoaTrendPoint { bucket: string; taskCount: number }
type PoaDimension = "tl_name" | "am_name";
interface PoaBreakdownRow { label: string; taskCount: number; avgAht: number | null; errorRate: number | null }

interface LiveOverview {
  docLiveTaskCount: KpiValue; docLiveAht: KpiValue; docLiveAuditCount: KpiValue; docLiveErrorCount: KpiValue;
  poaLiveTaskCount: KpiValue; poaLiveAht: KpiValue;
}
type LiveDimension = "tl_name" | "am_name";
interface LiveBreakdownRow { label: string; taskCount: number; avgAht: number | null }

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

/**
 * Monthly volume trend, DOC vs POA — rendered as grouped bars, not a line:
 * with only a handful of monthly buckets (often 1-3 in a filtered range) a
 * line/area implies a continuous trend that isn't there and renders as an
 * orphaned floating point. Bars stay legible at any point count.
 */
function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <div style={{ padding: "40px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No volume in this range yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barGap={4} barCategoryGap={points.length <= 3 ? "35%" : "20%"}>
        <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
        <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
        <Bar dataKey="doc" name="DOC" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        <Bar dataKey="poa" name="POA" fill="var(--teal)" radius={[4, 4, 0, 0]} maxBarSize={48} />
      </BarChart>
    </ResponsiveContainer>
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

/** Views whose backend query actually accepts a TL/AM filter — Trends (company-wide
 *  volume only), Alerts (per-analyst thresholds) and Analyst Performance (its own
 *  search box) don't take one, so the Executive Filters TL/AM dropdowns hide there
 *  rather than silently doing nothing when changed. */
const FILTERABLE_VIEWS = new Set<ViewKey>([
  "overview", "attrition", "quality", "etm", "taskskip", "escalations", "docraw", "poa",
]);

const VIEW_TABS: { key: ViewKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "analyst", label: "Analyst Performance", icon: Users2 },
  { key: "trends", label: "Trends", icon: TrendingUp },
  { key: "alerts", label: "Alerts", icon: AlertTriangle },
  { key: "attrition", label: "Attrition & Shrinkage", icon: TrendingDown },
  { key: "quality", label: "Quality", icon: ShieldAlert },
  { key: "etm", label: "ETM", icon: FileSearch },
  { key: "taskskip", label: "Task Skip", icon: SkipForward },
  { key: "escalations", label: "Client Escalations", icon: MessageSquareWarning },
  { key: "docraw", label: "DOC Raw", icon: Database },
  { key: "poa", label: "POA", icon: FileText },
  { key: "live", label: "Live", icon: Radio },
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

  return (
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
              <Bar dataKey="doc" name="DOC" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="poa" name="POA" fill="var(--teal)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {points.length > 0 && <ChartLegendRow />}
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

  const suggestions = searchQuery.data?.data ?? [];
  const perf = perfQuery.data?.data;
  const rankedPeers = perf ? [...perf.peers].sort((a, b) => b.tasks - a.tasks) : [];
  const rank = perf ? rankedPeers.findIndex((p) => p.email.toLowerCase() === perf.email.toLowerCase()) + 1 : 0;

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

      {!selected && (
        <div className="oc-card" style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)", fontSize: 13 }}>
          Search an analyst above to see their performance profile.
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
                <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{perf.email}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  TL: {perf.tlName ?? "-"} · AM: {perf.amName ?? "-"} · QA: {perf.qaName ?? "-"}
                </div>
              </div>
              {rank > 0 && (
                <span className="oc-badge" style={{ marginLeft: "auto" }}>Rank {rank} of {rankedPeers.length} in TL team</span>
              )}
            </div>
          </div>

          <div className="kr k5">
            <KpiPlain kpi={perf.totalTasks} kc="var(--blue)" />
            <KpiPlain kpi={perf.avgManualProcessingTime} kc="var(--purple)" />
            <KpiPlain kpi={perf.overallErrorRate} kc="var(--red)" />
            <KpiPlain kpi={perf.manualFarRate} kc="var(--orange)" />
            <KpiPlain kpi={perf.manualFrrRate} kc="var(--pink)" />
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
                  <Bar dataKey="tasks" name="Tasks" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={40} />
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

function AttritionView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<AttritionDimension>("tl_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "attrition-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: AttritionOverview }>(`/api/onfido-process/attrition/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "attrition-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: AttritionTrendPoint[] }>(`/api/onfido-process/attrition/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const monthlyQuery = useQuery({
    queryKey: ["onfido-process", "attrition-monthly", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: AttritionMonthRow[] }>(`/api/onfido-process/attrition/monthly-detail?from=${range.from}&to=${range.to}${qs}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "attrition-breakdown", range, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: AttritionBreakdownRow[] }>(`/api/onfido-process/attrition/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });
  const exitsQuery = useQuery({
    queryKey: ["onfido-process", "attrition-exits", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: AttritionExitRow[] }>(`/api/onfido-process/attrition/exits?from=${range.from}&to=${range.to}${qs}`),
  });

  const ov = overviewQuery.data?.data;
  const trendPoints = trendQuery.data?.data ?? [];
  const months = monthlyQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const exits = exitsQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr k5">
          <KpiPlain kpi={ov.openingHc} kc="var(--blue)" />
          <KpiPlain kpi={ov.closingHc} kc="var(--blue)" />
          <KpiPlain kpi={ov.avgHc} kc="var(--blue)" />
          <KpiPlain kpi={ov.attritionCount} kc="var(--red)" />
          <KpiPlain kpi={ov.attritionRate} kc="var(--red)" />
        </div>
      )}
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <KpiPlain kpi={ov.scheduled} kc="var(--purple)" />
          <KpiPlain kpi={ov.unplannedLeave} kc="var(--orange)" />
          <KpiPlain kpi={ov.ulShrinkageRate} kc="var(--orange)" />
          <KpiPlain kpi={ov.actualShrinkageRate} kc="var(--orange)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Attrition Count Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">Exit count only — Attrition % needs a real calendar month's headcount to mean anything, so the rate itself stays in Month Wise Detail below.</div>
        {trendPoints.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trendPoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="attritionCount" name="Attrition Count" fill="var(--red)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
        <h3>Month Wise Detail</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th>Month</th><th className="oc-right">Opening HC</th><th className="oc-right">Closing HC</th>
                <th className="oc-right">Avg HC</th><th className="oc-right">Attrition</th><th className="oc-right">Attrition %</th>
                <th className="oc-right">Scheduled</th><th className="oc-right">UL</th>
                <th className="oc-right">UL Shrinkage %</th><th className="oc-right">Actual Shrinkage %</th>
              </tr>
            </thead>
            <tbody>
              {months.length === 0 && <tr className="oc-empty-row"><td colSpan={10}>No data</td></tr>}
              {months.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="oc-right">{m.openingHc}</td>
                  <td className="oc-right">{m.closingHc}</td>
                  <td className="oc-right">{m.avgHc}</td>
                  <td className="oc-right">{m.attritionCount}</td>
                  <td className="oc-right">{m.attritionRate !== null ? `${m.attritionRate}%` : "—"}</td>
                  <td className="oc-right">{m.scheduled}</td>
                  <td className="oc-right">{m.unplannedLeave}</td>
                  <td className="oc-right">{m.ulShrinkageRate !== null ? `${m.ulShrinkageRate}%` : "—"}</td>
                  <td className="oc-right">{m.actualShrinkageRate !== null ? `${m.actualShrinkageRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <PillGroup
            value={dimension}
            onChange={setDimension}
            options={[
              { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
              { key: "aon_bucket", label: "AON Wise" }, { key: "location", label: "Location Wise" },
            ]}
          />
        </div>
        <div className="oc-card-sub">
          {ov?.month ? `Scoped to ${ov.month} — the same month the KPI tiles above show.` : ""}
          {breakdown.some((r) => r.note) && " — * rate withheld: hover the cell (avg HC smaller than exits, likely a transient bucket like Training/Support)."}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimension === "tl_name" ? "TL" : dimension === "am_name" ? "AM" : dimension === "aon_bucket" ? "AON" : "Location"}</th><th className="oc-right">Attrition Count</th><th className="oc-right">Attrition %</th><th className="oc-right">UL Shrinkage %</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={4}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
                  <td>{r.label}</td>
                  <td className="oc-right">{r.attritionCount}</td>
                  <td className="oc-right" title={r.note}>{r.attritionRate !== null ? `${r.attritionRate}%` : "— *"}</td>
                  <td className="oc-right">{r.ulShrinkageRate !== null ? `${r.ulShrinkageRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && ov?.month && (
        <BreakdownDrilldownSheet
          open={!!drilldown}
          title={`Attrition — ${dimension === "tl_name" ? "TL" : dimension === "am_name" ? "AM" : dimension === "aon_bucket" ? "AON" : "Location"}`}
          tableKey="ONFIDO_AGENT_DAILY"
          filterColumn={dimension}
          filterValue={drilldown.label}
          range={{ from: `${ov.month}-01`, to: lastDayOfMonth(ov.month) }}
          onOpenChange={(v) => { if (!v) setDrilldown(null); }}
          onOpenRecord={onOpenRecord}
        />
      )}

      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <h3>Exits in Range</h3>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>Date</th><th>Emp</th><th>Analyst Email</th><th>TL</th><th>AM</th><th>Reason</th><th>Type</th></tr></thead>
            <tbody>
              {exits.length === 0 && <tr className="oc-empty-row"><td colSpan={7}>No exits in this range</td></tr>}
              {exits.slice(0, 100).map((e) => (
                <tr
                  key={e.empId + e.exitDate}
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
        {exits.length > 100 && <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>Showing first 100 of {exits.length}</div>}
      </div>
    </div>
  );
}

/**
 * ETM (Escalated Task Management) view — real onfido_doc_etm_raw /
 * onfido_poa_etm_raw data. Every row in these tables is an escalated task by
 * definition, so "ETM count" is simply COUNT(*) in range.
 */
function EtmView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [queue, setQueue] = useState<EtmQueue>("doc");
  const [dimension, setDimension] = useState<EtmDimension>("tl_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

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

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          <KpiPlain kpi={ov.docCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.poaCount} kc="var(--teal)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>ETM Trend</h3>
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
              <Bar dataKey="doc" name="DOC" fill="var(--blue)" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="poa" name="POA" fill="var(--teal)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
        {points.length > 0 && <ChartLegendRow />}
        </div>
      </div>

      <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Breakdown</h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <PillGroup value={queue} onChange={setQueue} options={[{ key: "doc", label: "DOC" }, { key: "poa", label: "POA" }]} />
            <PillGroup
              value={dimension}
              onChange={setDimension}
              options={[
                { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
                { key: "escalated_by_email", label: "Escalated By" },
              ]}
            />
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimension === "escalated_by_email" ? "Escalated By" : dimension === "tl_name" ? "TL" : "AM"}</th><th className="oc-right">Count</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={2}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
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
          title={`${queue === "doc" ? "DOC" : "POA"} ETM — ${dimension === "escalated_by_email" ? "Escalated By" : dimension === "tl_name" ? "TL" : "AM"}`}
          tableKey={queue === "doc" ? "ONFIDO_DOC_ETM" : "ONFIDO_POA_ETM"}
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
 * Task Skip view — real onfido_task_skip_raw data: tasks unassigned/skipped
 * by an analyst before completion.
 */
function TaskSkipView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<TaskSkipDimension>("tl_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

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

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const dimLabel = { tl_name: "TL", am_name: "AM", unassigned_from_email: "Analyst", ims_client_name: "Client", task_type: "Task Type" }[dimension];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(1, minmax(0, 260px))" }}>
          <KpiPlain kpi={ov.count} kc="var(--orange)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Task Skip Trend</h3>
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
              <Bar dataKey="count" name="Task Skip" fill="var(--orange)" radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
        </div>
      </div>

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
            <thead><tr><th>{dimLabel}</th><th className="oc-right">Count</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={2}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
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
          title={`Task Skip — ${dimLabel}`}
          tableKey="ONFIDO_TASK_SKIP"
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
 * Quality Breakdown view — real onfido_doc_external_audit_raw data (17,179
 * rows / 340 clients / 732 document types), the richest per-task DOC table
 * this dashboard has, previously only feeding Analyst Performance and Alerts.
 */
function QualityView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<QualityDimension>("ims_client_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

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

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const errors = errorsQuery.data?.data;
  const dimLabel = { ims_client_name: "Client", docupedia_document_name: "Document Type", tl_name: "TL", am_name: "AM" }[dimension];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <KpiPlain kpi={ov.taskCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.overallErrorRate} kc="var(--red)" />
          <KpiPlain kpi={ov.farRate} kc="var(--orange)" />
          <KpiPlain kpi={ov.frrRate} kc="var(--orange)" />
        </div>
      )}
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <KpiPlain kpi={ov.classificationErrorRate} kc="var(--purple)" />
          <KpiPlain kpi={ov.extractionErrorRate} kc="var(--purple)" />
          <KpiPlain kpi={ov.rawExtractionErrorRate} kc="var(--purple)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Overall Error Rate Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">Errors ÷ tasks audited, per bucket — always a real 0-100% ratio regardless of bucket width.</div>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11, fill: "var(--muted)" }} unit="%" />
              <RTooltip content={<DarkTooltip />} />
              <Line type="monotone" dataKey="errorRate" name="Error Rate %" stroke="var(--red)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
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
              { key: "ims_client_name", label: "Client Wise" }, { key: "docupedia_document_name", label: "Document Type Wise" },
              { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
            ]}
          />
        </div>
        <div className="oc-card-sub">Top 50 by task count.</div>
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead><tr><th>{dimLabel}</th><th className="oc-right">Tasks</th><th className="oc-right">Error Rate</th><th className="oc-right">FAR %</th><th className="oc-right">FRR %</th></tr></thead>
            <tbody>
              {breakdown.length === 0 && <tr className="oc-empty-row"><td colSpan={5}>No data</td></tr>}
              {breakdown.map((r) => (
                <tr key={r.label} className="oc-row-click" onClick={() => setDrilldown({ label: r.label })}>
                  <td>{r.label}</td>
                  <td className="oc-right">{r.taskCount.toLocaleString("en-IN")}</td>
                  <td className="oc-right">{r.overallErrorRate !== null ? `${r.overallErrorRate}%` : "—"}</td>
                  <td className="oc-right">{r.farRate !== null ? `${r.farRate}%` : "—"}</td>
                  <td className="oc-right">{r.frrRate !== null ? `${r.frrRate}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
  const qs = tlAmQS(tlFilter, amFilter);

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "escalation-overview", range, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: EscalationOverview }>(`/api/onfido-process/escalations/overview?from=${range.from}&to=${range.to}${qs}`),
  });
  const trendQuery = useQuery({
    queryKey: ["onfido-process", "escalation-trend", range, tlFilter, amFilter, granularity],
    queryFn: () => hrmsApi.get<{ data: EscalationTrendPoint[] }>(`/api/onfido-process/escalations/trend?from=${range.from}&to=${range.to}${qs}&granularity=${granularity}`),
  });
  const breakdownQuery = useQuery({
    queryKey: ["onfido-process", "escalation-breakdown", range, dimension, tlFilter, amFilter],
    queryFn: () => hrmsApi.get<{ data: EscalationBreakdownRow[] }>(`/api/onfido-process/escalations/breakdown/${dimension}?from=${range.from}&to=${range.to}${qs}`),
  });

  const ov = overviewQuery.data?.data;
  const points = trendQuery.data?.data ?? [];
  const breakdown = breakdownQuery.data?.data ?? [];
  const dimLabel = { ims_client_name: "Client", error_category: "Error Category", tl_name: "TL", am_name: "AM" }[dimension];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <KpiPlain kpi={ov.totalLines} kc="var(--red)" />
          <KpiPlain kpi={ov.creLines} kc="var(--orange)" />
          <KpiPlain kpi={ov.crqLines} kc="var(--orange)" />
          <KpiPlain kpi={ov.distinctReports} kc="var(--purple)" />
        </div>
      )}

      <div className="oc-card" style={{ "--hc": "var(--red)" } as React.CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 style={{ marginBottom: 0 }}>Client Escalation Trend</h3>
          <PillGroup
            value={granularity} onChange={setGranularity}
            options={[{ key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }]}
          />
        </div>
        <div className="oc-card-sub">CRE + CRQ client-reported error lines per bucket — a real count, both formats combined.</div>
        {points.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--muted)" }}>No data in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <RTooltip content={<DarkTooltip />} cursor={{ fill: "rgba(148,163,184,0.06)" }} />
              <Bar dataKey="count" name="Escalation Lines" fill="var(--red)" radius={[4, 4, 0, 0]} />
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
  open, title, dimension, filterValue, range, tlFilter, amFilter, onOpenChange, onOpenRecord,
}: {
  open: boolean; title: string; dimension: EscalationDimension; filterValue: string;
  range: { from: string; to: string }; tlFilter: string; amFilter: string;
  onOpenChange: (v: boolean) => void; onOpenRecord: (record: RawRecord, table: string) => void;
}) {
  const qs = tlAmQS(tlFilter, amFilter);
  const recordsQuery = useQuery({
    queryKey: ["onfido-process", "escalation-records", dimension, filterValue, range, tlFilter, amFilter],
    queryFn: () =>
      hrmsApi.get<{ data: { rows: (RawRecord & { escalation_source: "CRE" | "CRQ" })[]; total: number } }>(
        `/api/onfido-process/escalations/records/${dimension}?from=${range.from}&to=${range.to}${qs}&value=${encodeURIComponent(filterValue)}&limit=100`
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
  const dimLabel = { ims_client_name: "Client", tl_name: "TL", am_name: "AM" }[dimension];

  return (
    <div className="space-y-4">
      {ov && (
        <div className="kr" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <KpiPlain kpi={ov.taskCount} kc="var(--blue)" />
          <KpiPlain kpi={ov.avgAht} kc="var(--teal)" />
          <KpiPlain kpi={ov.avgQueueTime} kc="var(--orange)" />
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
              <Bar dataKey="taskCount" name="Tasks" fill="var(--blue)" radius={[4, 4, 0, 0]} />
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
              { key: "ims_client_name", label: "Client Wise" }, { key: "tl_name", label: "TL Wise" }, { key: "am_name", label: "AM Wise" },
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

/**
 * POA view — POA Raw + POA Trial for volume/AHT, POA Quality for error
 * rates. Three separate tables with no row-level link between them, merged
 * by TL/AM label in application code (same reasoning as the backend's own
 * comment on getPoaBreakdown) — so the breakdown drill-down opens the POA
 * Raw records specifically (the volume source), not a blended view.
 */
function PoaView({
  range, tlFilter, amFilter, onOpenRecord,
}: { range: { from: string; to: string }; tlFilter: string; amFilter: string; onOpenRecord: (r: RawRecord, table: string) => void }) {
  const [dimension, setDimension] = useState<PoaDimension>("tl_name");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [drilldown, setDrilldown] = useState<{ label: string } | null>(null);
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
          <KpiPlain kpi={ov.errorRate} kc="var(--red)" />
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
              <Bar dataKey="taskCount" name="Reports" fill="var(--blue)" radius={[4, 4, 0, 0]} />
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
          title={`POA Raw — ${dimLabel}`}
          tableKey="ONFIDO_POA_RAW"
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
            <Bar dataKey="taskCount" name="Task" fill="var(--teal)" radius={[4, 4, 0, 0]} />
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

export default function OnfidoProcessDashboard() {
  const [view, setView] = useState<ViewKey>("overview");
  const [range, setRange] = useState(defaultRange());
  const [tlFilter, setTlFilter] = useState<string>("");
  const [amFilter, setAmFilter] = useState<string>("");
  const [activeTable, setActiveTable] = useState<string>("ONFIDO_DOC_RAW");
  const [drawerRecord, setDrawerRecord] = useState<RawRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTableName, setDrawerTableName] = useState<string>("");
  const [metricDrilldown, setMetricDrilldown] = useState<KpiValue | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["onfido-process", "overview", range, tlFilter, amFilter],
    queryFn: () =>
      hrmsApi.get<{ data: OverviewData }>(
        `/api/onfido-process/overview?from=${range.from}&to=${range.to}` +
        (tlFilter ? `&tlName=${encodeURIComponent(tlFilter)}` : "") +
        (amFilter ? `&amName=${encodeURIComponent(amFilter)}` : "")
      ),
  });

  const filterOptionsQuery = useQuery({
    queryKey: ["onfido-process", "filter-options"],
    queryFn: () => hrmsApi.get<{ data: { tlNames: string[]; amNames: string[] } }>("/api/onfido-process/filter-options"),
    staleTime: 5 * 60 * 1000,
  });
  const filterOptions = filterOptionsQuery.data?.data ?? { tlNames: [], amNames: [] };

  const tlQuery = useQuery({
    queryKey: ["onfido-process", "tl-breakdown", range],
    queryFn: () =>
      hrmsApi.get<{ data: TlBreakdownRow[] }>(
        `/api/onfido-process/tl-breakdown?from=${range.from}&to=${range.to}`
      ),
  });

  const trendQuery = useQuery({
    queryKey: ["onfido-process", "monthly-trend", range],
    queryFn: () =>
      hrmsApi.get<{ data: TrendPoint[] }>(
        `/api/onfido-process/monthly-trend?from=${range.from}&to=${range.to}`
      ),
  });

  const tablesQuery = useQuery({
    queryKey: ["onfido-process", "tables"],
    queryFn: () => hrmsApi.get<{ data: TableInfo[] }>("/api/onfido-process/tables"),
  });

  const recordsQuery = useQuery({
    queryKey: ["onfido-process", "records", activeTable, range],
    queryFn: () =>
      hrmsApi.get<{ data: { rows: RawRecord[]; total: number } }>(
        `/api/onfido-process/records/${activeTable}?from=${range.from}&to=${range.to}&limit=50`
      ),
    enabled: !!activeTable,
  });

  const overview = overviewQuery.data?.data;
  const tlRows = tlQuery.data?.data ?? [];
  const trendPoints = trendQuery.data?.data ?? [];
  const tables = tablesQuery.data?.data ?? [];
  const activeTableInfo = useMemo(() => tables.find((t) => t.key === activeTable), [tables, activeTable]);

  function openRecord(record: RawRecord, tableName?: string) {
    setDrawerRecord(record);
    setDrawerTableName(tableName ?? activeTableInfo?.name ?? activeTable);
    setDrawerOpen(true);
  }

  return (
    <DashboardLayout>
      <div className="onfido-central-theme">
        <div className="space-y-5">
          {/* Header */}
          <div>
            <div className="oc-eyebrow" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>Quality &amp; Operations</div>
            <h1 style={{ marginTop: 4, fontSize: 22, fontWeight: 800, color: "#fff" }}>Onfido Process Dashboard</h1>
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
          {view !== "live" && (
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
          {view === "analyst" && <AnalystPerformanceView range={range} />}
          {view === "attrition" && <AttritionView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "quality" && <QualityView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "etm" && <EtmView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "taskskip" && <TaskSkipView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "escalations" && <EscalationsView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "docraw" && <DocRawView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "poa" && <PoaView range={range} tlFilter={tlFilter} amFilter={amFilter} onOpenRecord={openRecord} />}
          {view === "live" && <LiveView />}

          {view === "overview" && (
          <>
          {/* DOC KPIs */}
          <div>
            <SectionHead hc="var(--blue)" title="DOC Queue" subtitle="Click any card to drill down" />
            <div className="kr k5">
              {overview && (
                <>
                  <KpiTile kpi={overview.doc.volume} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.doc.avgAht} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.doc.escalationRate} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.doc.auditErrorRate} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.doc.clientEscalationLines} onDrill={setMetricDrilldown} />
                </>
              )}
            </div>
          </div>

          {/* POA KPIs */}
          <div>
            <SectionHead hc="var(--teal)" title="POA Queue" subtitle="Click any card to drill down" />
            <div className="kr k6">
              {overview && (
                <>
                  <KpiTile kpi={overview.poa.volume} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.poa.avgAht} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.poa.errorRate} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.poa.classificationErrorRate} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.poa.extractionErrorRate} onDrill={setMetricDrilldown} />
                  <KpiTile kpi={overview.poa.dataComparisonErrorRate} onDrill={setMetricDrilldown} />
                </>
              )}
            </div>
          </div>

          {/* Trend */}
          <div className="oc-card" style={{ "--hc": "var(--purple)" } as React.CSSProperties}>
            <h3>Monthly Volume Trend</h3>
            <TrendChart points={trendPoints} />
            {trendPoints.length > 0 && <ChartLegendRow />}
          </div>

          {/* TL breakdown */}
          <div className="oc-card" style={{ "--hc": "var(--blue)" } as React.CSSProperties}>
            <h3>Breakdown by Team Leader</h3>
            <div className="oc-card-sub">Click a row for that TL's records.</div>
            <div style={{ overflowX: "auto" }}>
              <table className="oc-table">
                <thead>
                  <tr>
                    <th>TL Name</th>
                    <th className="oc-right">DOC Volume</th>
                    <th className="oc-right">Avg AHT</th>
                    <th className="oc-right">Escalations</th>
                    <th className="oc-right">Audit Error Rate</th>
                    <th className="oc-right">Client Escalation Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {tlRows.length === 0 && (
                    <tr className="oc-empty-row"><td colSpan={6}>No data</td></tr>
                  )}
                  {tlRows.map((row) => (
                    <tr
                      key={row.tlName}
                      className="oc-row-click"
                      onClick={() => setTlFilter(row.tlName === "(unassigned)" ? "" : row.tlName)}
                    >
                      <td>
                        <span className="oc-avatar" style={{ background: avatarTone(row.tlName) }}>{initials(row.tlName)}</span>
                        {row.tlName}
                      </td>
                      <td className="oc-right">{row.docVolume.toLocaleString("en-IN")}</td>
                      <td className="oc-right">{row.docAvgAht ?? "-"}s</td>
                      <td className="oc-right">{row.docEscalations}</td>
                      <td className="oc-right">{row.docAuditErrorRate !== null ? `${row.docAuditErrorRate}%` : "—"}</td>
                      <td className="oc-right">{row.escalationLines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Raw data browser */}
          <div className="oc-card" style={{ "--hc": "var(--teal)" } as React.CSSProperties}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3>Browse Raw Data</h3>
                {activeTableInfo && <div className="oc-card-sub">{activeTableInfo.description}</div>}
              </div>
              <select className="oc-select" value={activeTable} onChange={(e) => setActiveTable(e.target.value)} style={{ minWidth: 260 }}>
                {tables.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="oc-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Analyst</th>
                    <th>TL</th>
                    <th>Result</th>
                    <th className="oc-right">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {(recordsQuery.data?.data.rows ?? []).length === 0 && (
                    <tr className="oc-empty-row"><td colSpan={5}>No records</td></tr>
                  )}
                  {(recordsQuery.data?.data.rows ?? []).map((r) => (
                    <tr key={r.id} className="oc-row-click" onClick={() => openRecord(r)}>
                      <td>{formatDateTime((r as Record<string, unknown>).report_date ?? (r as Record<string, unknown>).report_completed_date ?? (r as Record<string, unknown>).task_complete_date)}</td>
                      <td>{String((r as Record<string, unknown>).analyst_email ?? "-")}</td>
                      <td>{String((r as Record<string, unknown>).tl_name ?? "-")}</td>
                      <td>
                        {(r as Record<string, unknown>).overall_result ? (
                          <span className="oc-pill-outline">{String((r as Record<string, unknown>).overall_result)}</span>
                        ) : "-"}
                      </td>
                      <td className="oc-right">{formatDateTime((r as Record<string, unknown>).uploaded_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {recordsQuery.data?.data && (
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
                Showing {recordsQuery.data.data.rows.length} of {recordsQuery.data.data.total.toLocaleString("en-IN")}
              </div>
            )}
          </div>
          </>
          )}
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
    </DashboardLayout>
  );
}
