import { Fragment, lazy, Suspense, useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DiallerLivePanel, detectDiallerProcess } from "./DiallerLivePanel";

// Onfido's dashboard lives only here (its old /onfido-process/dashboard URL
// redirects in). Lazy: it is large and only one process ever opens it.
const OnfidoProcessDashboard = lazy(() => import("./onfido-process/OnfidoProcessDashboard"));
const isOnfidoProcess = (name: string | null | undefined) => (name ?? "").toLowerCase().includes("onfido");
import {
  BellavitaDashboard, GncDashboard, NeemansDashboard, AwDashboard,
  BvoDashboard, LpDashboard, ProcessDataPanel, DalmiaDashboard, UploadPanel,
} from "./NativeSalesDashboard";
import { HousingDashboardEmbed } from "./NativeHousingDashboards";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { MasmisUploaderGrid } from "@/components/process-operations/MasmisUploader";

/**
 * Real inline upload, keyed by processCode (not mapping.type, since Housing
 * Owner/Premium share one dashboard type but have distinct upload sets).
 * Every code here already has a working rpc_name in BulkUploadHub's
 * IMPORT_RPC_BY_TYPE — this is packaging, not new backend capability.
 * Modeled on a pattern from a colleague's fork (tausifansari-mcn/HRMS-2's
 * ProcessPerformanceV2Page), which embeds uploads next to their dashboard
 * instead of only in the separate Bulk Upload Hub.
 */
const PROCESS_MASMIS_UPLOADS: Record<string, Array<{ code: string; label: string }>> = {
  CLOVIA: [
    { code: "CLOVIA_EMAIL_DAILY", label: "Email Daily" },
    { code: "CLOVIA_CHAT_DAILY", label: "Chat Daily" },
    { code: "CLOVIA_CRM_DISPOSITION", label: "CRM Disposition" },
    { code: "CLOVIA_FEEDBACK", label: "Feedback (CSAT/DSAT)" },
    { code: "CLOVIA_QUALITY_AUDIT", label: "Quality Audit" },
    { code: "CLOVIA_RECHURN_CALLS", label: "Rechurn Calls" },
    { code: "CLOVIA_TEAM_ALIGNMENT", label: "Team Alignment" },
    { code: "CL_APR_MASMIS", label: "APR" },
    { code: "CL_CHAT_MASMIS", label: "Chat" },
    { code: "CL_DISPO_MASMIS", label: "Disposition" },
    { code: "CL_EMAIL_RAW_MASMIS", label: "Email Raw" },
    { code: "CL_FEEDBACK_MASMIS", label: "Feedback (raw)" },
    { code: "CL_IB_CDR_MASMIS", label: "Inbound CDR" },
    { code: "CL_OUTBOUND_MASMIS", label: "Outbound" },
    { code: "CL_QUALITY_MASMIS", label: "Quality (raw)" },
    { code: "CL_RECHURN_CALL_MASMIS", label: "Rechurn Call (raw)" },
  ],
  DU_DIGITAL: [
    { code: "DU_APR_KOREA", label: "APR — Korea" },
    { code: "DU_APR_THAILAND", label: "APR — Thailand" },
    { code: "DU_TEAM_MAPPING_KOREA", label: "Team Mapping — Korea" },
    { code: "DU_TEAM_MAPPING_THAILAND", label: "Team Mapping — Thailand" },
  ],
  HOUSING_OWNER: [
    { code: "HOUSING_OWNER_INCENTIVE", label: "Incentive" },
    { code: "HOUSING_OWNER_LEAD_PIPELINE", label: "Lead Pipeline" },
    { code: "OWNER_SALE_MASMIS", label: "Sale" },
    { code: "OWNER_CDR_MASMIS", label: "CDR" },
    { code: "OWNER_AGENT_DETAILS_MASMIS", label: "Agent Details" },
  ],
  HOUSING_PREMIUM: [
    { code: "HOUSING_PREMIUM_AGENT_TARGET", label: "Agent Target & Achievement" },
    { code: "HOUSING_PREMIUM_SALE_RAW", label: "Sale Raw" },
    { code: "PRE_SALE_MASMIS", label: "Sale" },
    { code: "PRE_CDR_MASMIS", label: "CDR" },
    { code: "PRE_AGENT_DETAILS_MASMIS", label: "Agent Details" },
  ],
};

// Process code → sales dashboard type. Derived from live process list 2026-09-15.
const PROCESS_SALES_MAP: Record<string, { type: string; label: string }> = {
  BELLA_VITA:          { type: "bellavita", label: "Bellavita / BVO" },
  NEEMANS:             { type: "neemans",   label: "Neemans" },
  GNC:                 { type: "gnc",       label: "GNC" },
  APPRICIATE_WEALTH:   { type: "aw",        label: "AW (Aarohan Wealth)" },
  CLOVIA:              { type: "clovia",    label: "Clovia" },
  DALMIA_CEMENT:       { type: "dalmia",    label: "Dalmia" },
  DU_DIGITAL:          { type: "du",        label: "DU Digital" },
  // LP = Lawyers Panel (owner, 2026-09-15). Worked by the Eresolution team (NOIDA):
  // the LP call records' agents who are HRMS employees are all active on
  // Eresolution. The LAWYER_PANEL process_master row is inactive, with no staff.
  ERESOLUTION:         { type: "lp",        label: "Lawyers Panel (LP)" },
  HOUSING_COM:         { type: "housing",   label: "Housing.com" },
  HOUSING_OWNER:       { type: "housing",   label: "Housing Owner" },
  HOUSING_PREMIUM:     { type: "housing",   label: "Housing Premium" },
};

function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Inline sales dashboard view — renders the correct component for the selected process.
function ProcessSalesDashboardView({ processCode, processName }: { processCode: string; processName: string }) {
  const [month, setMonth] = useState(currentMonthStr());
  const mapping = PROCESS_SALES_MAP[processCode];
  const { hasAnyRole } = useWorkforceAccess();
  // The roles POST /api/sales-upload/upload/* accepts — not the Brand Sales
  // page's list, which offers the form to process_manager (who then gets 403).
  const canUpload = hasAnyRole("super_admin", "admin", "sales", "operations_manager");

  if (!mapping) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-700">No sales dashboard for {processName}</p>
        <p className="text-xs text-slate-400 mt-1">Sales data is only available for Bellavita, Neemans, GNC, AW, Clovia, Dalmia, DU Digital, Eresolution (Lawyers Panel), and Housing processes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Month selector — shared across all views that need it */}
      {!["clovia", "du", "dalmia", "lp"].includes(mapping.type) && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Month</span>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700" />
        </div>
      )}

      {/* Render the process-specific dashboard */}
      {mapping.type === "bellavita" && <BellavitaBvoToggle month={month} />}
      {mapping.type === "neemans"   && <NeemansDashboard month={month} />}
      {mapping.type === "gnc"       && <GncDashboard month={month} />}
      {mapping.type === "aw"        && <AwDashboard month={month} />}
      {mapping.type === "bvo"       && <BvoDashboard month={month} />}
      {mapping.type === "lp"        && <LpDashboard />}
      {mapping.type === "clovia"    && <ProcessDataPanel process="Clovia" uploadTypes={["CLOVIA_EMAIL_DAILY","CLOVIA_CHAT_DAILY","CLOVIA_CRM_DISPOSITION","CLOVIA_QUALITY_AUDIT","CLOVIA_RECHURN_CALLS","CLOVIA_TEAM_ALIGNMENT"]} color="#E40B92" />}
      {mapping.type === "du"        && <ProcessDataPanel process="DU Digital" uploadTypes={["DU_APR_KOREA","DU_APR_THAILAND","DU_TEAM_MAPPING_KOREA","DU_TEAM_MAPPING_THAILAND"]} color="#003D6B" />}
      {mapping.type === "dalmia"    && <DalmiaDashboard />}
      {mapping.type === "housing"   && <HousingDashboardEmbed subProcess="both" />}

      {/* This brand's sales uploads — the Brand Sales Analytics "Upload Data"
          tab, narrowed to the selected process. */}
      {canUpload && UPLOAD_BRAND[mapping.type] && <UploadPanel brand={UPLOAD_BRAND[mapping.type]} />}

      {/* Real inline upload for processes whose only prior upload path was
          either "go to the Bulk Upload Hub" (ProcessDataPanel's banner) or
          nothing at all (Housing). Every code here already imports through
          the generic bulk-upload system — see PROCESS_MASMIS_UPLOADS above. */}
      {canUpload && PROCESS_MASMIS_UPLOADS[processCode] && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upload Data</p>
          <MasmisUploaderGrid templates={PROCESS_MASMIS_UPLOADS[processCode]} />
        </div>
      )}
    </div>
  );
}

/** Sales dashboard type → the brand its uploads are filed under in UploadPanel. */
const UPLOAD_BRAND: Record<string, string> = { bellavita: "Bellavita", gnc: "GNC", aw: "AW" };

// Bellavita has both fresh + repeat (BVO) tabs
function BellavitaBvoToggle({ month }: { month: string }) {
  const [sub, setSub] = useState<"bellavita" | "bvo">("bellavita");
  return (
    <div className="space-y-4">
      {/* Label beside the toggle only — wrapping the whole dashboard in a flex
          row with the label centred it against the full chart height. */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">View:</span>
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100 w-fit">
          {([["bellavita", "Bellavita (Fresh)"], ["bvo", "BVO / Repeat"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setSub(k)}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={sub === k ? { background: "#1A1A1A", color: "#D4AF37" } : { color: "#64748B" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      {sub === "bellavita" && <BellavitaDashboard month={month} />}
      {sub === "bvo"       && <BvoDashboard month={month} />}
    </div>
  );
}
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Briefcase, CheckCircle2, ChevronRight, Clock,
  Database, Download, Filter, Headphones, Hourglass, Lightbulb, Loader2, Minus, Package, PenLine, Phone, Radio,
  ShieldAlert, Sparkles, Target, Truck, Upload, User, UserCheck, UserPlus, Users, Users2, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * Process Operations — everything a process is actually measured on.
 *
 * The Client Process KPI Dashboard scores a fixed registry of client-facing
 * targets. Metrics wired through KPI Studio are not on that list and so appear
 * nowhere, which left 57 metric codes holding real values and no page reading
 * them. This is that page.
 *
 * The chart and card language follows the Mydashboards house style this project
 * asked to adopt: navy chart headers, shared tooltip/axis/grid constants, circle
 * legends, axis lines off, and gradient KPI cards with a corner orb and a
 * coloured value. Two things are deliberately NOT copied. Their charts pair a
 * count axis with a percent axis on one plot; almost everything here is already a
 * percentage, so a second axis would add a scale nobody needs. And every tile
 * here is a button that opens the drill-down, which their cards are not.
 *
 * ── What this page refuses to do ─────────────────────────────────────────────
 *
 * A missing reading renders as "no data", never as zero. Most of the defects
 * found while wiring these metrics were confident zeroes standing in for
 * something nobody had measured.
 *
 * Every tile carries its age, because feeds stop silently and the last value goes
 * on looking current — the biometric sync stopped on 18 June and ran 82 days
 * before anyone noticed.
 *
 * A figure dated today is marked provisional: attendance rows are written absent
 * and become present as punches arrive, so shrinkage reads 100% at breakfast and
 * 0% by evening.
 */

// ── House style, lifted from the reference dashboards ────────────────────────
const NAVY = "#0D1445";
const C_BLUE = "#3B82F6";
const C_GREEN = "#10B981";
const C_PURPLE = "#8B5CF6";
const C_AMBER = "#F59E0B";
const C_RED = "#EF4444";
const C_SLATE = "#64748B";
// C_RED (#EF4444 on white) is ~3.78:1 -- fine for a chart line/border/tint, but
// fails WCAG AA (4.5:1) for small text. The design system's own "value text"
// red tone (#DC2626, ~4.83:1) is what the hero KPI card's text actually uses.
const C_RED_TEXT = "#DC2626";

const TOOLTIP_STYLE = { background: "#FFFFFF", border: "1px solid #334155", borderRadius: 8, fontSize: 12 } as const;
const AXIS_TICK = { fill: "#64748B", fontSize: 11 } as const;
const GRID = { strokeDasharray: "3 3", stroke: "#E2E8F0" } as const;

// ── GAS (Google Apps Script) design system — premium dashboard chrome ──────
const GAS_TOPBAR = "radial-gradient(circle at 88% 12%,rgba(79,209,255,.18),transparent 24%),linear-gradient(118deg,#071b35 0%,#124d82 48%,#0f7890 100%)";
const GAS_BRIEF = "radial-gradient(circle at 92% 18%,rgba(40,202,193,.20),transparent 28%),linear-gradient(132deg,#0a2848 0%,#124c72 61%,#176f81 100%)";
const GAS_ACCENT = "linear-gradient(90deg,#2f6fed,#10b8d4,#18a866,#e89b19,#7c5ce5)";
const GAS_KPI_ACCENTS = ["#2f6fed","#10b8d4","#18a866","#e89b19","#e5484d","#7c5ce5"] as const;

interface ProcessRow {
  processId: string; processName: string; processCode: string | null; metrics: number;
  branchId: string | null; branchName: string | null; branchCode: string | null;
  headcount: number; latestDate: string | null; staleDays: number | null;
}
interface Reading {
  metricKey: string; label: string; unit: string | null; direction: string | null;
  value: number | null; staleDays: number | null; latestDate: string | null;
  provisional: boolean; priorValue: number | null; targetValue: number | null;
  trend: Array<{ date: string; value: number | null; numerator: number | null; denominator: number | null }>;
  numerator: number | null; denominator: number | null;
  /** 'manual' when the latest reading was hand-entered, 'connector' when a real pipeline wrote it. */
  source: string | null;
  /** When the latest reading was actually written -- pairs with `provisional`
   *  to say HOW stale a same-day connector figure is, not just that it's today's. */
  computedAt: string | null;
}
interface Section { key: string; title: string; blurb: string | null; metrics: Reading[] }
interface FeedRow {
  metricKey: string; metricName: string; processId: string; processName: string;
  latestDate: string | null; staleDays: number | null; recentReadings: number;
  state: "ok" | "slowing" | "stopped";
}
interface NeverReportedGroup {
  metricKey: string; metricName: string; sourceObject: string;
  processCount: number; processNames: string[]; processIds: string[];
  uploadTypeCode: string | null; uploadTypeName: string | null;
  existingSourceRows: number | null;
}
interface FeedHealth {
  checkedAt: string; warnAfterDays: number; stoppedAfterDays: number;
  counts: { ok: number; slowing: number; stopped: number }; feeds: FeedRow[];
  neverReported: NeverReportedGroup[];
}
interface CatalogMetric { metricCode: string; metricName: string; unit: string | null; direction: string | null }
interface ImportOutcome {
  row: number; metricKey: string; scoreDate: string; value: number | null;
  ok: boolean; message?: string; replaces?: number | null;
}
interface ImportResult { imported: number; errors: Array<{ row: number; message: string }>; outcomes: ImportOutcome[]; dryRun: boolean }
interface RawRows {
  date: string; available: boolean; reason: string | null;
  sourceCode: string | null; sourceObject: string | null;
  totalRows: number | null; truncated: boolean;
  columns: string[]; rows: Array<Record<string, unknown>>;
}
type ReportPeriod = "trend" | "today" | "wtd" | "mtd";
interface Operations {
  processId: string; processName: string; headcount: number;
  windowDays: number; staleAfterDays: number;
  period: ReportPeriod; periodFrom: string | null; periodTo: string | null;
  sections: Section[]; ungrouped: Reading[];
}

const PERIODS: Array<{ key: ReportPeriod; label: string; caption: string }> = [
  { key: "trend", label: "Trend", caption: "Latest reading, 30-day window" },
  { key: "today", label: "Today", caption: "Today so far, vs yesterday" },
  { key: "wtd", label: "WTD", caption: "Week to date (Mon–today), vs the same days last week" },
  { key: "mtd", label: "MTD", caption: "Month to date (1st–today), vs the same days last month" },
];

/** "MTD (1–8 Sep)" — a bare code means nothing; the actual calendar range does. */
function formatPeriodRange(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const f = new Date(`${from}T00:00:00`);
  const t = new Date(`${to}T00:00:00`);
  const day = (d: Date) => d.getDate();
  const mon = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  if (from === to) return `${day(f)} ${mon(f)}`;
  if (mon(f) === mon(t)) return `${day(f)}–${day(t)} ${mon(t)}`;
  return `${day(f)} ${mon(f)} – ${day(t)} ${mon(t)}`;
}
interface Drilldown {
  metricKey: string; metricName: string; unit: string | null; direction: string | null;
  processId: string; processName: string;
  period: ReportPeriod; periodFrom: string | null; periodTo: string | null;
  definition: {
    id: string | null; formula: string | null; grain: string | null;
    effectiveFrom: string | null; effectiveTo: string | null; targetValue: number | null;
    createdBy: string | null; createdAt: string | null; notes: string | null;
  } | null;
  source: {
    sourceCode: string; sourceName: string | null; sourceType: string | null;
    sourceObject: string | null; dateColumn: string | null; processKeyKind: string | null;
    processKeyColumn: string | null; processKeyValue: string | null;
  } | null;
  fields: Array<{
    fieldName: string; displayName: string | null; sourceColumn: string | null;
    aggregateFn: string | null; filter: string | null;
  }>;
  readings: Array<{
    date: string; value: number | null; numerator: number | null;
    denominator: number | null; note: string | null; source: string | null;
  }>;
}

interface AnalystScore {
  employeeId: string; employeeCode: string; name: string; designation: string | null;
  value: number | null; manual: boolean;
  reportsTo: Array<{ employeeCode: string; name: string; designation: string | null; depth: number }>;
  teamLeader: { employeeCode: string; name: string } | null;
  assistantManager: { employeeCode: string; name: string } | null;
}
interface AnalystBreakdown {
  available: boolean; reason: string | null;
  metricName: string | null; unit: string | null; direction: string | null; targetValue: number | null;
  periodFrom: string | null; periodTo: string | null;
  analysts: AnalystScore[];
}

interface VocQuote {
  employeeCode: string; employeeName: string; callDate: string; quote: string;
  hasTranscript: boolean; hasRecording: boolean;
}
interface ClapVoiceOfCustomer {
  available: boolean; reason: string | null;
  periodFrom: string | null; periodTo: string | null; totalAuditedCalls: number;
  clapBreakdown: Array<{ clap: "Customer" | "Logistic" | "Agent" | "Product"; count: number; pct: number }>;
  quotes: {
    agent: { positive: VocQuote[]; negative: VocQuote[] };
    logistic: { positive: VocQuote[]; negative: VocQuote[] };
    product: { positive: VocQuote[]; negative: VocQuote[] };
  };
}

interface ClapDailyHeatmap {
  available: boolean; reason: string | null;
  days: Array<{
    date: string; total: number;
    counts: { Customer: number; Logistic: number; Agent: number; Product: number };
  }>;
}

interface ClapScenarioBreakdown {
  available: boolean; reason: string | null;
  clap: "Customer" | "Logistic" | "Agent" | "Product"; total: number;
  scenarios: Array<{ scenario: string; count: number; pct: number }>;
}

interface ClapScenarioCall {
  available: boolean; reason: string | null;
  calls: Array<{
    employeeCode: string; employeeName: string; callDate: string;
    qualityPercentage: number | null; hasTranscript: boolean; hasRecording: boolean;
  }>;
}

interface FatalCallsResult {
  available: boolean; reason: string | null;
  calls: Array<{
    employeeCode: string; employeeName: string; callDate: string;
    scenario: string | null; hasTranscript: boolean; hasRecording: boolean;
  }>;
}

interface EmployeeRecentCalls {
  available: boolean; reason: string | null;
  calls: Array<{
    callDate: string; qualityPercentage: number | null; scenario: string | null;
    hasTranscript: boolean; hasRecording: boolean;
  }>;
}

interface AgentAuditSummaryRow {
  employeeCode: string; employeeName: string;
  auditCount: number; cqScore: number | null;
  fatalCount: number; fatalPct: number;
  tqCount: number; mqCount: number; bqCount: number;
  band: "TQ" | "MQ" | "BQ";
}
interface AgentAuditSummary {
  available: boolean; reason: string | null;
  totals: { tq: number; mq: number; bq: number };
  rows: AgentAuditSummaryRow[];
}

interface ScenarioDistributionChild { scenario1: string; count: number; pct: number; }
interface ScenarioDistributionItem { scenario: string; count: number; pct: number; children: ScenarioDistributionChild[]; }
interface ScenarioDistribution { available: boolean; reason: string | null; items: ScenarioDistributionItem[]; }

interface ScoreComponent { key: string; label: string; scorePct: number | null; }
interface ScoreComponents { available: boolean; reason: string | null; components: ScoreComponent[]; }

interface AchtRow {
  key: string; label: string;
  auditCount: number; scorePct: number | null;
  fatalCount: number; fatalPct: number;
}
interface AchtCategorization { available: boolean; reason: string | null; rows: AchtRow[]; }

interface CriticalSignal { key: string; label: string; emoji: string; count: number; pct: number; }
interface CriticalSignals { available: boolean; reason: string | null; totalExamined: number; signals: CriticalSignal[]; }

interface DailyQualityScore { date: string; avgScore: number | null; auditCount: number; }
interface DailyQualityTrend { available: boolean; reason: string | null; targetPct: number; days: DailyQualityScore[]; }

interface CustomerRiskCards {
  available: boolean; reason: string | null; totalExamined: number;
  socialMediaCourtThreat: number; socialMediaCourtThreatPct: number;
  potentialScam: number; potentialScamPct: number;
}

interface FatalScenarioRow { scenario: string; fatalCount: number; fatalPct: number; }
interface FatalDayRow { date: string; totalCount: number; totalFatal: number; }
interface FatalContributorRow { employeeCode: string; employeeName: string; auditCount: number; fatalCount: number; fatalPct: number; }
interface FatalAnalysis {
  available: boolean; reason: string | null;
  auditCount: number; cqScore: number | null; fatalCount: number; fatalPct: number;
  byScenario: FatalScenarioRow[];
  dayWise: FatalDayRow[];
  topContributors: FatalContributorRow[];
}

interface DayWiseScenarioRow { date: string; complaint: number; request: number; query: number; saleDone: number; total: number; }
interface DayWiseScenarioAudit { available: boolean; reason: string | null; days: DayWiseScenarioRow[]; }

interface DayWiseRepeatRow { date: string; uniqueCalls: number; repeatCalls: number; repeatPct: number; }
interface RepeatAnalysis {
  available: boolean; reason: string | null;
  grandUnique: number; grandRepeat: number; grandPct: number;
  dayWise: DayWiseRepeatRow[];
}

interface FraudCallRow { employeeCode: string; employeeName: string; callDate: string; scenario: string | null; sentence: string; hasTranscript: boolean; hasRecording: boolean; }
interface FraudAgentRow { employeeCode: string; employeeName: string; flagged: number; total: number; riskPct: number; }
interface FraudCallSummary {
  available: boolean; reason: string | null;
  total: number; flagged: number;
  calls: FraudCallRow[];
  byAgent: FraudAgentRow[];
}

interface CallDetail {
  available: boolean; reason: string | null;
  employeeCode: string; employeeName: string; callDate: string;
  qualityPercentage: number | null;
  scenario: string | null; scenario1: string | null;
  transcript: string | null; recordingUrl: string | null; mobileNumber: string | null;
  parameters: Array<{ column: string; label: string; value: boolean | null }>;
}

interface ProcessBusinessHealth {
  available: boolean; reason: string | null;
  periodCode: string;
  finance: {
    available: boolean; reason: string | null;
    revenue: number | null; revenueStatus: string | null;
    grn: number | null; agentSalary: number | null;
    agentSalaryIsRealThisMonth: boolean;
    ebit: number | null; operatingProfitPct: number | null;
  };
  headcount: {
    available: boolean; reason: string | null;
    activeHc: number; mandatedHc: number | null; gap: number | null;
    availableCount: number; buffer: number | null; shortfall: number | null;
  };
  hiring: {
    available: boolean; reason: string | null;
    openRequisitions: number; openPositions: number; candidatesInPipeline: number;
    hiredCount: number; pendingHiringCount: number;
  };
}

interface WorkforceCorrelationPoint {
  date: string;
  agentClapPct: number | null;
  auditedCalls: number;
  activeHeadcount: number;
  rampCohortPct: number | null;
  presentHeadcount: number | null;
  plannedHeadcount: number | null;
}
interface WorkforceCorrelation {
  available: boolean; reason: string | null;
  periodFrom: string | null; periodTo: string | null;
  daily: WorkforceCorrelationPoint[];
  weeklyAttrition: Array<{ weekStart: string; exits: number }>;
  rosterCoverageDays: number;
}

const SECTION_STYLE: Record<string, { accent: string; tint: string; icon: typeof Target }> = {
  operations: { accent: "#06B6D4", tint: "linear-gradient(135deg,#ECFEFF 0%,#CFFAFE 100%)", icon: Headphones },
  conversion: { accent: C_BLUE, tint: "linear-gradient(135deg,#EFF6FF 0%,#DBEAFE 100%)", icon: Target },
  risk: { accent: C_RED, tint: "linear-gradient(135deg,#FEF2F2 0%,#FEE2E2 100%)", icon: ShieldAlert },
  conduct: { accent: C_PURPLE, tint: "linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%)", icon: Sparkles },
  quality: { accent: C_GREEN, tint: "linear-gradient(135deg,#ECFDF5 0%,#D1FAE5 100%)", icon: Activity },
  hygiene: { accent: C_AMBER, tint: "linear-gradient(135deg,#FFFBEB 0%,#FEF3C7 100%)", icon: Users2 },
  other: { accent: C_SLATE, tint: "linear-gradient(135deg,#F8FAFC 0%,#F1F5F9 100%)", icon: Activity },
};

function formatValue(value: number | null, unit: string | null): string {
  if (value === null || Number.isNaN(value)) return "no data";
  const u = (unit ?? "").toLowerCase();
  if (u === "percentage" || u === "percent" || u === "ratio") return `${value.toFixed(1)}%`;
  if (u === "seconds") {
    if (value < 90) return `${Math.round(value)}s`;
    return `${Math.floor(value / 60)}m ${String(Math.round(value % 60)).padStart(2, "0")}s`;
  }
  if (u === "currency") return `₹${Math.round(value).toLocaleString("en-IN")}`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Is a move good news? Only knowable when the metric declares a direction. */
function deltaOf(r: Reading): { delta: number; good: boolean | null } | null {
  if (r.value === null || r.priorValue === null) return null;
  const delta = r.value - r.priorValue;
  if (Math.abs(delta) < 0.05) return { delta: 0, good: null };
  if (!r.direction) return { delta, good: null };
  return { delta, good: r.direction === "higher_is_better" ? delta > 0 : delta < 0 };
}

/**
 * Pass/fail against the metric's real configured SLA, the way the reference
 * dashboards state theirs ("Target >= 95%", "Target <= 300s") and colour their
 * project table and comparison charts from it. Returns null -- not a guessed
 * pass -- when no target is configured, which most of this page's metrics do
 * not have yet; the tile then falls back to its section colour instead of
 * claiming a verdict nobody set.
 */
function targetStatus(r: Reading): "pass" | "fail" | null {
  if (r.value === null || r.targetValue === null || !r.direction) return null;
  return r.direction === "higher_is_better"
    ? (r.value >= r.targetValue ? "pass" : "fail")
    : (r.value <= r.targetValue ? "pass" : "fail");
}

/** "Target >= 95%" / "Target <= 300s" -- the comparison the target implies, in the metric's own unit. */
function targetCaption(r: Reading): string | null {
  if (r.targetValue === null || !r.direction) return null;
  const op = r.direction === "higher_is_better" ? "≥" : "≤";
  return `Target ${op} ${formatValue(r.targetValue, r.unit)}`;
}

/**
 * How stale a same-day connector figure actually is -- "today" alone doesn't
 * say whether this number reflects 6am or 11pm, and for an attendance-derived
 * metric those are very different pictures (people written absent become
 * present as punches arrive through the day). Null when there's nothing to
 * time -- no reading, or a manual entry, which has no meaningful "as of".
 */
function freshnessCaption(r: Reading): { short: string; full: string } | null {
  if (!r.provisional || !r.computedAt) return null;
  const computed = new Date(r.computedAt);
  const minutesAgo = Math.round((Date.now() - computed.getTime()) / 60000);
  const hh = String(computed.getHours()).padStart(2, "0");
  const mm = String(computed.getMinutes()).padStart(2, "0");
  const ago = minutesAgo < 60 ? `${minutesAgo}m ago`
    : minutesAgo < 1440 ? `${Math.round(minutesAgo / 60)}h ago`
    : `${Math.round(minutesAgo / 1440)}d ago`;
  return {
    short: ago,
    full: `Today's figure as computed at ${hh}:${mm} (${ago}) — may not reflect attendance changes since then. It will update next time the feed runs, not live on this page.`,
  };
}

/** A chart panel with the reference dashboards' navy header. */
/**
 * Panel shell for every analysis card on the KPI Metrics tab.
 *
 * The default "live" variant mirrors the Live Dashboard's Panel (white card,
 * left accent bar, gradient dot, dark title) so both tabs read as one system.
 * `variant="classic"` keeps the older filled-navy header — used only where a
 * panel's own design depends on it.
 */
function ChartCard({ title, subtitle, children, variant = "live" }: {
  title: string; subtitle?: string; children: React.ReactNode; variant?: "live" | "classic";
}) {
  if (variant === "classic") {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-5 py-3" style={{ background: NAVY }}>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          {subtitle && <p className="text-[10px] text-indigo-200 mt-0.5">{subtitle}</p>}
        </div>
        <div className="px-2 pt-3 pb-4">{children}</div>
      </div>
    );
  }
  return (
    <div className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden" style={{ boxShadow: "0 12px 30px rgba(16,35,57,.08)" }}>
      <div aria-hidden className="absolute left-0 top-0" style={{ width: 4, height: 55, background: "linear-gradient(180deg,#2f6fed,#10b8d4)", borderRadius: "0 0 7px 0" }} />
      <div className="px-5 py-3 pl-6">
        <div className="flex items-center gap-2">
          <span aria-hidden className="shrink-0" style={{ width: 9, height: 9, borderRadius: "50%", background: "linear-gradient(135deg,#2f6fed,#10b8d4)", boxShadow: "0 0 0 4px rgba(47,111,237,.08)" }} />
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">{title}</h3>
        </div>
        {subtitle && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 ml-[17px]">{subtitle}</p>}
      </div>
      <div className="px-2 pt-1 pb-4">{children}</div>
    </div>
  );
}

/** Panel wrapper that mirrors DiallerLivePanel's Panel aesthetic inside ProcessOperationsPage. */
function LivePanel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #dce4ed", borderRadius: 17, boxShadow: "0 12px 30px rgba(16,35,57,.08)", padding: "14px 16px", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 4, height: 55, background: "linear-gradient(180deg,#2f6fed,#10b8d4)", borderRadius: "0 0 7px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingLeft: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: "linear-gradient(135deg,#2f6fed,#10b8d4)", boxShadow: "0 0 0 4px rgba(47,111,237,.08)" }} />
          <h3 style={{ margin: 0, color: "#102f4b", fontSize: 14, fontWeight: 800 }}>{title}</h3>
        </div>
        {sub && <span style={{ fontSize: 10, fontWeight: 800, color: "#0369a1", background: "#e7f6fb", border: "1px solid #c8edf5", borderRadius: 999, padding: "3px 8px" }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

type TrendDir = "positive" | "negative" | "action" | "neutral";

function TrendChip({ trend, label }: { trend: TrendDir; label: string }) {
  const Icon = trend === "positive" ? ArrowUpRight : trend === "negative" ? ArrowDownRight : trend === "action" ? AlertTriangle : Minus;
  const col = trend === "positive"
    ? { bg: "rgba(20,184,166,.14)", br: "#14b8a6", tx: "#0d9488" }
    : trend === "negative"
    ? { bg: "rgba(239,68,68,.14)", br: "#f87171", tx: "#dc2626" }
    : trend === "action"
    ? { bg: "rgba(245,158,11,.14)", br: "#f59e0b", tx: "#d97706" }
    : { bg: "rgba(100,116,139,.14)", br: "#94a3b8", tx: "#475569" };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px",
      borderRadius: 999, fontSize: 9, fontWeight: 800,
      background: col.bg, border: `1px solid ${col.br}`, color: col.tx }}>
      <Icon size={9} /><span>{label}</span>
    </div>
  );
}

/** KPI tile matching the Live Dashboard's KpiCard, so both tabs read as one system. */
function LiveKpiCard({ label, value, sub, color, onClick, trend, trendLabel }: {
  label: string; value: string | number; sub?: string; color: string;
  onClick?: () => void; trend?: TrendDir; trendLabel?: string;
}) {
  return (
    <div style={{ position: "relative", minHeight: 88, padding: "11px 14px", borderRadius: 15, color: "#fff", overflow: "hidden", boxShadow: "0 10px 24px rgba(16,35,57,.10)", background: color, cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}>
      <div aria-hidden style={{ position: "absolute", width: 64, height: 64, borderRadius: "50%", right: -16, top: -22, background: "rgba(255,255,255,.13)" }} />
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".45px", fontWeight: 900, opacity: 0.88 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 950, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, marginTop: 5, opacity: 0.82, fontWeight: 700 }}>{sub}</div>}
      {trend && trendLabel && <div style={{ marginTop: 5 }}><TrendChip trend={trend} label={trendLabel} /></div>}
    </div>
  );
}

// ── GAS premium visual components ─────────────────────────────────────────

/** Conic-gradient score ring (matches GAS .score-ring) */
function GasScoreRing({ pct, color = "#45d49a" }: { pct: number; color?: string }) {
  const safeColor = pct >= 80 ? "#45d49a" : pct >= 55 ? "#e89b19" : "#e5484d";
  const ringColor = color === "#45d49a" ? safeColor : color;
  return (
    <div style={{
      width: 82, height: 82, borderRadius: "50%", flexShrink: 0,
      background: `conic-gradient(${ringColor} ${pct}%,rgba(255,255,255,.13) 0)`,
      boxShadow: "0 10px 22px rgba(3,20,36,.20)", display: "grid", placeItems: "center", position: "relative",
    }}>
      <div style={{ width: 61, height: 61, borderRadius: "50%", background: "#0e3454", position: "absolute" }} />
      <div style={{ position: "relative", textAlign: "center", lineHeight: 1 }}>
        <strong style={{ fontSize: 22, color: "#fff", display: "block" }}>{Math.round(pct)}%</strong>
        <small style={{ color: "#9fc8da", fontSize: 7.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5 }}>SCORE</small>
      </div>
    </div>
  );
}

/** GAS-style KPI card with left accent bar + corner orb */
function GasKpiCard({ label, value, foot, accent, onClick }: {
  label: string; value: string; foot?: string; accent: string; onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      style={{
        background: `linear-gradient(145deg,#fff 58%,${accent}14 100%)`,
        border: "1px solid #dfe6ee", borderRadius: 14,
        padding: "9px 11px 8px", minHeight: 84,
        position: "relative", overflow: "hidden",
        boxShadow: "0 6px 16px rgba(16,35,57,.065)",
        cursor: onClick ? "pointer" : "default", textAlign: "left", width: "100%",
        transition: "box-shadow .18s,transform .18s",
      }}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 10px 22px rgba(16,35,57,.11)"; } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 16px rgba(16,35,57,.065)"; } : undefined}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: accent, borderRadius: "14px 0 0 14px" }} />
      <div style={{ position: "absolute", width: 58, height: 58, borderRadius: "50%", right: -24, top: -25, background: `${accent}14` }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: 7 }}>
        <p style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".45px", color: "#6d7b8c", fontWeight: 900, minHeight: 20, lineHeight: 1.2 }}>{label}</p>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: accent, boxShadow: `0 0 0 4px ${accent}1a`, flexShrink: 0 }} />
      </div>
      <p style={{ fontSize: 21, lineHeight: 1.1, fontWeight: 950, color: "#1b2d42", marginTop: 4, paddingLeft: 7 }}>{value}</p>
      {foot && <p style={{ marginTop: 4, fontSize: 8, color: "#8390a0", fontWeight: 700, paddingLeft: 7 }}>{foot}</p>}
    </Tag>
  );
}

/** Mini signal chip inside the dark executive brief card */
function GasSignal({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div style={{ padding: "7px 8px", border: "1px solid rgba(255,255,255,.12)", borderRadius: 9, background: "rgba(255,255,255,.075)" }}>
      <div style={{ fontSize: 8.5, color: "#a9cbd8", textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 850 }}>{name}</div>
      <div style={{ marginTop: 3, fontSize: 15, color: "#fff", fontWeight: 900 }}>{value}</div>
      {note && <div style={{ marginTop: 2, color: "#a9cbd8", fontSize: 8, fontWeight: 650 }}>{note}</div>}
    </div>
  );
}

/** A single priority action item (high/medium/positive) in the GAS action board */
function GasActionItem({ index, severity, title, body }: {
  index: number; severity: "critical" | "warning" | "positive"; title: string; body: string;
}) {
  const cls = severity === "critical"
    ? { idx: { background: "#ffeaeb", color: "#b82c31" }, chip: { background: "#ffeaeb", color: "#b82c31" }, label: "CRITICAL" }
    : severity === "positive"
    ? { idx: { background: "#e7f7ef", color: "#177747" }, chip: { background: "#e7f7ef", color: "#177747" }, label: "POSITIVE" }
    : { idx: { background: "#fff1d7", color: "#936000" }, chip: { background: "#fff1d7", color: "#936000" }, label: "REVIEW" };
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 8, alignItems: "center",
      padding: "8px 9px", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, minHeight: 42,
      background: "rgba(255,255,255,.09)",
    }}>
      <div style={{ width: 25, height: 25, borderRadius: 8, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 950, ...cls.idx }}>{index}</div>
      <div>
        <strong style={{ display: "block", color: "#fff", fontSize: 11.5, lineHeight: 1.25 }}>{title}</strong>
        <p style={{ margin: "3px 0 0", color: "#d1e5ee", fontSize: 10, lineHeight: 1.38, fontWeight: 650 }}>{body}</p>
      </div>
      <span style={{ padding: "4px 6px", borderRadius: 999, fontSize: 7.5, fontWeight: 950, textTransform: "uppercase", whiteSpace: "nowrap", ...cls.chip }}>{cls.label}</span>
    </div>
  );
}

/** Executive Brief card (dark navy with score ring + health status + signal grid) */
function GasExecutiveBrief({ processName, headcount, metrics, metricsWithData, staleCount, failCount, passCount, periodLabel, health: bh }: {
  processName: string; headcount: number; metrics: number; metricsWithData: number;
  staleCount: number; failCount: number; passCount: number; periodLabel: string;
  health?: ProcessBusinessHealth;
}) {
  const totalTargeted = failCount + passCount;
  const scorePct = totalTargeted > 0 ? Math.round((passCount / totalTargeted) * 100) : (metricsWithData > 0 ? Math.round((metricsWithData / metrics) * 100) : 0);
  const status = scorePct >= 80 ? { label: "HEALTHY", bg: "rgba(69,212,154,.16)", color: "#7ff0bb", border: "rgba(95,226,169,.22)" }
    : scorePct >= 55 ? { label: "WATCH", bg: "rgba(232,155,25,.16)", color: "#ffd283", border: "rgba(255,203,106,.24)" }
    : { label: "CRITICAL", bg: "rgba(229,72,77,.18)", color: "#ffb4b7", border: "rgba(255,153,157,.24)" };
  const narrative = totalTargeted > 0
    ? `${passCount} of ${totalTargeted} targeted metrics are on track.${failCount > 0 ? ` ${failCount} metric${failCount === 1 ? "" : "s"} missing target.` : " All targeted metrics passing."}`
    : `${metricsWithData} of ${metrics} metrics have data.${staleCount > 0 ? ` ${staleCount} may be stale.` : ""}`;
  const fmtLakhBrief = (v: number | null): string => {
    if (v === null) return "—";
    const abs = Math.abs(v); const sign = v < 0 ? "-" : "";
    if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(1)}Cr`;
    if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(1)}L`;
    if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(0)}K`;
    return `${sign}₹${abs.toLocaleString("en-IN")}`;
  };
  const revPerAgent = bh?.finance?.revenue && (bh.headcount.activeHc ?? 0) > 0
    ? Math.round(bh.finance.revenue / bh.headcount.activeHc) : null;
  const hcGap = bh?.headcount?.gap ?? null;
  return (
    <div style={{ padding: "16px 18px", borderRadius: 16, border: "1px solid #1b5770", color: "#fff", position: "relative", overflow: "hidden", background: GAS_BRIEF }}>
      <div aria-hidden style={{ position: "absolute", width: 220, height: 220, borderRadius: "50%", right: -80, bottom: -125, border: "35px solid rgba(255,255,255,.035)", pointerEvents: "none" }} />
      <div style={{ position: "relative" }}>
        <div style={{ marginBottom: 5, color: "#91dce8", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1.25 }}>Process Performance</div>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 20, lineHeight: 1.2, color: "#fff" }}>{processName}</h3>
          <span style={{ padding: "5px 9px", borderRadius: 999, background: "rgba(255,255,255,.10)", border: "1px solid rgba(255,255,255,.14)", fontSize: 9, fontWeight: 800, color: "#d7eef5", whiteSpace: "nowrap" }}>{periodLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "12px 0" }}>
          <GasScoreRing pct={scorePct} />
          <div>
            <span style={{ display: "inline-flex", padding: "5px 8px", borderRadius: 999, background: status.bg, color: status.color, border: `1px solid ${status.border}`, fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: .5 }}>
              {status.label}
            </span>
            <p style={{ margin: "7px 0 0", color: "#d2e5ee", lineHeight: 1.45, fontSize: 11.5, fontWeight: 600, maxWidth: 500 }}>{narrative}</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7 }}>
          <GasSignal name="Headcount" value={String(headcount)}
            note={bh?.headcount?.mandatedHc ? `of ${bh.headcount.mandatedHc} mandate` : "active agents"} />
          <GasSignal name="Quality" value={totalTargeted > 0 ? `${scorePct}%` : "—"}
            note={`${passCount} pass · ${failCount} fail`} />
          <GasSignal name="Rev / Agent" value={fmtLakhBrief(revPerAgent)}
            note="monthly productivity" />
          <GasSignal name="HC Gap" value={hcGap !== null ? (hcGap >= 0 ? `+${hcGap}` : String(hcGap)) : "—"}
            note={hcGap !== null ? (hcGap >= 0 ? "above mandate" : "below mandate") : "no mandate"} />
        </div>
      </div>
    </div>
  );
}

/** Action Board (dark navy, priority action list from insights + feed issues) */
function GasActionBoard({ items }: { items: Array<{ severity: "critical" | "warning" | "positive"; title: string; body: string }> }) {
  return (
    <div style={{ padding: "16px 18px", borderRadius: 16, border: "1px solid #1b5770", color: "#fff", background: GAS_BRIEF, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <h3 style={{ margin: 0, color: "#fff", fontSize: 18 }}>Action Board</h3>
        <span style={{ padding: "4px 7px", borderRadius: 999, background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.14)", fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: .5, color: "#d5ecf6" }}>
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>
      {items.length === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, background: "rgba(255,255,255,.09)" }}>
          <div style={{ width: 25, height: 25, borderRadius: 8, display: "grid", placeItems: "center", fontSize: 14, background: "#e7f7ef", color: "#177747" }}>✓</div>
          <div><strong style={{ color: "#fff", fontSize: 11.5 }}>All clear</strong><p style={{ margin: "2px 0 0", color: "#d1e5ee", fontSize: 10 }}>No critical issues or target misses found.</p></div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 7, alignContent: "start" }}>
          {items.slice(0, 5).map((item, i) => (
            <GasActionItem key={i} index={i + 1} severity={item.severity} title={item.title} body={item.body} />
          ))}
        </div>
      )}
    </div>
  );
}

function Sparkline({ trend, color, big }: { trend: Reading["trend"]; color: string; big?: boolean }) {
  // Only points carrying a number: a gap must read as a gap. connectNulls would
  // draw a straight line through a day nobody measured.
  const points = useMemo(() => trend.filter((p) => p.value !== null), [trend]);
  const gid = useMemo(() => `g${Math.random().toString(36).slice(2, 9)}`, []);
  const h = big ? "h-16" : "h-8";
  if (points.length < 2) {
    return <div className={`${h} flex items-end text-[9px] text-slate-400`}>not enough history</div>;
  }
  return (
    <div className={`${h} -mx-0.5`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 1, bottom: 0, left: 1 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(1), ""]} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.75}
            fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Was the uniform gradient KPI tile every metric rendered as, regardless of
 * whether it was fine or failing. Replaced by HeroKpiCard (below) for the one
 * metric per section actually worth that much space, and MiniKpiChip for
 * everything else -- same click-through, same status colouring, no wall of
 * identically-sized tiles. Kept as a title for the shared delta-hover copy.
 */
const DELTA_TITLE: Record<ReportPeriod, string> = {
  trend: "Against the average of everything older than a week",
  today: "Against yesterday, same time of day",
  wtd: "Against the same weekdays last week",
  mtd: "Against the same days-of-month last month",
};

/**
 * The one metric in a section most worth a reader's attention first: the one
 * with a real configured target that is currently failing it, ranked by how
 * far off target it is (relative gap, direction-aware) rather than
 * whichever happened to come first in the API response. Returns null when
 * nothing in the section has a failing target -- a hero is never forced
 * onto a section that doesn't have one; it just renders as a flat strip.
 */
function heroOf(metrics: Reading[]): Reading | null {
  const failing = metrics.filter((m) => targetStatus(m) === "fail");
  if (!failing.length) return null;
  const gap = (r: Reading) => (r.value === null || !r.targetValue) ? 0 : Math.abs(r.value - r.targetValue) / Math.abs(r.targetValue);
  return failing.reduce((worst, m) => (gap(m) > gap(worst) ? m : worst));
}

/**
 * The section's one enlarged tile — same data KpiCard would show, same
 * click-through, just given the room a metric that's actually failing its
 * target deserves: a bigger number, a bigger trend, and a name for what's
 * wrong instead of making a reader spot it among a wall of equals.
 */
function HeroKpiCard({ r, staleAfter, period, onOpen }: {
  r: Reading; staleAfter: number; period: ReportPeriod; onOpen: () => void;
}) {
  const stale = r.staleDays !== null && r.staleDays > staleAfter;
  const d = deltaOf(r);
  const caption = targetCaption(r);
  return (
    <button type="button" onClick={onOpen} title="Open the full working behind this number"
      className="group relative text-left rounded-2xl overflow-hidden border cursor-pointer transition-all duration-200 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 h-full flex flex-col p-4"
      style={{ borderColor: `${C_RED}40`, background: `linear-gradient(160deg, ${C_RED}12, transparent 65%)` }}>
      <div className="flex items-start gap-1.5 mb-1">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: C_RED_TEXT }}>
          <AlertTriangle size={11} className="shrink-0" />Needs attention
        </span>
        <div className="ml-auto flex shrink-0 gap-1">
          {r.source === "manual" && (
            <span title="This reading was typed in by hand, not written by an automated feed"
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9.5px] font-bold bg-white/70 text-purple-700">
              <PenLine className="h-2 w-2" />manual
            </span>
          )}
          {r.provisional && (() => {
            const fresh = freshnessCaption(r);
            return (
              <span title={fresh?.full ?? "Today is still in progress — this will move as the day fills in"}
                className="rounded px-1 py-0.5 text-[9.5px] font-bold bg-white/70 text-blue-700">
                {fresh ? `today · ${fresh.short}` : "today"}
              </span>
            );
          })()}
          {stale && (
            <span title={`Last reading ${r.staleDays} days ago — history, not current`}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9.5px] font-bold bg-white/70 text-amber-700">
              <Clock className="h-2 w-2" />{r.staleDays}d
            </span>
          )}
        </div>
      </div>
      <p className="text-[11px] font-semibold text-slate-600 leading-tight mb-1.5">{r.label}</p>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[34px] font-black leading-none tabular-nums" style={{ color: C_RED_TEXT }}>
          {formatValue(r.value, r.unit)}
        </span>
        {d && (
          <span title={DELTA_TITLE[period]}
            className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${
              d.good === null ? "text-slate-500" : d.good ? "text-emerald-600" : "text-red-600"}`}>
            {d.delta === 0 ? <Minus className="h-3 w-3" />
              : d.delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {d.delta === 0 ? "flat" : Math.abs(d.delta).toFixed(1)}
          </span>
        )}
      </div>
      {caption && <p className="text-[11px] font-semibold mt-0.5" style={{ color: C_RED_TEXT }}>{caption}</p>}
      <div className="mt-auto pt-2"><Sparkline trend={r.trend} color={C_RED} big /></div>
    </button>
  );
}

/**
 * GAS-style KPI card for a section metric — left accent bar, corner orb,
 * colored value (pass/fail/accent), delta indicator. Clicking opens the
 * drilldown drawer just as the original chip did.
 */
function MiniKpiChip({ r, accent, staleAfter, onOpen }: {
  r: Reading; accent: string; staleAfter: number; onOpen: () => void;
}) {
  const stale = r.staleDays !== null && r.staleDays > staleAfter;
  const status = targetStatus(r);
  const valueColor = status === "fail" ? "#e5484d" : status === "pass" ? "#18a866" : accent;
  const d = deltaOf(r);
  const fresh = r.provisional ? freshnessCaption(r) : null;
  return (
    <button type="button" onClick={onOpen} title="Open the full working behind this number"
      style={{
        background: `linear-gradient(145deg,#fff 58%,${accent}14 100%)`,
        border: "1px solid #dfe6ee", borderRadius: 14,
        padding: "9px 11px 8px", minHeight: 84, width: 152,
        position: "relative", overflow: "hidden",
        boxShadow: "0 6px 16px rgba(16,35,57,.065)",
        cursor: "pointer", textAlign: "left", flexShrink: 0,
        transition: "box-shadow .18s,transform .18s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 10px 22px rgba(16,35,57,.11)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 16px rgba(16,35,57,.065)"; }}
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
    >
      {/* Left accent bar */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: accent, borderRadius: "14px 0 0 14px" }} />
      {/* Corner orb */}
      <div style={{ position: "absolute", width: 58, height: 58, borderRadius: "50%", right: -24, top: -25, background: `${accent}14` }} />
      {/* Header row: label + dot */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, paddingLeft: 7 }}>
        <p style={{ fontSize: 8.5, textTransform: "uppercase", letterSpacing: ".45px", color: "#6d7b8c", fontWeight: 900, lineHeight: 1.2, minHeight: 20, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "normal", wordBreak: "break-word" }}>
          {r.label}
        </p>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: accent, boxShadow: `0 0 0 4px ${accent}1a` }} />
          {r.source === "manual" && <PenLine className="h-2 w-2 text-purple-500" />}
          {stale && <Clock style={{ width: 8, height: 8, color: "#e89b19" }} />}
        </div>
      </div>
      {/* Value row */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4, paddingLeft: 7 }}>
        <span style={{ lineHeight: 1.1, fontWeight: 950, color: r.value === null ? "#94a3b8" : valueColor, fontStyle: r.value === null ? "italic" : undefined, fontSize: r.value === null ? 12 : 21 } as React.CSSProperties}>
          {formatValue(r.value, r.unit)}
        </span>
        {d && (
          <span style={{ fontSize: 9, fontWeight: 900, color: d.good === null ? "#94a3b8" : d.good ? "#18a866" : "#e5484d" }}>
            {d.delta === 0 ? "flat" : (d.delta > 0 ? "↑" : "↓") + Math.abs(d.delta).toFixed(1)}
          </span>
        )}
        {fresh && <span style={{ fontSize: 8, color: "#2f6fed", fontWeight: 700 }}>{fresh.short}</span>}
      </div>
      {/* Target caption */}
      {targetCaption(r) && (
        <p style={{ marginTop: 4, fontSize: 8, color: "#8390a0", fontWeight: 700, paddingLeft: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {targetCaption(r)}
        </p>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ── ENHANCED KPI METRIC CARD (replaces MiniKpiChip in the grid) ──────────
// Responsive width, always-visible mini sparkline, animated target bar,
// pass/fail tint, numerator/denominator, stale/manual badges.
// ═══════════════════════════════════════════════════════════════════════════
function EnhancedMetricCard({ r, accent, staleAfter, period, onOpen }: {
  r: Reading; accent: string; staleAfter: number; period: ReportPeriod; onOpen: () => void;
}) {
  const stale    = r.staleDays !== null && r.staleDays > staleAfter;
  const status   = targetStatus(r);
  const fresh    = r.provisional ? freshnessCaption(r) : null;
  const d        = deltaOf(r);
  const caption  = targetCaption(r);

  // Tint background based on pass/fail
  const cardBg   = status === "pass" ? "linear-gradient(145deg,#f0fdf4 0%,#fff 60%)"
                 : status === "fail" ? "linear-gradient(145deg,#fff1f2 0%,#fff 60%)"
                 : `linear-gradient(145deg,${accent}0d 0%,#fff 60%)`;
  const barColor = status === "pass" ? "#18a866" : status === "fail" ? "#e5484d" : accent;
  const valueColor = status === "pass" ? "#15803d" : status === "fail" ? "#dc2626" : accent;

  // Target progress %
  let progressPct = 0;
  if (r.targetValue !== null && r.value !== null && r.direction) {
    if (r.direction === "higher_is_better") {
      progressPct = Math.min(100, Math.max(3, (r.value / r.targetValue) * 100));
    } else {
      // lower is better: full bar = meeting target, empty = far over
      const ratio = r.targetValue > 0 ? r.value / r.targetValue : 1;
      progressPct = Math.min(100, Math.max(3, ratio <= 1 ? 100 : Math.max(3, 100 - (ratio - 1) * 100)));
    }
  }

  const hasTarget = r.targetValue !== null && r.direction !== null;

  return (
    <button
      type="button" onClick={onOpen}
      title="Click to drill down into full history, formula, and source"
      style={{ background: cardBg, border: `1px solid ${status === "pass" ? "#bbf7d0" : status === "fail" ? "#fecdd3" : "#dfe6ee"}`,
        borderRadius: 14, position: "relative", overflow: "hidden",
        boxShadow: "0 4px 14px rgba(16,35,57,.07)",
        cursor: "pointer", textAlign: "left", width: "100%",
        transition: "box-shadow .18s, transform .18s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(16,35,57,.13)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 14px rgba(16,35,57,.07)"; }}
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
    >
      {/* Left accent bar — thicker, colored by pass/fail */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
        background: `linear-gradient(180deg,${barColor},${barColor}88)`, borderRadius: "14px 0 0 14px" }} />

      <div style={{ padding: "7px 10px 6px 12px" }}>
        {/* Top row: label + status badge (single line, tight) */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 3, marginBottom: 3 }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: "#6d7b8c",
            fontWeight: 900, lineHeight: 1.2, flex: 1, overflow: "hidden",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" } as React.CSSProperties}>
            {r.label}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, paddingTop: 1 }}>
            {status === "pass" && <span style={{ fontSize: 9, fontWeight: 900, color: "#15803d", background: "#dcfce7", borderRadius: 3, padding: "1px 4px" }}>✓</span>}
            {status === "fail" && <span style={{ fontSize: 9, fontWeight: 900, color: "#dc2626", background: "#fee2e2", borderRadius: 3, padding: "1px 4px" }}>!</span>}
            {stale && <span title={`${r.staleDays}d old`}><Clock style={{ width: 8, height: 8, color: "#e89b19" }} /></span>}
            {r.source === "manual" && <span title="Manual entry"><PenLine style={{ width: 8, height: 8, color: "#7c3aed" }} /></span>}
          </div>
        </div>

        {/* Value + delta + numerator — single compact row */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 1 }}>
          <span style={{
            fontSize: r.value === null ? 13 : 22,
            lineHeight: 1, fontWeight: 950, fontVariantNumeric: "tabular-nums",
            color: r.value === null ? "#94a3b8" : valueColor,
            fontStyle: r.value === null ? "italic" : undefined,
          } as React.CSSProperties}>
            {formatValue(r.value, r.unit)}
          </span>
          {d && (
            <span style={{ fontSize: 10.5, fontWeight: 800,
              color: d.good === null ? "#94a3b8" : d.good ? "#16a34a" : "#dc2626",
              display: "flex", alignItems: "center", gap: 1 }}>
              {d.delta === 0 ? <Minus style={{ width: 10, height: 10 }} />
                : d.delta > 0 ? <ArrowUpRight style={{ width: 10, height: 10 }} /> : <ArrowDownRight style={{ width: 10, height: 10 }} />}
              {d.delta !== 0 && Math.abs(d.delta).toFixed(1)}
            </span>
          )}
        </div>

        {/* Target caption — only if there's a configured target */}
        {caption && (
          <p style={{ fontSize: 9.5, color: status === "fail" ? "#dc2626" : status === "pass" ? "#15803d" : "#8390a0",
            fontWeight: 700, marginBottom: hasTarget ? 3 : 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {caption}
          </p>
        )}

        {/* Target progress bar — compact 3px */}
        {hasTarget && (
          <div style={{ height: 3, background: "#e8edf3", borderRadius: 99, overflow: "hidden", marginBottom: 3 }}>
            <div style={{ height: "100%", width: `${progressPct}%`, background: barColor,
              borderRadius: 99, transition: "width .6s cubic-bezier(.4,0,.2,1)" }} />
          </div>
        )}

        {/* Mini sparkline — compact 18px */}
        {r.trend.length >= 2 && (
          <div style={{ height: 18, marginTop: 2, marginLeft: -2, marginRight: -2 }}>
            <Sparkline trend={r.trend} color={barColor} />
          </div>
        )}
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ── SECTION OVERVIEW STRIP — one chip per section showing pass/fail ratio ─
// ═══════════════════════════════════════════════════════════════════════════
function SectionOverviewStrip({ sections, ungrouped, staleAfterDays, activeSectionKey, onSectionClick }: {
  sections: Section[];
  ungrouped: Reading[];
  staleAfterDays: number;
  activeSectionKey: string | null;
  onSectionClick: (key: string) => void;
}) {
  const allSections = [
    ...sections,
    ...(ungrouped.length ? [{ key: "other", title: "Other", blurb: null, metrics: ungrouped }] : []),
  ];
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
      {allSections.map((s) => {
        const sStyle = SECTION_STYLE[s.key] ?? SECTION_STYLE.other;
        const pass  = s.metrics.filter((m) => targetStatus(m) === "pass").length;
        const fail  = s.metrics.filter((m) => targetStatus(m) === "fail").length;
        const total = s.metrics.length;
        const hasTarget = s.metrics.some((m) => m.targetValue !== null);
        const statusColor = !hasTarget ? sStyle.accent
          : fail > 0 ? "#e5484d" : "#18a866";
        const isActive = activeSectionKey === s.key;

        return (
          <button key={s.key} type="button" onClick={() => onSectionClick(s.key)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "7px 12px", borderRadius: 10, cursor: "pointer",
              background: isActive ? NAVY : "#fff",
              border: `1.5px solid ${isActive ? NAVY : "#dfe6ee"}`,
              boxShadow: isActive ? "0 4px 12px rgba(13,20,69,.25)" : "0 2px 6px rgba(16,35,57,.06)",
              transition: ".18s", minWidth: 100,
            }}
            onMouseEnter={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.borderColor = NAVY; (e.currentTarget as HTMLElement).style.background = "#f0f4ff"; } }}
            onMouseLeave={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.borderColor = "#dfe6ee"; (e.currentTarget as HTMLElement).style.background = "#fff"; } }}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          >
            {/* Section color dot */}
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor, flexShrink: 0,
              boxShadow: `0 0 0 3px ${statusColor}22` }} />
            <div>
              <p style={{ fontSize: 10, fontWeight: 900, color: isActive ? "#d0e8f5" : "#102f4b",
                margin: 0, letterSpacing: .2 }}>{s.title}</p>
              <p style={{ fontSize: 8.5, color: isActive ? "#a9cbd8" : "#8390a0", margin: 0, fontWeight: 700 }}>
                {total} metric{total !== 1 ? "s" : ""}
                {hasTarget ? ` · ${pass}/${pass + fail} pass` : ""}
              </p>
            </div>
            {/* Mini pass/fail bar */}
            {hasTarget && (pass + fail) > 0 && (
              <div style={{ width: 28, height: 4, background: "#fee2e2", borderRadius: 99, overflow: "hidden", flexShrink: 0 }}>
                <div style={{ height: "100%", width: `${(pass / (pass + fail)) * 100}%`,
                  background: "#18a866", borderRadius: 99 }} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ── ENHANCED SECTION BLOCK — replaces the old map() in the KPI view ──────
// Features:
//  • Section summary bar with metric count, pass/fail ratio, and fill bar
//  • Filter buttons (All / Pass / Fail / No Data / Stale)
//  • Responsive grid (2→3→4 cols based on viewport)
//  • Hero card (if a metric is failing target) OR all cards in grid
//  • EnhancedMetricCard for each metric
//  • "X metrics not meeting target" badge on header
// ═══════════════════════════════════════════════════════════════════════════
type MetricFilter = "all" | "pass" | "fail" | "nodata" | "stale";

function EnhancedSectionBlock({ s, staleAfterDays, period, onOpenDrill, isActive, onRef }: {
  s: Section & { key: string };
  staleAfterDays: number;
  period: ReportPeriod;
  onOpenDrill: (key: string) => void;
  isActive: boolean;
  onRef?: (el: HTMLElement | null) => void;
}) {
  const [filter, setFilter] = useState<MetricFilter>("all");
  const [expanded, setExpanded] = useState(true);

  const sStyle = SECTION_STYLE[s.key] ?? SECTION_STYLE.other;
  const Icon         = sStyle.icon;
  const pass         = s.metrics.filter((m) => targetStatus(m) === "pass").length;
  const fail         = s.metrics.filter((m) => targetStatus(m) === "fail").length;
  const noData       = s.metrics.filter((m) => m.value === null).length;
  const staleCount   = s.metrics.filter((m) => m.staleDays !== null && m.staleDays > staleAfterDays).length;
  const totalMetrics = s.metrics.length;   // renamed from 'total' to prevent any scope shadowing
  const hasTarget    = s.metrics.some((m) => m.targetValue !== null);
  const passPct      = (pass + fail) > 0 ? (pass / (pass + fail)) * 100 : 0;
  const overallStatus = !hasTarget ? "neutral" : fail > 0 ? "fail" : "pass";
  const headerAccent  = overallStatus === "fail" ? "#e5484d" : overallStatus === "pass" ? "#18a866" : sStyle.accent;

  const visible = s.metrics.filter((m) => {
    if (filter === "pass")   return targetStatus(m) === "pass";
    if (filter === "fail")   return targetStatus(m) === "fail";
    if (filter === "nodata") return m.value === null;
    if (filter === "stale")  return m.staleDays !== null && m.staleDays > staleAfterDays;
    return true;
  });

  const hero = filter === "all" ? heroOf(visible) : null;
  const rest = hero ? visible.filter((m) => m.metricKey !== hero.metricKey) : visible;

  // Split from the .filter() below on purpose: a type annotation on FILTERS
  // itself does not flow through a chained .filter() back into this array
  // literal, so each `key` here was inferred as the widened `string` instead
  // of narrowing to MetricFilter's literal union. Annotating this base array
  // directly is what actually narrows it.
  const ALL_FILTERS: { key: MetricFilter; label: string; count: number; color: string }[] = [
    { key: "all",    label: "All",     count: totalMetrics, color: NAVY },
    { key: "pass",   label: "Pass",    count: pass,         color: "#18a866" },
    { key: "fail",   label: "Fail",    count: fail,         color: "#e5484d" },
    { key: "nodata", label: "No data", count: noData,       color: "#94a3b8" },
    { key: "stale",  label: "Stale",   count: staleCount,   color: "#e89b19" },
  ];
  const FILTERS = ALL_FILTERS.filter((f) => f.key === "all" || f.count > 0);

  return (
    <section ref={onRef} style={{
      background: "#fff", borderRadius: 16,
      border: `1.5px solid ${isActive ? headerAccent + "60" : "#dfe6ee"}`,
      boxShadow: isActive ? `0 0 0 3px ${headerAccent}18, 0 12px 30px rgba(16,35,57,.08)` : "0 4px 16px rgba(16,35,57,.06)",
      overflow: "hidden", transition: "box-shadow .2s, border-color .2s",
    }}>

      {/* ── Section Header — single compact row ──────────────────────── */}
      <div style={{ padding: "7px 12px 6px", borderBottom: `1px solid ${headerAccent}18`,
        background: `linear-gradient(135deg,${headerAccent}08,transparent 55%)` }}>

        {/* Single row: icon · title · count · status · [progress bar] · filters · collapse */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {/* Icon */}
          <span style={{ padding: "3px 4px", borderRadius: 6, background: `${headerAccent}18`, display: "flex", flexShrink: 0 }}>
            <Icon style={{ width: 12, height: 12, color: headerAccent }} />
          </span>

          {/* Title */}
          <h2 style={{ margin: 0, color: "#102f4b", fontSize: 13, fontWeight: 800, letterSpacing: .1, whiteSpace: "nowrap" }}>
            {s.title}
          </h2>

          {/* Metric count badge */}
          <span style={{ fontSize: 9, fontWeight: 850, color: "#50677d",
            background: "#edf5fc", border: "1px solid #d8e7f3", borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap" }}>
            {totalMetrics}
          </span>

          {/* Status inline badge */}
          {fail > 0 && (
            <span style={{ fontSize: 9, fontWeight: 850, color: "#dc2626",
              background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 999, padding: "2px 7px",
              display: "flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}>
              <AlertTriangle style={{ width: 8, height: 8 }} />{fail} below
            </span>
          )}
          {pass > 0 && fail === 0 && hasTarget && (
            <span style={{ fontSize: 9, fontWeight: 850, color: "#15803d",
              background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap" }}>
              {pass}/{pass + fail} ✓
            </span>
          )}

          {/* Pass/fail progress bar — inline, compact */}
          {hasTarget && (pass + fail) > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 60 }}>
              <div style={{ flex: 1, height: 4, background: "#fee2e2", borderRadius: 99, overflow: "hidden", minWidth: 40 }}>
                <div style={{ height: "100%", width: `${passPct}%`,
                  background: "linear-gradient(90deg,#18a866,#22c55e)", borderRadius: 99,
                  transition: "width .6s cubic-bezier(.4,0,.2,1)" }} />
              </div>
              {staleCount > 0 && <span style={{ fontSize: 8.5, color: "#e89b19", fontWeight: 700, whiteSpace: "nowrap" }}>{staleCount} stale</span>}
            </div>
          )}

          {/* Filter pills — compact, right-aligned */}
          <div style={{ display: "flex", gap: 3, marginLeft: "auto", flexWrap: "nowrap" }}>
            {FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                style={{
                  padding: "2px 8px", borderRadius: 999, cursor: "pointer",
                  fontSize: 9, fontWeight: 850,
                  border: `1px solid ${filter === f.key ? f.color : "#e2e8f0"}`,
                  background: filter === f.key ? f.color : "transparent",
                  color: filter === f.key ? "#fff" : "#64748b",
                  transition: ".15s", whiteSpace: "nowrap",
                }}
                className="focus:outline-none focus-visible:ring-1">
                {f.label} ({f.count})
              </button>
            ))}
          </div>

          {/* Collapse toggle */}
          <button type="button" onClick={() => setExpanded(v => !v)}
            style={{ padding: "2px 6px", borderRadius: 6, border: "1px solid #e2e8f0",
              background: "transparent", cursor: "pointer", fontSize: 8.5, fontWeight: 700, color: "#94a3b8",
              display: "flex", alignItems: "center", flexShrink: 0 }}
            className="focus:outline-none focus-visible:ring-1">
            {expanded ? <Minus style={{ width: 9, height: 9 }} /> : <ArrowUpRight style={{ width: 9, height: 9 }} />}
          </button>
        </div>
      </div>

      {/* ── Metrics grid ───────────────────────────────────────────────── */}
      {expanded && (
        <div style={{ padding: "10px 12px" }}>
          {visible.length === 0 ? (
            <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, padding: "4px 0" }}>
              No metrics match this filter.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
              {hero && (
                <div style={{ gridColumn: "span 2", minWidth: 0 }}>
                  <HeroKpiCard r={hero} staleAfter={staleAfterDays} period={period}
                    onOpen={() => onOpenDrill(hero.metricKey)} />
                </div>
              )}
              {rest.map((r, i) => (
                <EnhancedMetricCard
                  key={r.metricKey} r={r}
                  accent={GAS_KPI_ACCENTS[i % GAS_KPI_ACCENTS.length]}
                  staleAfter={staleAfterDays}
                  period={period}
                  onOpen={() => onOpenDrill(r.metricKey)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const CLAP_META: Record<ClapVoiceOfCustomer["clapBreakdown"][number]["clap"], { color: string; icon: typeof User }> = {
  Customer: { color: "#3B82F6", icon: User },
  Logistic: { color: "#F59E0B", icon: Truck },
  Agent:    { color: "#E11D48", icon: Headphones },
  Product:  { color: "#10B981", icon: Package },
};

/**
 * Real root-cause classification (CLAP: Customer/Logistic/Agent/Product) and
 * verbatim customer quotes for a process's audited calls -- not a metric
 * percentage, the actual reason behind it. The taxonomy and the underlying
 * data are the same ones already proven live in the sibling Mydashboards
 * project; this reads the same upstream db_audit source, never a copy of it.
 */
function VoiceOfCustomerPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "voice-of-customer", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ClapVoiceOfCustomer>>(
      `/api/process-operations/${processId}/voice-of-customer?period=${period}`),
  });
  const [category, setCategory] = useState<"agent" | "logistic" | "product">("agent");
  const voc = data?.data;
  const { openCall, drawer } = useCallDetailDrawer(processId);

  if (isLoading || !voc) {
    return (
      <ChartCard variant="classic" title="Voice of the Customer" subtitle="Real root-cause split and verbatim quotes from audited calls">
        <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading what customers actually said…
        </div>
      </ChartCard>
    );
  }
  if (!voc.available || !voc.clapBreakdown.length) {
    return (
      <ChartCard variant="classic" title="Voice of the Customer" subtitle="Real root-cause split and verbatim quotes from audited calls">
        <p className="text-xs text-slate-400 italic px-3 py-4">
          {voc.reason ?? "Not available for this process."}
        </p>
      </ChartCard>
    );
  }

  const quotesForCategory = voc.quotes[category];
  return (
    <ChartCard variant="classic" title="Voice of the Customer"
      subtitle={`${voc.totalAuditedCalls.toLocaleString("en-IN")} audited call${voc.totalAuditedCalls === 1 ? "" : "s"} — what's actually behind them, not just a score`}>
      <div className="px-3">
        {/* CLAP breakdown -- real root cause, not agent quality alone. Segments
            for Agent/Logistic/Product double as the category selector below
            (the same setCategory() the buttons already call) -- Customer has
            no quotes bucket (see the category selector comment) so stays a
            plain, non-interactive segment rather than a dead click target. */}
        <div className="flex h-6 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800">
          {voc.clapBreakdown.map((c) => {
            const clickable = c.clap === "Agent" || c.clap === "Logistic" || c.clap === "Product";
            const segCategory = c.clap.toLowerCase() as "agent" | "logistic" | "product";
            return clickable ? (
              <button key={c.clap} type="button" onClick={() => setCategory(segCategory)}
                title={`${c.clap}: ${c.pct}% (${c.count} calls) — click to see quotes`}
                className="cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
                style={{ width: `${c.pct}%`, background: CLAP_META[c.clap].color }} />
            ) : (
              <div key={c.clap} title={`${c.clap}: ${c.pct}% (${c.count} calls)`}
                style={{ width: `${c.pct}%`, background: CLAP_META[c.clap].color }} />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
          {voc.clapBreakdown.map((c) => {
            const Icon = CLAP_META[c.clap].icon;
            return (
              <span key={c.clap} className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: CLAP_META[c.clap].color }} />
                {c.clap} {c.pct}%
              </span>
            );
          })}
        </div>
        <p className="text-[11.5px] text-slate-400 mt-1.5">
          Every audited call classified by its real recorded scenario — Agent means the call turned on
          agent behaviour itself (needs improvement, hold procedure, fraud complaint), not just "someone
          called." Customer/Product/Logistic mean the root issue lay elsewhere.
        </p>

        <ClapHeatmapRow processId={processId} />

        {/* Category selector -- only Agent/Logistic/Product carry verbatim quotes */}
        <div className="flex gap-1.5 mt-3">
          {(["agent", "logistic", "product"] as const).map((cat) => {
            const meta = CLAP_META[(cat.charAt(0).toUpperCase() + cat.slice(1)) as ClapVoiceOfCustomer["clapBreakdown"][number]["clap"]];
            const Icon = meta.icon;
            const n = voc.quotes[cat].positive.length + voc.quotes[cat].negative.length;
            return (
              <button key={cat} type="button" onClick={() => setCategory(cat)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold border transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                  category === cat ? "text-white" : "text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                style={category === cat ? { background: meta.color, borderColor: meta.color } : undefined}>
                <Icon className="h-3 w-3 shrink-0" />
                {cat[0].toUpperCase() + cat.slice(1)} {n > 0 && <span className="opacity-80">({n})</span>}
              </button>
            );
          })}
        </div>

        <ScenarioBreakdownRow processId={processId} period={period} category={category} />

        <div className="grid sm:grid-cols-2 gap-3 mt-2.5 mb-1">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-emerald-600 mb-1.5">What went well</p>
            {quotesForCategory.positive.length ? (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {quotesForCategory.positive.map((q, i) => (
                  <button key={i} type="button"
                    onClick={() => q.hasTranscript && openCall({ employeeCode: q.employeeCode, callDate: q.callDate })}
                    disabled={!q.hasTranscript}
                    title={q.hasTranscript ? "Open this call's full transcript, recording and customer mobile number" : "No transcript recorded for this call"}
                    className="w-full text-left rounded-lg bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/50 px-3 py-2 cursor-pointer disabled:cursor-not-allowed hover:bg-emerald-100/70 dark:hover:bg-emerald-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500">
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-snug">"{q.quote}"</p>
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                      {q.employeeName} ({q.employeeCode}) · {q.callDate.slice(0, 10)}
                      {q.hasTranscript && <ChevronRight size={11} className="text-slate-300 shrink-0" />}
                    </p>
                  </button>
                ))}
              </div>
            ) : <p className="text-[12px] text-slate-400 italic">No positive quotes recorded for this category this period.</p>}
          </div>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-red-600 mb-1.5">What went wrong</p>
            {quotesForCategory.negative.length ? (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {quotesForCategory.negative.map((q, i) => (
                  <button key={i} type="button"
                    onClick={() => q.hasTranscript && openCall({ employeeCode: q.employeeCode, callDate: q.callDate })}
                    disabled={!q.hasTranscript}
                    title={q.hasTranscript ? "Open this call's full transcript, recording and customer mobile number" : "No transcript recorded for this call"}
                    className="w-full text-left rounded-lg bg-red-50/70 dark:bg-red-950/20 border border-red-100 dark:border-red-900/50 px-3 py-2 cursor-pointer disabled:cursor-not-allowed hover:bg-red-100/70 dark:hover:bg-red-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500">
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 leading-snug">"{q.quote}"</p>
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                      {q.employeeName} ({q.employeeCode}) · {q.callDate.slice(0, 10)}
                      {q.hasTranscript && <ChevronRight size={11} className="text-slate-300 shrink-0" />}
                    </p>
                  </button>
                ))}
              </div>
            ) : <p className="text-[12px] text-slate-400 italic">No negative quotes recorded for this category this period.</p>}
          </div>
        </div>
      </div>
      {drawer}
    </ChartCard>
  );
}

/**
 * Day x CLAP-category heat-cell matrix (Mydashboards' pivot-table idiom) --
 * which days actually carried a spike of Agent/Logistic/Product/Customer-
 * attributed calls, not just the period-aggregated share the bar above
 * shows. Always the real last 14 days (see the backend function for why
 * this ignores the page's period selector). No charting library: a plain
 * grid of cells whose background alpha is value/max, same technique
 * Mydashboards' own heatBg() uses.
 */
function ClapHeatmapRow({ processId }: { processId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "clap-heatmap", processId],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ClapDailyHeatmap>>(
      `/api/process-operations/${processId}/voice-of-customer/heatmap`),
  });
  const hm = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-[9.5px] text-slate-400 mt-2">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />Loading the 14-day pattern…
      </div>
    );
  }
  if (!hm?.available || hm.days.length < 3) {
    return null; // Not enough days to call it a "pattern" -- quietly skip rather than show a near-empty grid.
  }

  const CATS: Array<ClapVoiceOfCustomer["clapBreakdown"][number]["clap"]> = ["Agent", "Product", "Logistic", "Customer"];
  const maxByCat: Record<string, number> = {};
  for (const cat of CATS) maxByCat[cat] = Math.max(1, ...hm.days.map((d) => d.counts[cat]));

  return (
    <div className="mt-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
        Last 14 days by category — darker means more calls that day, not worse
      </p>
      <div className="overflow-x-auto">
        <table className="text-[11px] border-collapse">
          <thead>
            <tr>
              <th className="text-left pr-2 py-0.5 font-semibold text-slate-400"> </th>
              {hm.days.map((d) => (
                <th key={d.date} className="px-1 py-0.5 font-normal text-slate-400 whitespace-nowrap" title={d.date}>
                  {d.date.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATS.map((cat) => (
              <tr key={cat}>
                <td className="text-right pr-2 py-0.5 font-semibold text-slate-500 whitespace-nowrap">{cat}</td>
                {hm.days.map((d) => {
                  const n = d.counts[cat];
                  const alpha = n === 0 ? 0 : Math.min(0.9, 0.15 + (n / maxByCat[cat]) * 0.75);
                  return (
                    <td key={d.date} title={`${cat} · ${d.date}: ${n} call${n === 1 ? "" : "s"}`}
                      className="w-6 h-5 text-center tabular-nums"
                      style={{ background: alpha ? `${CLAP_META[cat].color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : undefined }}>
                      {n > 0 ? n : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Fatal calls -- Mydashboards' own dedicated red-gradient section, missing
 * from this page until now. A fatal call is one where all six of the
 * severity-critical parameters scored 0 (see FATAL_PARAM_COLS on the
 * backend) -- the domain rule that a severe miss on any of these zeroes the
 * whole call, independent of how the other parameters scored. Each row
 * opens the same CallDetailDrawer the CLAP scenario drill already uses --
 * this is the second real consumer of that component, not a speculative one.
 */
function FatalCallsPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "fatal-calls", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<FatalCallsResult>>(
      `/api/process-operations/${processId}/fatal-calls?period=${period}`),
  });
  const fc = data?.data;
  const { openCall, drawer } = useCallDetailDrawer(processId);

  return (
    <ChartCard title="Fatal calls"
      subtitle="Every audited call where a severity-critical parameter failed outright, regardless of the rest of the score">
      <div className="px-3">
        {isLoading || !fc ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Checking for fatal calls…
          </div>
        ) : !fc.available ? (
          <p className="text-xs text-slate-400 italic py-1">{fc.reason}</p>
        ) : !fc.calls.length ? (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-2 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">{fc.reason}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-red-200 dark:border-red-900 overflow-hidden">
            <div className="px-2.5 py-1.5 bg-gradient-to-r from-red-700 to-red-600 text-white text-[10px] font-bold uppercase tracking-wide">
              {fc.calls.length} fatal call{fc.calls.length === 1 ? "" : "s"} this period
            </div>
            <div className="max-h-56 overflow-y-auto">
              {fc.calls.map((c, i) => (
                <button key={i} type="button"
                  onClick={() => c.hasTranscript && openCall({ employeeCode: c.employeeCode, callDate: c.callDate })}
                  disabled={!c.hasTranscript}
                  title={c.hasTranscript ? "Open this call's full audit detail" : "No transcript recorded for this call"}
                  className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 text-[10.5px] border-t border-red-100 dark:border-red-900/50 first:border-t-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-50/70 dark:hover:bg-red-950/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500">
                  <span className="text-slate-500 shrink-0 w-32">{c.callDate}</span>
                  <span className="text-slate-700 dark:text-slate-300 font-medium truncate w-28 shrink-0">{c.employeeName}</span>
                  <span className="text-slate-500 truncate flex-1">{c.scenario ?? "—"}</span>
                  {c.hasTranscript ? <ChevronRight size={11} className="text-slate-300 shrink-0" /> : <span className="w-2.5 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {drawer}
    </ChartCard>
  );
}

/** TQ/MQ/BQ badge -- same three-tier vocabulary the table below stack-ranks by. */
function BandBadge({ band }: { band: "TQ" | "MQ" | "BQ" }) {
  const cls = band === "TQ"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
    : band === "MQ"
    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
    : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";
  return <span className={`inline-flex items-center justify-center w-8 rounded-md px-1 py-0.5 text-[9.5px] font-bold ${cls}`}>{band}</span>;
}

/**
 * Agent Audit Summary -- full stack-ranked roster, ported from Mydashboards'
 * getAgentAuditBandSummary (verified against its source, not reverse-
 * engineered from the UI): TQ = calls scoring >=80%, MQ = 60-79%, BQ = 0-59%,
 * counted per call within each agent, not a single cutoff on the agent's own
 * average. cqScore is the average over non-fatal calls only -- a fatal call
 * already failed outright and would otherwise drag a "quality" average down
 * by a measure that isn't grading quality at all. Sorted worst-first (lowest
 * cqScore first) so a reader meets whoever needs attention before the rest,
 * matching this page's established convention elsewhere.
 */
function AgentAuditSummaryPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "agent-audit-summary", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<AgentAuditSummary>>(
      `/api/process-operations/${processId}/agent-audit-summary?period=${period}`),
  });
  const summary = data?.data;
  const sorted = useMemo(
    () => summary?.rows.slice().sort((a, b) => (a.cqScore ?? 0) - (b.cqScore ?? 0)) ?? [],
    [summary],
  );
  const { openCall, drawer } = useCallDetailDrawer(processId);
  // Every column drills into this agent's calls -- unfiltered from Agent/Audits/
  // CQ Score/Fatal/Band, narrowed to the clicked band from TQ/MQ/BQ. Clicking
  // the same cell again on the same row closes it.
  const [expanded, setExpanded] = useState<{ employeeCode: string; band: "TQ" | "MQ" | "BQ" | "ALL" } | null>(null);
  const toggleExpanded = (employeeCode: string, band: "TQ" | "MQ" | "BQ" | "ALL") =>
    setExpanded((prev) => (prev?.employeeCode === employeeCode && prev.band === band ? null : { employeeCode, band }));
  const cellCls = "cursor-pointer hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded";

  return (
    <ChartCard title="Agent audit summary"
      subtitle="Every audited agent, stack-ranked TQ/MQ/BQ by call-level score -- worst first">
      <div className="px-3">
        {isLoading || !summary ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Ranking agents…
          </div>
        ) : !summary.available ? (
          <p className="text-xs text-slate-400 italic py-1">{summary.reason}</p>
        ) : !sorted.length ? (
          <p className="text-xs text-slate-400 italic py-1">No audited agents in this period.</p>
        ) : (
          <>
            <div className="flex items-center gap-3 pb-2 text-[10.5px] font-semibold">
              <span className="flex items-center gap-1"><BandBadge band="TQ" />{summary.totals.tq}</span>
              <span className="flex items-center gap-1"><BandBadge band="MQ" />{summary.totals.mq}</span>
              <span className="flex items-center gap-1"><BandBadge band="BQ" />{summary.totals.bq}</span>
              <span className="text-slate-400 font-normal ml-auto">{sorted.length} agent{sorted.length === 1 ? "" : "s"}</span>
            </div>
            <div className="overflow-x-auto -mx-3 px-3">
              <table className="w-full text-[10.5px] border-collapse">
                <thead>
                  <tr className="text-left text-slate-400 uppercase tracking-wide text-[9px]">
                    <th className="pb-1.5 pr-2 font-semibold">Agent</th>
                    <th className="pb-1.5 pr-2 font-semibold text-right">Audits</th>
                    <th className="pb-1.5 pr-2 font-semibold text-right">CQ Score</th>
                    <th className="pb-1.5 pr-2 font-semibold text-right">Fatal</th>
                    <th className="pb-1.5 pr-2 font-semibold text-center">Band</th>
                    <th className="pb-1.5 pr-2 font-semibold text-right">TQ</th>
                    <th className="pb-1.5 pr-2 font-semibold text-right">MQ</th>
                    <th className="pb-1.5 font-semibold text-right">BQ</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const isExpanded = expanded?.employeeCode === r.employeeCode;
                    return (
                      <Fragment key={r.employeeCode}>
                        <tr className="border-t border-slate-100 dark:border-slate-800">
                          <td className={`py-1 pr-2 font-medium text-slate-700 dark:text-slate-300 truncate max-w-[10rem] ${cellCls}`}
                            title="Click to see this agent's audited calls"
                            onClick={() => toggleExpanded(r.employeeCode, "ALL")}>{r.employeeName}</td>
                          <td className={`py-1 pr-2 text-right text-slate-500 ${cellCls}`}
                            title="Click to see this agent's audited calls"
                            onClick={() => toggleExpanded(r.employeeCode, "ALL")}>{r.auditCount}</td>
                          <td className={`py-1 pr-2 text-right font-semibold text-slate-700 dark:text-slate-300 ${cellCls}`}
                            title="Click to see this agent's audited calls"
                            onClick={() => toggleExpanded(r.employeeCode, "ALL")}>
                            {r.cqScore !== null ? `${r.cqScore}%` : "—"}
                          </td>
                          <td className={`py-1 pr-2 text-right ${cellCls}`}
                            title="Click to see this agent's audited calls"
                            onClick={() => toggleExpanded(r.employeeCode, "ALL")}>
                            {r.fatalCount > 0
                              ? <span className="text-red-600 font-semibold">{r.fatalCount} ({r.fatalPct}%)</span>
                              : <span className="text-slate-400">0</span>}
                          </td>
                          <td className={`py-1 pr-2 text-center ${cellCls}`}
                            title="Click to see this agent's audited calls"
                            onClick={() => toggleExpanded(r.employeeCode, "ALL")}><BandBadge band={r.band} /></td>
                          <td className={`py-1 pr-2 text-right text-emerald-600 ${cellCls}`}
                            title="Click to see this agent's TQ (>=80%) calls"
                            onClick={() => toggleExpanded(r.employeeCode, "TQ")}>{r.tqCount}</td>
                          <td className={`py-1 pr-2 text-right text-amber-600 ${cellCls}`}
                            title="Click to see this agent's MQ (60-79%) calls"
                            onClick={() => toggleExpanded(r.employeeCode, "MQ")}>{r.mqCount}</td>
                          <td className={`py-1 text-right text-red-600 ${cellCls}`}
                            title="Click to see this agent's BQ (0-59%) calls"
                            onClick={() => toggleExpanded(r.employeeCode, "BQ")}>{r.bqCount}</td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50/60 dark:bg-slate-900/40">
                            <td colSpan={8} className="px-2 py-2">
                              <EmployeeRecentCallsRow processId={processId} employeeCode={r.employeeCode} period={period}
                                onSelectCall={openCall} bandFilter={expanded.band === "ALL" ? undefined : expanded.band} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {drawer}
    </ChartCard>
  );
}

/** A single circular gauge, pure SVG (no chart library) -- radius/stroke
 *  fixed so five of these sit evenly in one row on a phone-width screen. */
function RadialGauge({ label, pct }: { label: string; pct: number | null }) {
  const r = 38; const stroke = 8; const c = 2 * Math.PI * r;
  const value = pct ?? 0;
  const color = value >= 90 ? C_GREEN : value >= 75 ? C_AMBER : C_RED;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative" style={{ width: 96, height: 96 }}>
        <svg width={96} height={96} viewBox="0 0 96 96" className="-rotate-90" style={{ position: "absolute", inset: 0 }}>
          <circle cx={48} cy={48} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-100 dark:text-slate-800" />
          {pct !== null && (
            <circle cx={48} cy={48} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c - (value / 100) * c}
              className="transition-all duration-500" />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[19px] font-black tabular-nums leading-none" style={{ color: pct !== null ? color : "#94A3B8" }}>
            {pct !== null ? `${pct}%` : "—"}
          </span>
        </div>
      </div>
      <div className="text-[12px] text-center text-slate-600 dark:text-slate-400 font-semibold leading-tight max-w-[96px] mt-0.5">{label}</div>
    </div>
  );
}

/**
 * Score Components -- the five skill-group gauges (Opening/Soft Skill/Hold/
 * Resolution/Closing), ported from Mydashboards' verified source grouping.
 */
function ScoreComponentsPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "score-components", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ScoreComponents>>(
      `/api/process-operations/${processId}/score-components?period=${period}`),
  });
  const sc = data?.data;

  return (
    <ChartCard title="Score components" subtitle="Five skill groups behind the overall call quality score">
      <div className="px-4 pb-4 pt-1">
        {isLoading || !sc ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading score components…
          </div>
        ) : !sc.available ? (
          <p className="text-xs text-slate-400 italic py-1">{sc.reason}</p>
        ) : (
          <div className="flex items-start justify-around gap-3 flex-wrap">
            {sc.components.map((c) => <RadialGauge key={c.key} label={c.label} pct={c.scorePct} />)}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * ACHT (call-length) categorization -- every audited call bucketed by
 * length_in_sec into Short/Average/Long/Extremely-long, each with its own
 * quality score and fatal rate. Ported from Mydashboards' source.
 */
function AchtCategorizationPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "acht-categorization", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<AchtCategorization>>(
      `/api/process-operations/${processId}/acht-categorization?period=${period}`),
  });
  const acht = data?.data;

  return (
    <ChartCard title="ACHT categorization" subtitle="Audit quality and fatal rate by how long the call ran">
      <div className="px-3 pb-3 pt-1">
        {isLoading || !acht ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading ACHT categorization…
          </div>
        ) : !acht.available ? (
          <p className="text-xs text-slate-400 italic py-1">{acht.reason}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {acht.rows.map((r) => {
              const scoreColor = r.scorePct === null ? "#94A3B8" : r.scorePct >= 80 ? C_GREEN : r.scorePct >= 65 ? C_AMBER : C_RED;
              const hasFatal = r.fatalCount > 0;
              return (
                <div key={r.key} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 px-3 py-2.5 flex flex-col gap-1">
                  <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">{r.label}</div>
                  <div className="flex items-baseline gap-0.5 mt-0.5">
                    <span className="text-[26px] font-black leading-none tabular-nums" style={{ color: scoreColor }}>
                      {r.scorePct !== null ? r.scorePct : "—"}
                    </span>
                    {r.scorePct !== null && <span className="text-[13px] font-bold" style={{ color: scoreColor }}>%</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">{r.auditCount}</span> audits
                  </div>
                  {hasFatal ? (
                    <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-1.5 py-1 flex items-center gap-1 mt-auto">
                      <span className="text-[11px] font-bold text-red-600">{r.fatalCount} fatal</span>
                      <span className="text-[10.5px] text-red-400 tabular-nums">({r.fatalPct}%)</span>
                    </div>
                  ) : (
                    <div className="text-[10.5px] text-slate-300 dark:text-slate-600 mt-auto">No fatals</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * Critical Signals -- Frustration/Threat/Abuse/Slang/Sarcasm, classified
 * from top_negative_words (CRITICAL_SIGNALS_CASE, ported verbatim from
 * Mydashboards' source). Five emoji tiles matching the reference UI.
 */
function CriticalSignalsPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "critical-signals", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<CriticalSignals>>(
      `/api/process-operations/${processId}/critical-signals?period=${period}`),
  });
  const cs = data?.data;

  return (
    <ChartCard title="Critical signals" subtitle="Share of examined calls carrying each negative-language category">
      <div className="px-3 pb-3 pt-1">
        {isLoading || !cs ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading critical signals…
          </div>
        ) : !cs.available ? (
          <p className="text-xs text-slate-400 italic py-1">{cs.reason}</p>
        ) : (
          <>
            <div className="flex gap-1.5">
              {cs.signals.map((s) => {
                const hot = s.pct > 0;
                return (
                  <div key={s.key} className={`flex-1 rounded-xl border px-1.5 py-2.5 flex flex-col items-center gap-1 transition-colors ${
                    hot ? "border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/20" : "border-slate-100 dark:border-slate-800 bg-slate-50/40"
                  }`}>
                    <span className="text-[22px] leading-none">{s.emoji}</span>
                    <span className={`text-[18px] font-black leading-none tabular-nums ${hot ? "text-red-600 dark:text-red-400" : "text-slate-200 dark:text-slate-700"}`}>
                      {s.pct}%
                    </span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide text-center leading-tight ${hot ? "text-red-500 dark:text-red-400" : "text-slate-400"}`}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
            {cs.totalExamined > 0 && (
              <p className="text-[9.5px] text-slate-400 mt-2 text-right tabular-nums">
                {cs.totalExamined.toLocaleString()} calls examined
              </p>
            )}
          </>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * Last 7 days vs target -- daily quality score bars, color-banded exactly
 * like the reference UI's legend: green >= target, amber within 10pp below
 * it, red further below. Ported from Mydashboards' getDailyScores.
 */
function DailyQualityTrendPanel({ processId }: { processId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "daily-quality-trend", processId],
    queryFn: () => hrmsApi.get<HrmsEnvelope<DailyQualityTrend>>(
      `/api/process-operations/${processId}/daily-quality-trend?days=7`),
  });
  const trend = data?.data;
  const chartData = useMemo(
    () => trend?.days.map((d) => ({
      date: d.date.slice(5), score: d.avgScore,
      // Recharts renders a null value as no bar at all -- indistinguishable
      // from the gap between bars. A day with zero audits is real
      // information (not a rendering gap), so it gets a small fixed-height
      // placeholder bar instead; the real (null) score still drives color
      // and the tooltip, this only controls what's visually there to hover.
      displayHeight: d.avgScore ?? 3,
      audits: d.auditCount,
    })) ?? [],
    [trend],
  );
  const barColor = (score: number | null, target: number) => {
    if (score === null) return "#E2E8F0";
    if (score >= target) return C_GREEN;
    if (score >= target - 10) return C_AMBER;
    return C_RED;
  };

  return (
    <ChartCard variant="classic" title="Last 7 days vs target" subtitle={trend ? `Daily quality score against Target ${trend.targetPct}%` : undefined}>
      <div className="px-3 pb-1">
        {isLoading || !trend ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading daily trend…
          </div>
        ) : !trend.available ? (
          <p className="text-xs text-slate-400 italic py-1">{trend.reason}</p>
        ) : (
          <>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={trend.targetPct} stroke={C_GREEN} strokeDasharray="4 3" strokeWidth={1.5} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate}
                    formatter={(_: number, __: string, item: any) =>
                      item?.payload?.score === null ? ["No audits", "Score"] : [`${item.payload.score}%`, "Score"]} />
                  <Bar dataKey="displayHeight" radius={[3, 3, 0, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={barColor(d.score, trend.targetPct)} />)}
                    <LabelList dataKey="score" position="top"
                      style={{ fontSize: 9, fill: "#475569", fontWeight: 700 }}
                      formatter={(v: number | null) => v === null ? "" : `${v}%`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 text-[9.5px] text-slate-500 pt-1">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: C_GREEN }} />&ge;{trend.targetPct}% (On target)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: C_AMBER }} />{trend.targetPct - 10}&ndash;{trend.targetPct - 1}%</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: C_RED }} />&lt;{trend.targetPct - 10}%</span>
            </div>
          </>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * The two Customer Interaction threat cards, ported from Mydashboards'
 * source social_media_court_threat/potential_scam columns.
 */
function CustomerRiskCardsPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "customer-risk-cards", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<CustomerRiskCards>>(
      `/api/process-operations/${processId}/customer-risk-cards?period=${period}`),
  });
  const rc = data?.data;

  return (
    <ChartCard title="Customer interaction risk" subtitle="Calls carrying an explicit threat or scam risk signal">
      <div className="px-3 pb-2">
        {isLoading || !rc ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading customer interaction insights…
          </div>
        ) : !rc.available ? (
          <p className="text-xs text-slate-400 italic py-1">{rc.reason}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className={`rounded-lg border px-2.5 py-2 ${rc.socialMediaCourtThreat > 0 ? "border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20" : "border-slate-100 dark:border-slate-800"}`}>
              <div className={`text-lg font-bold ${rc.socialMediaCourtThreat > 0 ? "text-red-600" : "text-slate-400"}`}>
                {rc.socialMediaCourtThreat} <span className="text-[10px] font-normal text-slate-500">calls ({rc.socialMediaCourtThreatPct}%)</span>
              </div>
              <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-500">Social media & consumer court threat</div>
              <div className="text-[9px] text-slate-400">📱 Social media · ⚖️ Consumer court · Legal / FIR</div>
            </div>
            <div className={`rounded-lg border px-2.5 py-2 ${rc.potentialScam > 0 ? "border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/20" : "border-slate-100 dark:border-slate-800"}`}>
              <div className={`text-lg font-bold ${rc.potentialScam > 0 ? "text-red-600" : "text-slate-400"}`}>
                {rc.potentialScam} <span className="text-[10px] font-normal text-slate-500">calls ({rc.potentialScamPct}%)</span>
              </div>
              <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-500">Potential scam</div>
              <div className="text-[9px] text-slate-400">Financial fraud reported</div>
            </div>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * Fatal Analysis tab -- ported from Mydashboards' getFatalAnalysis: KPI
 * strip, fatal-by-scenario breakdown, day-wise fatal trend (days with zero
 * fatals omitted, matching the source), and top 5 fatal contributors. The
 * per-agent fatal table Mydashboards' own tab also shows is NOT duplicated
 * -- Agent Audit Summary above already covers that exact shape.
 */
function FatalAnalysisPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "fatal-analysis", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<FatalAnalysis>>(
      `/api/process-operations/${processId}/fatal-analysis?period=${period}`),
  });
  const fa = data?.data;
  const maxScenario = useMemo(() => Math.max(1, ...(fa?.byScenario.map((s) => s.fatalCount) ?? [1])), [fa]);

  return (
    <ChartCard title="Fatal analysis" subtitle="Process-wide fatal rate, by scenario, by day, and its top contributors">
      <div className="px-3 pb-2">
        {isLoading || !fa ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading fatal analysis…
          </div>
        ) : !fa.available ? (
          <p className="text-xs text-slate-400 italic py-1">{fa.reason}</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { label: "Audits", value: fa.auditCount.toLocaleString() },
                { label: "CQ score", value: fa.cqScore !== null ? `${fa.cqScore}%` : "—" },
                { label: "Fatal count", value: fa.fatalCount.toLocaleString(), tone: fa.fatalCount > 0 ? "red" : undefined },
                { label: "Fatal %", value: `${fa.fatalPct}%`, tone: fa.fatalPct > 0 ? "red" : undefined },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5">
                  <div className={`text-[13px] font-bold ${c.tone === "red" ? "text-red-600" : "text-slate-700 dark:text-slate-200"}`}>{c.value}</div>
                  <div className="text-[8.5px] text-slate-500 uppercase tracking-wide">{c.label}</div>
                </div>
              ))}
            </div>

            <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">By scenario</div>
            <div className="space-y-1 mb-3">
              {fa.byScenario.map((s) => (
                <div key={s.scenario} className="flex items-center gap-2 text-[10.5px]">
                  <span className="w-16 shrink-0 text-slate-600 dark:text-slate-300">{s.scenario}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.max(s.fatalCount > 0 ? 4 : 0, (s.fatalCount / maxScenario) * 100)}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-slate-500">{s.fatalCount} ({s.fatalPct}%)</span>
                </div>
              ))}
            </div>

            {fa.dayWise.length > 0 && (
              <>
                <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">Days with fatals</div>
                <div className="max-h-28 overflow-y-auto mb-3">
                  {fa.dayWise.map((d) => (
                    <div key={d.date} className="flex items-center justify-between text-[10px] py-0.5 border-t border-slate-100 dark:border-slate-800 first:border-t-0">
                      <span className="text-slate-500">{d.date}</span>
                      <span className="text-slate-400">{d.totalCount} audits</span>
                      <span className="text-red-600 font-semibold">{d.totalFatal} fatal</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {fa.topContributors.length > 0 && (
              <>
                <div className="text-[9.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">Top fatal contributors</div>
                <table className="w-full text-[10.5px] border-collapse">
                  <tbody>
                    {fa.topContributors.map((c) => (
                      <tr key={c.employeeCode} className="border-t border-slate-100 dark:border-slate-800 first:border-t-0">
                        <td className="py-1 pr-2 font-medium text-slate-700 dark:text-slate-300">{c.employeeName}</td>
                        <td className="py-1 pr-2 text-right text-slate-500">{c.auditCount} audits</td>
                        <td className="py-1 text-right text-red-600 font-semibold">{c.fatalCount} ({c.fatalPct}%)</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * Detail Analysis tab's distinctive piece -- daily audit volume stacked by
 * scenario. Ported from Mydashboards' getDetailAnalysis. The tab's other
 * components (scenario panels, scenario totals) are already covered by
 * Scenario Distribution above -- not duplicated here.
 */
function DayWiseScenarioAuditPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "day-wise-scenario-audit", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<DayWiseScenarioAudit>>(
      `/api/process-operations/${processId}/day-wise-scenario-audit?period=${period}`),
  });
  const dw = data?.data;
  const chartData = useMemo(
    () => dw?.days.slice().reverse().map((d) => ({ date: d.date.slice(5), Complaint: d.complaint, Request: d.request, Query: d.query, "Sale Done": d.saleDone })) ?? [],
    [dw],
  );

  return (
    <ChartCard title="Day-wise audit volume by scenario" subtitle="Daily audit count, stacked by what the call was actually about">
      <div className="px-3 pb-1">
        {isLoading || !dw ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading day-wise audit volume…
          </div>
        ) : !dw.available ? (
          <p className="text-xs text-slate-400 italic py-1">{dw.reason}</p>
        ) : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="Complaint" stackId="s" fill={C_RED} radius={[0, 0, 0, 0]}>
                  <LabelList dataKey="Complaint" position="inside" style={{ fontSize: 9, fill: "#fff", fontWeight: 700 }}
                    formatter={(v: number) => v > 0 ? v : ""} />
                </Bar>
                <Bar dataKey="Query" stackId="s" fill={C_BLUE}>
                  <LabelList dataKey="Query" position="inside" style={{ fontSize: 9, fill: "#fff", fontWeight: 700 }}
                    formatter={(v: number) => v > 0 ? v : ""} />
                </Bar>
                <Bar dataKey="Request" stackId="s" fill={C_AMBER}>
                  <LabelList dataKey="Request" position="inside" style={{ fontSize: 9, fill: "#fff", fontWeight: 700 }}
                    formatter={(v: number) => v > 0 ? v : ""} />
                </Bar>
                <Bar dataKey="Sale Done" stackId="s" fill={C_GREEN} radius={[3, 3, 0, 0]}>
                  <LabelList dataKey="Sale Done" position="top" style={{ fontSize: 9, fill: "#475569", fontWeight: 700 }}
                    formatter={(v: number) => v > 0 ? v : ""} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * Repeat Analysis tab -- ported from Mydashboards' getRepeatAnalysis: a
 * caller (by MobileNo) is a repeat if the same number appears on more than
 * one audited call. Grand totals + a day-wise unique-vs-repeat area chart.
 * The source's full phone-number x date pivot (unbounded cardinality) is
 * deliberately not ported.
 */
function RepeatAnalysisPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "repeat-analysis", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<RepeatAnalysis>>(
      `/api/process-operations/${processId}/repeat-analysis?period=${period}`),
  });
  const ra = data?.data;
  const chartData = useMemo(
    () => ra?.dayWise.map((d) => ({ date: d.date.slice(5), Unique: d.uniqueCalls, Repeat: d.repeatCalls })) ?? [],
    [ra],
  );

  return (
    <ChartCard title="Repeat analysis" subtitle="Callers (by phone number) who called more than once in this period">
      <div className="px-3 pb-1">
        {isLoading || !ra ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading repeat analysis…
          </div>
        ) : !ra.available ? (
          <p className="text-xs text-slate-400 italic py-1">{ra.reason}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5">
                <div className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{ra.grandUnique.toLocaleString()}</div>
                <div className="text-[8.5px] text-slate-500 uppercase tracking-wide">Unique callers</div>
              </div>
              <div className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5">
                <div className={`text-[13px] font-bold ${ra.grandRepeat > 0 ? "text-amber-600" : "text-slate-700 dark:text-slate-200"}`}>{ra.grandRepeat.toLocaleString()}</div>
                <div className="text-[8.5px] text-slate-500 uppercase tracking-wide">Repeat calls</div>
              </div>
              <div className="rounded-lg border border-slate-100 dark:border-slate-800 px-2 py-1.5">
                <div className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{ra.grandPct}%</div>
                <div className="text-[8.5px] text-slate-500 uppercase tracking-wide">Repeat share</div>
              </div>
            </div>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Area type="monotone" dataKey="Unique" stroke={C_BLUE} fill={C_BLUE} fillOpacity={0.15} strokeWidth={1.5} />
                  <Area type="monotone" dataKey="Repeat" stroke={C_AMBER} fill={C_AMBER} fillOpacity={0.3} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * Fraud Call tab -- ported from Mydashboards' getFraudCalls: every call
 * with a real fraud_detected_sentence value (not blank, not a placeholder),
 * plus a per-agent flagged/total/risk rollup. Each row opens the same
 * CallDetailDrawer every other real-call list on this page already uses --
 * fourth real consumer.
 */
function FraudCallPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "fraud-calls", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<FraudCallSummary>>(
      `/api/process-operations/${processId}/fraud-calls?period=${period}`),
  });
  const fc = data?.data;
  const { openCall, drawer } = useCallDetailDrawer(processId);

  return (
    <ChartCard title="Fraud call detection" subtitle="Calls where the AI pass detected a real fraud-risk sentence">
      <div className="px-3 pb-1">
        {isLoading || !fc ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Checking for fraud calls…
          </div>
        ) : !fc.available ? (
          <p className="text-xs text-slate-400 italic py-1">{fc.reason}</p>
        ) : !fc.calls.length ? (
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-2.5 py-2 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">No fraud-risk calls detected in this period — {fc.total} audited.</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-red-200 dark:border-red-900 overflow-hidden mb-2">
              <div className="px-2.5 py-1.5 bg-gradient-to-r from-red-700 to-red-600 text-white text-[10px] font-bold uppercase tracking-wide">
                {fc.calls.length} of {fc.total} audited calls flagged
              </div>
              <div className="max-h-56 overflow-y-auto">
                {fc.calls.map((c, i) => (
                  <button key={i} type="button"
                    onClick={() => c.hasTranscript && openCall({ employeeCode: c.employeeCode, callDate: c.callDate })}
                    disabled={!c.hasTranscript}
                    title={c.hasTranscript ? "Open this call's full audit detail" : "No transcript recorded for this call"}
                    className="w-full flex flex-col gap-0.5 text-left px-2.5 py-1.5 text-[10.5px] border-t border-red-100 dark:border-red-900/50 first:border-t-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-50/70 dark:hover:bg-red-950/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 shrink-0 w-32">{c.callDate}</span>
                      <span className="text-slate-700 dark:text-slate-300 font-medium truncate w-28 shrink-0">{c.employeeName}</span>
                      <span className="text-slate-500 truncate flex-1">{c.scenario ?? "—"}</span>
                      {c.hasTranscript ? <ChevronRight size={11} className="text-slate-300 shrink-0" /> : <span className="w-2.5 shrink-0" />}
                    </div>
                    <p className="text-[9.5px] text-red-600 dark:text-red-400 italic truncate pl-1">"{c.sentence}"</p>
                  </button>
                ))}
              </div>
            </div>
            {fc.byAgent.length > 0 && (
              <table className="w-full text-[10.5px] border-collapse">
                <tbody>
                  {fc.byAgent.map((a) => (
                    <tr key={a.employeeCode} className="border-t border-slate-100 dark:border-slate-800 first:border-t-0">
                      <td className="py-1 pr-2 font-medium text-slate-700 dark:text-slate-300">{a.employeeName}</td>
                      <td className="py-1 pr-2 text-right text-slate-500">{a.total} audits</td>
                      <td className="py-1 text-right text-red-600 font-semibold">{a.flagged} ({a.riskPct}%)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
      {drawer}
    </ChartCard>
  );
}

const SCENARIO_DIST_COLORS = [C_BLUE, C_RED, C_AMBER, C_GREEN, C_PURPLE, "#EC4899", "#14B8A6", "#6366F1"];

/**
 * Scenario Distribution -- every audited call's own recorded scenario
 * (Complaint/Query/Request/Sale Done/...) x its scenario1 sub-type, ported
 * from Mydashboards' getScenarios (verified against source). A ranked
 * horizontal-bar list rather than a donut: this page has no pie-chart import
 * yet and a bar list already carries the same "share of whole, ranked"
 * information the Biggest Drivers section above uses -- no new chart type
 * for one panel. Each scenario expands in place to its scenario1 children,
 * the same idiom AnalystBreakdownPanel and ScenarioBreakdownRow already use.
 */
function ScenarioDistributionPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "scenario-distribution", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ScenarioDistribution>>(
      `/api/process-operations/${processId}/scenario-distribution?period=${period}`),
  });
  const dist = data?.data;
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <ChartCard title="Scenario distribution"
      subtitle="Every audited call's real recorded scenario, ranked by share -- click a row for its sub-type breakdown">
      <div className="px-3">
        {isLoading || !dist ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading scenario distribution…
          </div>
        ) : !dist.available ? (
          <p className="text-xs text-slate-400 italic py-1">{dist.reason}</p>
        ) : !dist.items.length ? (
          <p className="text-xs text-slate-400 italic py-1">No audited calls in this period.</p>
        ) : (
          <div className="space-y-1 pb-2">
            {dist.items.map((item, i) => {
              const color = SCENARIO_DIST_COLORS[i % SCENARIO_DIST_COLORS.length];
              const isOpen = expanded === item.scenario;
              return (
                <div key={item.scenario} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${color}22` }}>
                  <button type="button" onClick={() => setExpanded(isOpen ? null : item.scenario)}
                    className="w-full text-left group cursor-pointer focus:outline-none px-2.5 py-2"
                    style={{ background: isOpen ? `${color}0e` : "transparent" }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <ChevronRight size={11} className={`shrink-0 transition-transform text-slate-400 ${isOpen ? "rotate-90" : ""}`} />
                      <span className="flex-1 text-[11.5px] font-semibold text-slate-700 dark:text-slate-300 leading-tight">{item.scenario}</span>
                      <span className="shrink-0 text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-full text-white"
                        style={{ background: color }}>{item.pct}%</span>
                      <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{item.count}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden ml-[19px]">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(2, item.pct)}%`, background: color, opacity: isOpen ? 1 : 0.75 }} />
                    </div>
                  </button>
                  {isOpen && item.children.length > 0 && (
                    <div className="mx-2.5 mb-2 mt-1 rounded-lg overflow-hidden border" style={{ borderColor: `${color}30` }}>
                      {item.children.map((c, ci) => (
                        <div key={c.scenario1}
                          className={`flex items-center justify-between px-2.5 py-1.5 text-[10.5px] ${ci > 0 ? "border-t" : ""}`}
                          style={{ borderColor: `${color}20`, background: ci % 2 === 0 ? `${color}06` : "transparent" }}>
                          <span className="text-slate-600 dark:text-slate-400 truncate leading-tight">{c.scenario1}</span>
                          <span className="tabular-nums font-semibold shrink-0 ml-3" style={{ color }}>
                            {c.count} <span className="font-normal text-slate-400">· {c.pct}%</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

/**
 * Sub-scenario drill for the selected CLAP category (Phase B of the
 * Mydashboards port, 2026-09-10 plan) -- the category selector above answers
 * "how many quotes", this answers "which real scenarios make up that share",
 * a ranked inline-bar list matching the pattern already used elsewhere on
 * this page (see the "Biggest drivers" Pareto chart). A category with no
 * classified calls this period says so rather than show an empty chart.
 */
function ScenarioBreakdownRow({ processId, period, category }: {
  processId: string; period: ReportPeriod; category: "agent" | "logistic" | "product";
}) {
  const clap = (category.charAt(0).toUpperCase() + category.slice(1)) as ClapScenarioBreakdown["clap"];
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "clap-scenarios", processId, period, clap],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ClapScenarioBreakdown>>(
      `/api/process-operations/${processId}/voice-of-customer/scenarios?period=${period}&clap=${clap}`),
  });
  const sb = data?.data;
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);
  const { openCall, drawer } = useCallDetailDrawer(processId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-2">
        <Loader2 className="h-3 w-3 animate-spin" />Loading which scenarios make up this share…
      </div>
    );
  }
  if (!sb?.available || !sb.scenarios.length) {
    return (
      <p className="text-[10px] text-slate-400 italic mt-2">
        {sb?.reason ?? "No scenario breakdown available for this category."}
      </p>
    );
  }

  return (
    <div className="mt-2.5 rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-2 bg-slate-50/50 dark:bg-slate-800/30">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
        Which real scenarios make up {clap} — {sb.total} call{sb.total === 1 ? "" : "s"} — click one for the real calls
      </p>
      <div className="space-y-1">
        {sb.scenarios.slice(0, 6).map((s) => {
          const open = expandedScenario === s.scenario;
          return (
            <Fragment key={s.scenario}>
              <button type="button" onClick={() => setExpandedScenario(open ? null : s.scenario)}
                className="w-full flex items-center gap-2 cursor-pointer rounded hover:bg-white dark:hover:bg-slate-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 py-0.5">
                <ChevronRight size={10} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                <span className="text-[10px] text-slate-600 dark:text-slate-300 w-28 shrink-0 truncate text-left" title={s.scenario}>
                  {s.scenario}
                </span>
                <div className="flex-1 h-3.5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${Math.max(2, s.pct)}%`, background: CLAP_META[clap].color }} />
                </div>
                <span className="text-[9.5px] tabular-nums text-slate-500 w-14 shrink-0 text-right">
                  {s.count} ({s.pct}%)
                </span>
              </button>
              {open && (
                <ScenarioCallsList processId={processId} period={period} clap={clap} scenario={s.scenario}
                  onSelectCall={openCall} />
              )}
            </Fragment>
          );
        })}
      </div>
      {drawer}
    </div>
  );
}

/** The real calls behind one clicked scenario -- click a row to open its full audit detail. */
function ScenarioCallsList({ processId, period, clap, scenario, onSelectCall }: {
  processId: string; period: ReportPeriod; clap: ClapScenarioBreakdown["clap"]; scenario: string;
  onSelectCall: (call: { employeeCode: string; callDate: string }) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "clap-scenario-calls", processId, period, clap, scenario],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ClapScenarioCall>>(
      `/api/process-operations/${processId}/voice-of-customer/scenario-calls?period=${period}&clap=${clap}&scenario=${encodeURIComponent(scenario)}`),
  });
  const sc = data?.data;

  if (isLoading) {
    return (
      <div className="pl-4 py-1 flex items-center gap-1.5 text-[9.5px] text-slate-400">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />Loading the real calls…
      </div>
    );
  }
  if (!sc?.available || !sc.calls.length) {
    return <p className="pl-4 py-1 text-[9.5px] text-slate-400 italic">{sc?.reason ?? "No calls to show."}</p>;
  }

  return (
    <div className="pl-4 pr-1 py-1 space-y-0.5 max-h-40 overflow-y-auto">
      {sc.calls.map((c, i) => (
        <button key={i} type="button"
          onClick={() => c.hasTranscript && onSelectCall({ employeeCode: c.employeeCode, callDate: c.callDate })}
          disabled={!c.hasTranscript}
          title={c.hasTranscript ? "Open this call's full audit detail" : "No transcript recorded for this call"}
          className="w-full flex items-center gap-2 text-left rounded px-1 py-0.5 text-[9.5px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:bg-white dark:hover:bg-slate-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
          <span className="text-slate-500 shrink-0">{c.callDate}</span>
          <span className="text-slate-700 dark:text-slate-300 truncate">{c.employeeName}</span>
          <span className="ml-auto tabular-nums font-semibold shrink-0"
            style={{ color: c.qualityPercentage === null ? undefined : c.qualityPercentage >= 80 ? C_GREEN : C_RED_TEXT }}>
            {c.qualityPercentage === null ? "—" : `${c.qualityPercentage.toFixed(0)}%`}
          </span>
          {c.hasTranscript ? <ChevronRight size={10} className="text-slate-300 shrink-0" /> : <span className="w-2.5 shrink-0" />}
        </button>
      ))}
    </div>
  );
}

/**
 * The open/close state + drawer render that all three CallDetailDrawer
 * consumers (CLAP scenario drill, Fatal Calls, an analyst's own recent
 * calls) were each independently carrying -- the exact same four lines of
 * `useState` + conditional render, tripled. CallDetailDrawer itself was
 * already the one real shared component; this just stops re-deriving the
 * state that opens it. `openCall` is stable across renders (useCallback),
 * so passing it straight into a child's onSelectCall prop never causes an
 * extra re-render of that child.
 */
function useCallDetailDrawer(processId: string): {
  openCall: (call: { employeeCode: string; callDate: string }) => void;
  drawer: React.ReactNode;
} {
  const [selectedCall, setSelectedCall] = useState<{ employeeCode: string; callDate: string } | null>(null);
  const openCall = useCallback((call: { employeeCode: string; callDate: string }) => setSelectedCall(call), []);
  const drawer = selectedCall ? (
    <CallDetailDrawer processId={processId} employeeCode={selectedCall.employeeCode}
      callDate={selectedCall.callDate} onClose={() => setSelectedCall(null)} />
  ) : null;
  return { openCall, drawer };
}

/**
 * The call-detail drawer (Phase C of the Mydashboards port) -- transcript on
 * the left, this call's own scored parameters on the right, so the raw
 * evidence and the judgment sit in one view. Same right-side Sheet drawer
 * convention already used elsewhere on this page, sized to this page's
 * widest existing drawer since a two-pane view needs the room.
 */
function CallDetailDrawer({ processId, employeeCode, callDate, onClose }: {
  processId: string; employeeCode: string; callDate: string; onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "call-detail", processId, employeeCode, callDate],
    queryFn: () => hrmsApi.get<HrmsEnvelope<CallDetail>>(
      `/api/process-operations/${processId}/call-detail?employeeCode=${encodeURIComponent(employeeCode)}&callDate=${encodeURIComponent(callDate)}`),
  });
  const cd = data?.data;

  return (
    <Sheet open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[63rem] p-0 overflow-y-auto">
        <div className="px-5 py-4 bg-gradient-to-br from-slate-800 to-slate-900 text-white">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold">{cd?.employeeName ?? employeeCode}</p>
              <p className="text-[11px] text-white/60 mt-0.5">{callDate}
                {cd?.scenario && ` · ${cd.scenario}${cd.scenario1 ? ` — ${cd.scenario1}` : ""}`}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="ml-auto p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1">
              <X size={15} />
            </button>
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {cd?.qualityPercentage !== null && cd?.qualityPercentage !== undefined && (
              <p className="text-[11px]">
                Quality score: <span className="font-bold tabular-nums">{cd.qualityPercentage.toFixed(1)}%</span>
              </p>
            )}
            {cd?.mobileNumber && (
              <p className="text-[11px] flex items-center gap-1">
                <Phone size={11} className="text-white/60" />
                Customer mobile: <span className="font-bold tabular-nums">{cd.mobileNumber}</span>
              </p>
            )}
          </div>
        </div>

        {isLoading || !cd ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 px-5 py-6">
            <Loader2 className="h-4 w-4 animate-spin" />Loading this call's transcript and scored parameters…
          </div>
        ) : !cd.available ? (
          <p className="text-sm text-slate-400 italic px-5 py-6">{cd.reason}</p>
        ) : (
          <div className="flex flex-col lg:flex-row">
            {/* Left: raw evidence -- the transcript, unformatted, plus the recording if one exists. */}
            <div className="flex-1 min-w-0 px-5 py-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Transcript</p>
              {cd.recordingUrl && (
                <audio controls preload="metadata" src={cd.recordingUrl} className="w-full h-9 mb-3" />
              )}
              {cd.transcript ? (
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 p-3 max-h-[28rem] overflow-y-auto">
                  <p className="text-[12px] font-mono whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">
                    {cd.transcript}
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 italic">No transcript recorded for this call.</p>
              )}
            </div>
            {/* Right: the judgment -- every scored parameter, pass/fail/blank. */}
            <div className="w-full lg:w-64 shrink-0 px-5 py-4 bg-slate-50/50 dark:bg-slate-800/30">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-2">Scored parameters</p>
              <div className="space-y-1">
                {cd.parameters.map((p) => (
                  <div key={p.column} className="flex items-center gap-1.5 text-[10.5px] rounded px-1.5 py-1"
                    style={{ background: p.value === null ? undefined : p.value ? "#DCFCE7" : "#FEE2E2" }}>
                    <span className="shrink-0 w-3 font-bold"
                      style={{ color: p.value === null ? "#94A3B8" : p.value ? "#166534" : "#991B1B" }}>
                      {p.value === null ? "—" : p.value ? "✓" : "✗"}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">{p.label}</span>
                  </div>
                ))}
              </div>
              {cd.parameters.every((p) => p.value !== false) && (
                <p className="text-[9.5px] text-slate-400 italic mt-2">No parameters failed on this call.</p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Root Cause vs. Workforce — the question the CLAP panel above can't answer
 * alone: is a rise in agent-attributed complaints a coaching problem, or is
 * it what a green floor or an understaffed shift looks like from the
 * customer's side? No correlation coefficient is computed here on purpose —
 * with a handful of noisy weekly counts per process that would be false
 * precision, not insight. This is a plain juxtaposition on a shared date
 * axis; the reader's own eye does the judging.
 */
function WorkforceCorrelationPanel({ processId, period }: { processId: string; period: ReportPeriod }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "workforce-correlation", processId, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<WorkforceCorrelation>>(
      `/api/process-operations/${processId}/workforce-correlation?period=${period}`),
  });
  const wc = data?.data;

  if (isLoading || !wc) {
    return (
      <ChartCard title="Root Cause vs. Workforce" subtitle="Agent-attributed complaints against staffing and tenure, same dates">
        <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Lining up the two sides…
        </div>
      </ChartCard>
    );
  }
  if (!wc.available || wc.daily.length < 3) {
    return (
      <ChartCard title="Root Cause vs. Workforce" subtitle="Agent-attributed complaints against staffing and tenure, same dates">
        <p className="text-xs text-slate-400 italic px-3 py-4">
          {wc.reason ?? "Not enough history yet to line these up."}
        </p>
      </ChartCard>
    );
  }

  const rosterDays = wc.daily.length;
  const hasRoster = wc.rosterCoverageDays > 0;

  return (
    <ChartCard title="Root Cause vs. Workforce"
      subtitle="Agent-attributed complaint share against ramp-cohort tenure and staffing — same dates, side by side, not a claim of cause">
      <div className="px-3 space-y-4">
        {/* Row 1: agent-CLAP share vs. ramp-cohort tenure share -- both percentages, one axis */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Agent-attributed complaints vs. green-floor share
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%" minWidth={280}>
              <LineChart data={wc.daily} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                  tickFormatter={fmtDate} minTickGap={22} />
                <YAxis
                  domain={[
                    (dataMin: number) => Math.max(0, Math.floor(dataMin * 10) / 10 - 1),
                    (dataMax: number) => Math.min(100, Math.ceil(dataMax * 10) / 10 + 2),
                  ]}
                  unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} tickCount={6} />
                <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate}
                  formatter={(v: number, n: string) => [v === null ? "no data" : `${v.toFixed(1)}%`,
                    n === "agentClapPct" ? "Agent-attributed calls" : "≤30-day tenure share"]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                  formatter={(n: string) => n === "agentClapPct" ? "Agent-attributed calls" : "≤30-day tenure share"} />
                <Line type="monotone" dataKey="agentClapPct" stroke={CLAP_META.Agent.color} strokeWidth={2.5}
                  dot={{ r: 3, fill: CLAP_META.Agent.color }} isAnimationActive={false} connectNulls={false} />
                <Line type="monotone" dataKey="rampCohortPct" stroke={C_AMBER} strokeWidth={2}
                  strokeDasharray="4 2" dot={{ r: 2, fill: C_AMBER, strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Row 2: planned vs. present headcount -- both headcounts, one axis. Roster is real
            but sparse; say so honestly instead of drawing a mostly-empty line as zero. */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
            Staffing: rostered vs. actually present
          </p>
          {hasRoster ? (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={280}>
                  <LineChart data={wc.daily} margin={{ top: 4, right: 24, bottom: 0, left: 0 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                      tickFormatter={fmtDate} minTickGap={22} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate}
                      formatter={(v: number, n: string) => [v === null ? "no roster data" : v,
                        n === "plannedHeadcount" ? "Rostered" : "Present"]} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                      formatter={(n: string) => n === "plannedHeadcount" ? "Rostered" : "Present"} />
                    <Line type="monotone" dataKey="plannedHeadcount" stroke={C_PURPLE} strokeWidth={2}
                      dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line type="monotone" dataKey="presentHeadcount" stroke={C_BLUE} strokeWidth={2}
                      strokeDasharray="4 2" dot={false} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[9.5px] text-slate-400 mt-1">
                Roster has real published data for {wc.rosterCoverageDays} of {rosterDays} days shown — gaps are
                where nothing was published, not zero staff.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-slate-400 italic py-2">
              This process has no published roster for this period, so staffing can't be shown against actual
              presence — that side stays blank rather than a guessed number.
            </p>
          )}
        </div>

        {/* Row 3: attrition, weekly -- its own count axis, its own chart */}
        {wc.weeklyAttrition.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Exits by week</p>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={wc.weeklyAttrition} margin={{ top: 4, right: 16, bottom: 0, left: -14 }}>
                  <CartesianGrid {...GRID} vertical={false} />
                  <XAxis dataKey="weekStart" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={fmtDate} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={20} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate} formatter={(v: number) => [v, "Exits"]} />
                  <Bar dataKey="exits" fill={C_RED} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    <LabelList dataKey="exits" position="top" style={{ fontSize: 10, fill: "#dc2626", fontWeight: 700 }}
                      formatter={(v: number) => v > 0 ? v : ""} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <p className="text-[9.5px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
          These lines are shown together, not correlated — with a handful of weekly events per process, a
          computed correlation would be more confident than the data actually is. Read it by eye: do agent
          complaints move with a green floor or a staffing gap, or don't they.
        </p>
      </div>
    </ChartCard>
  );
}

/** Format any date value as DD-MMM-YY (e.g. 03-Sep-26) for chart axes and tooltips. */
function fmtDate(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${MON[parseInt(iso[2], 10) - 1]}-${iso[1].slice(2)}`;
  const d = new Date(s);
  if (!isNaN(d.getTime()))
    return `${String(d.getDate()).padStart(2,"0")}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
  return s;
}

function currency(v: number | null): string {
  if (v === null) return "no data";
  const rounded = Math.round(v);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}₹${Math.abs(rounded).toLocaleString("en-IN")}`;
}

const REVENUE_STATUS_LABEL: Record<string, string> = {
  recognized: "Recognized",
  configured_no_delivery: "Configured — no delivery feed",
  accounting_fallback: "Accounting fallback",
  missing_rule: "No rule configured",
};

/** A single stat in the Business Health grid — value, its own honest-null state, a caption. */
function HealthStat({ label, value, caption, tone, icon: Icon, fillPct, fillGood, onClick }: {
  label: string; value: string; caption?: string; tone?: "good" | "bad" | "neutral"; icon?: typeof Users;
  /** 0-100 -- when set, draws a Mydashboards-style fill bar under the value
   *  (e.g. headcount/mandate). Clamped to a 4% minimum so a real-but-tiny
   *  fill never reads as visually empty, same as the reference component. */
  fillPct?: number; fillGood?: boolean; onClick?: () => void;
}) {
  const color = tone === "good" ? C_GREEN : tone === "bad" ? C_RED_TEXT : C_SLATE;
  const noData = value === "no data";
  return (
    <div className={`relative overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-2 min-w-[128px] transition-shadow hover:shadow-sm${onClick ? " cursor-pointer hover:shadow-md" : ""}`}
      onClick={onClick}>
      {/* MetricCard idiom (Mydashboards): a solid-color top strip instead of a
          tinted border, so the accent stays crisp at this radius, plus the
          icon chip's background derived from the exact same hex the strip
          uses -- never a separately-chosen "-light" shade that can drift. */}
      {!noData && <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />}
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wide truncate">{label}</p>
        {Icon && (
          <span className="shrink-0 rounded-md p-1" style={{ background: noData ? undefined : `${color}18` }}>
            <Icon className="h-3 w-3" style={{ color: noData ? "#94A3B8" : color }} />
          </span>
        )}
      </div>
      <p className={`text-sm font-bold tabular-nums mt-0.5 ${noData ? "text-slate-400 text-xs font-normal italic" : ""}`}
        style={noData ? undefined : { color }}>
        {value}
      </p>
      {caption && <p className="text-[9px] text-slate-400 mt-0.5 leading-tight">{caption}</p>}
      {fillPct !== undefined && (
        <div className="mt-1.5 h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(4, fillPct))}%`, background: fillGood ? C_GREEN : C_RED_TEXT }} />
        </div>
      )}
    </div>
  );
}

interface Insight {
  severity: "critical" | "warning";
  /** What the reader would spot first, one line. */
  what: string;
  /** Why -- the real number(s) this insight is derived from, not a guess. */
  why: string;
  /** Impact -- what's actually affected by this, scoped to what's provably
   *  true from data already on screen (never a fabricated cost/revenue
   *  estimate this page has no way to compute). */
  impact: string;
  /** Action -- the concrete next step, derived from real state (an open
   *  requisition existing or not, a section existing to drill into). */
  action: string;
  sectionKey: string;
}

/**
 * The "read this first" strip at the top of the Process Performance Card —
 * the same idea as Mydashboards' rule-based root-cause/insight panels, but
 * every card here is derived live from this page's own already-verified
 * numbers (targetStatus() against a metric's real configured target, the
 * same headcount/shortfall this page already computed), not static canned
 * copy keyed by metric name. An insight that can't point at a real target
 * miss or a real shortfall simply isn't generated -- an empty panel is the
 * honest "nothing worth flagging" case, not a placeholder. Structured as
 * What/Why/Impact/Action (Mydashboards' narrative-card idiom) rather than a
 * flat title+detail -- every field still traces to a real value, "Impact"
 * included: it describes what's affected in this system's own terms
 * (mandate, section, target), never an invented rupee/time cost.
 */
function deriveInsights(ops: Operations, health: ProcessBusinessHealth | undefined): Insight[] {
  const insights: Insight[] = [];

  if (health?.available && health.headcount.available && (health.headcount.shortfall ?? 0) > 0) {
    const sf = health.headcount.shortfall!;
    insights.push({
      severity: "critical",
      what: `Understaffed by ${sf} against mandate`,
      why: `${health.headcount.activeHc} active headcount against a sanctioned ${health.headcount.mandatedHc}.`,
      impact: `${sf} seat${sf === 1 ? "" : "s"} short of mandate -- every operations metric below is being produced by fewer people than this process is sanctioned for.`,
      action: health.hiring.openRequisitions > 0
        ? `${health.hiring.openRequisitions} requisition${health.hiring.openRequisitions === 1 ? "" : "s"} already open — chase fulfillment, not a new raise.`
        : "No requisition raised yet for this gap — that's the actionable next step.",
      sectionKey: "operations",
    });
  }

  const sectionOrder = ["operations", "conversion", "risk", "conduct", "quality", "hygiene"];
  for (const key of sectionOrder) {
    const section = ops.sections.find((s) => s.key === key);
    if (!section) continue;
    const fails = section.metrics
      .filter((m) => targetStatus(m) === "fail")
      // Worst-first: rank by how far the value sits from its own target, in
      // the metric's own unit -- a metric with no target never reaches here
      // (targetStatus() returns null), so this division is always real.
      .sort((a, b) => Math.abs(b.value! - b.targetValue!) - Math.abs(a.value! - a.targetValue!));
    if (!fails.length) continue;
    const worst = fails[0];
    insights.push({
      severity: key === "hygiene" ? "warning" : "critical",
      what: `${worst.label} missing target`,
      why: `${formatValue(worst.value, worst.unit)} against ${targetCaption(worst) ?? "its configured target"}.`,
      impact: fails.length > 1
        ? `${fails.length - 1} more metric${fails.length - 1 === 1 ? "" : "s"} in ${section.title} also missing target — not an isolated miss.`
        : `The only metric in ${section.title} missing target this period.`,
      action: `Open ${section.title} below for the full breakdown.`,
      sectionKey: key,
    });
  }

  return insights;
}

interface ParetoBar { label: string; gapPct: number; cumulativePct: number }

/**
 * CallMaster's Pareto pattern (bar = driver size, line = cumulative %) for
 * "which target misses matter most" -- every metric that's missing target,
 * ranked by relative gap (|value - target| / target, so a percentage metric
 * and a seconds metric are comparable on the same axis) rather than raw
 * units, worst first, cumulative % running to 100 by construction since it's
 * the same fails list divided by its own total.
 */
function deriveParetoData(ops: Operations): ParetoBar[] {
  const fails = [...ops.sections.flatMap((s) => s.metrics), ...ops.ungrouped]
    .filter((m) => targetStatus(m) === "fail" && m.targetValue !== 0)
    .map((m) => ({ label: m.label, gap: Math.abs((m.value! - m.targetValue!) / m.targetValue!) * 100 }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 8); // worst 8 -- a real Pareto reads as a curve, not a wall of bars
  const total = fails.reduce((s, f) => s + f.gap, 0);
  if (!total) return [];
  let running = 0;
  return fails.map((f) => {
    running += f.gap;
    return { label: f.label, gapPct: Math.round(f.gap * 10) / 10, cumulativePct: Math.round((running / total) * 1000) / 10 };
  });
}

/**
 * One insight, collapsed to just "What" by default (keeps the panel scannable
 * when there are several), expanding on click into the Why/Impact/Action
 * quadrants Mydashboards' own AI Insight cards use -- What is the card's own
 * header rather than a fourth quadrant, since repeating it inside the
 * expanded body would just restate the title.
 */
function InsightCard({ insight: ins }: { insight: Insight }) {
  const [open, setOpen] = useState(false);
  const color = ins.severity === "critical" ? C_RED_TEXT : C_AMBER;
  return (
    <button type="button" onClick={() => setOpen((v) => !v)}
      className="text-left rounded-lg border px-2.5 py-2 cursor-pointer transition-shadow hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={{ borderColor: `${color}40`, background: `${color}0c` }}>
      <div className="flex items-start gap-1.5">
        <p className="text-[11px] font-bold flex-1" style={{ color }}>{ins.what}</p>
        <ChevronRight size={12} className={`shrink-0 mt-0.5 transition-transform ${open ? "rotate-90" : ""}`} style={{ color }} />
      </div>
      {!open && <p className="text-[10.5px] text-slate-600 dark:text-slate-300 mt-0.5 leading-snug">{ins.why}</p>}
      {open && (
        <div className="mt-1.5 grid grid-cols-1 gap-1.5">
          {([["Why", ins.why], ["Impact", ins.impact], ["Action", ins.action]] as const).map(([label, text]) => (
            <div key={label} className="rounded bg-white/70 dark:bg-slate-900/40 px-2 py-1">
              <p className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color }}>{label}</p>
              <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-snug mt-0.5">{text}</p>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

const PERF_SECTION_STYLE: Record<string, { text: string; border: string; bg: string }> = {
  operations: { text: "#1d4ed8", border: "#bfdbfe", bg: "#eff6ff" },
  conversion:  { text: "#15803d", border: "#bbf7d0", bg: "#f0fdf4" },
  risk:        { text: "#c2410c", border: "#fed7aa", bg: "#fff7ed" },
  conduct:     { text: "#b45309", border: "#fde68a", bg: "#fffbeb" },
  quality:     { text: "#7e22ce", border: "#e9d5ff", bg: "#faf5ff" },
  hygiene:     { text: "#475569", border: "#e2e8f0", bg: "#f8fafc" },
};

function ProcessCardInsightsPanel({ processId: _processId, ops, onDrill }: {
  processId: string; ops: Operations; onDrill?: (key: string) => void;
}) {
  const allWithData   = ops.sections.flatMap((s) => s.metrics).filter((m) => m.value !== null);
  const passingCount  = allWithData.filter((m) => targetStatus(m) === "pass").length;
  const failingCount  = allWithData.filter((m) => targetStatus(m) === "fail").length;

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[13px] font-bold text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />{passingCount} on target
        </span>
        {failingCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[13px] font-bold text-red-500">
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />{failingCount} missing target
          </span>
        )}
        <span className="text-[11px] text-slate-400">{allWithData.length} metrics with data</span>
      </div>

      {/* One group per section */}
      {ops.sections.filter((s) => s.metrics.some((m) => m.value !== null)).map((section) => {
        const style   = PERF_SECTION_STYLE[section.key] ?? PERF_SECTION_STYLE.hygiene;
        const sPass   = section.metrics.filter((m) => targetStatus(m) === "pass").length;
        const sFail   = section.metrics.filter((m) => targetStatus(m) === "fail").length;
        const hasTarget = section.metrics.some((m) => m.targetValue !== null);
        return (
          <div key={section.key}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: style.text }}>
                {section.title}
              </span>
              {hasTarget && (
                <span className="text-[10px] tabular-nums text-slate-400">
                  {sPass}/{sPass + sFail} on target
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {section.metrics.filter((m) => m.value !== null).map((m) => {
                const status = targetStatus(m);
                const d      = deltaOf(m);
                const tileStyle = status === "pass"
                  ? { border: "#bbf7d0", bg: "#f0fdf4", val: C_GREEN }
                  : status === "fail"
                  ? { border: "#fecaca", bg: "#fff5f5", val: C_RED_TEXT }
                  : { border: style.border, bg: style.bg, val: "#475569" };
                return (
                  <button key={m.metricKey} type="button"
                    onClick={() => onDrill?.(m.metricKey)}
                    title="Click to see trend, daily readings and employee breakdown"
                    className={`rounded-xl border px-2.5 py-2 flex flex-col gap-0.5 text-left w-full transition-shadow ${onDrill ? "cursor-pointer hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1" : ""}`}
                    style={{ borderColor: tileStyle.border, background: tileStyle.bg }}>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 truncate leading-tight flex items-center justify-between gap-1" title={m.label}>
                      <span className="truncate">{m.label}</span>
                      {onDrill && <ChevronRight size={10} className="shrink-0 text-slate-300" />}
                    </div>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-[20px] font-black leading-none tabular-nums" style={{ color: tileStyle.val }}>
                        {formatValue(m.value, m.unit)}
                      </span>
                      {d && d.delta !== 0 && (
                        <span className="text-[11px] font-bold leading-none"
                          style={{ color: d.good === true ? C_GREEN : d.good === false ? C_RED_TEXT : "#94A3B8" }}>
                          {d.good === true ? "▲" : d.good === false ? "▼" : "→"}{Math.abs(d.delta).toFixed(1)}
                        </span>
                      )}
                    </div>
                    {m.targetValue !== null && (
                      <div className="text-[9.5px] text-slate-400 leading-tight">{targetCaption(m)}</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Revenue/GRN/expenses/Op%, headcount vs. mandate, and hiring pipeline — for
 * this one process, this month. Every figure here is read from real, already
 * working engines elsewhere in this repo (process-pnl, workforce-mandate,
 * job-requisition), not a new calculation — what's new is showing them
 * together and saying plainly where each one's own real gap applies to THIS
 * process (no mandate configured, no revenue rule in effect this month, no
 * open requisitions right now). Shrinkage is left out on purpose: the
 * dedicated shrinkage table has never been populated at process grain for
 * any process in this system yet.
 */
function BusinessHealthPanel({ processId, onOpen }: { processId: string; onOpen?: (key: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "business-health", processId],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessBusinessHealth>>(
      `/api/process-operations/${processId}/business-health`),
    staleTime: 60_000,
  });
  const health = data?.data;

  if (isLoading || !health) {
    return (
      <ChartCard title="Business Health" subtitle="Revenue, headcount and hiring for this process, this month">
        <div className="flex items-center gap-2 text-xs text-slate-500 px-3 py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Pulling P&L, mandate and hiring data…
        </div>
      </ChartCard>
    );
  }

  const { finance, headcount, hiring, periodCode } = health;

  const revenueStatusLabel = finance.revenueStatus
    ? (REVENUE_STATUS_LABEL[finance.revenueStatus] ?? finance.revenueStatus)
    : undefined;
  const revenueIsFallback = finance.revenueStatus === "accounting_fallback" || finance.revenueStatus === "missing_rule";

  return (
    <ChartCard title="Business Health" subtitle={`${periodCode} — revenue, headcount and hiring`}>
      <div className="px-3 pb-3 space-y-3.5">

        {/* ── Finance ── */}
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
            <span className="w-1 h-4 rounded-full shrink-0" style={{ background: C_BLUE }} />
            Revenue &amp; Margin
          </p>
          {finance.available ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <HealthStat label="Revenue" value={currency(finance.revenue)}
                caption={revenueStatusLabel}
                tone={revenueIsFallback ? "neutral" : finance.revenue && finance.revenue > 0 ? "good" : "neutral"}
                icon={revenueIsFallback ? AlertTriangle : undefined}
                onClick={() => onOpen?.("hs_revenue")} />
              <HealthStat label="GRN (vendor cost)" value={currency(finance.grn)} tone="neutral"
                onClick={() => onOpen?.("hs_grn")} />
              <HealthStat label="Agent Salary"
                value={finance.agentSalaryIsRealThisMonth ? currency(finance.agentSalary) : "no data"}
                caption={!finance.agentSalaryIsRealThisMonth ? "Pending payroll run" : undefined}
                tone="neutral" icon={Users}
                onClick={() => onOpen?.("hs_salary")} />
              <HealthStat label="EBIT"
                value={finance.agentSalaryIsRealThisMonth ? currency(finance.ebit) : "no data"}
                caption={!finance.agentSalaryIsRealThisMonth ? "Pending payroll run" : undefined}
                tone={!finance.agentSalaryIsRealThisMonth || finance.ebit === null ? "neutral" : finance.ebit >= 0 ? "good" : "bad"}
                onClick={() => onOpen?.("hs_ebit")} />
              <HealthStat label="Operating %"
                value={finance.agentSalaryIsRealThisMonth
                  ? (finance.operatingProfitPct === null ? "no data" : `${finance.operatingProfitPct.toFixed(1)}%`)
                  : "no data"}
                caption={!finance.agentSalaryIsRealThisMonth ? "Pending payroll run" : undefined}
                tone={!finance.agentSalaryIsRealThisMonth || finance.operatingProfitPct === null ? "neutral" : finance.operatingProfitPct >= 0 ? "good" : "bad"}
                onClick={() => onOpen?.("hs_op_pct")} />
            </div>
          ) : (
            <p className="text-[11px] text-slate-400 italic py-1">{finance.reason}</p>
          )}
        </div>

        {/* ── Headcount ── */}
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
            <span className="w-1 h-4 rounded-full shrink-0" style={{ background: C_PURPLE }} />
            Headcount vs. Mandate
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <HealthStat label="Active Headcount" value={String(headcount.activeHc)} icon={Users}
              caption={headcount.available && headcount.mandatedHc ? `of ${headcount.mandatedHc} sanctioned` : undefined}
              fillPct={headcount.available && headcount.mandatedHc ? (headcount.activeHc / headcount.mandatedHc) * 100 : undefined}
              fillGood={headcount.available && headcount.mandatedHc ? headcount.activeHc >= headcount.mandatedHc : undefined}
              onClick={() => onOpen?.("hs_active_hc")} />
            {headcount.available ? (
              <>
                <HealthStat label="Mandate" value={headcount.mandatedHc !== null ? String(headcount.mandatedHc) : "no data"} icon={Target}
                  onClick={() => onOpen?.("hs_mandate")} />
                <HealthStat label="Available Now" value={String(headcount.availableCount)} icon={UserCheck}
                  caption="staffed on process" tone="neutral"
                  onClick={() => onOpen?.("hs_available")} />
                <HealthStat label="Gap vs Mandate"
                  value={headcount.gap !== null ? (headcount.gap === 0 ? "0" : headcount.gap > 0 ? `+${headcount.gap}` : String(headcount.gap)) : "no data"}
                  icon={headcount.gap !== null && headcount.gap < 0 ? AlertTriangle : ArrowUpRight}
                  caption={headcount.gap !== null ? (headcount.gap >= 0 ? "above mandate" : "below mandate") : undefined}
                  tone={headcount.gap === null ? "neutral" : headcount.gap >= 0 ? "good" : "bad"}
                  onClick={() => onOpen?.("hs_hc_gap")} />
                <HealthStat label="Buffer" value={headcount.buffer !== null ? `+${headcount.buffer}` : "no data"} icon={ArrowUpRight}
                  caption="above mandate" tone={headcount.buffer !== null && headcount.buffer > 0 ? "good" : "neutral"}
                  onClick={() => onOpen?.("hs_buffer")} />
                <HealthStat label="Shortfall" value={headcount.shortfall !== null ? String(headcount.shortfall) : "no data"} icon={AlertTriangle}
                  caption="below mandate" tone={headcount.shortfall !== null && headcount.shortfall > 0 ? "bad" : "neutral"}
                  onClick={() => onOpen?.("hs_shortfall")} />
              </>
            ) : (
              <div className="col-span-2 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-2">
                <p className="text-[11px] text-slate-400 italic">{headcount.reason ?? "No mandate data configured"}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Hiring ── */}
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">
            <span className="w-1 h-4 rounded-full shrink-0" style={{ background: C_AMBER }} />
            Hiring Pipeline
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <HealthStat label="Open Requisitions" value={String(hiring.openRequisitions)} icon={Briefcase}
              tone={hiring.openRequisitions > 0 ? "neutral" : "good"}
              onClick={() => onOpen?.("hs_req")} />
            <HealthStat label="Open Positions" value={String(hiring.openPositions)} icon={Target}
              caption="positions yet to be filled" tone={hiring.openPositions > 0 ? "bad" : "good"}
              onClick={() => onOpen?.("hs_positions")} />
            <HealthStat label="Hired (all time)" value={String(hiring.hiredCount)} icon={UserPlus}
              caption="filled via requisition" tone="good"
              onClick={() => onOpen?.("hs_hired")} />
            <HealthStat label="Pending Hiring" value={String(hiring.pendingHiringCount)} icon={Hourglass}
              caption="requested minus fulfilled" tone={hiring.pendingHiringCount > 0 ? "bad" : "good"}
              onClick={() => onOpen?.("hs_pending")} />
            <HealthStat label="Candidates in Pipeline" value={String(hiring.candidatesInPipeline)} icon={Users2}
              caption="matched by process" tone="neutral"
              onClick={() => onOpen?.("hs_pipeline")} />
          </div>
        </div>

      </div>
    </ChartCard>
  );
}

/** The funnel over time. Coverage is dashed: it qualifies the rest, not competes. */
function FunnelChart({ metrics }: { metrics: Reading[] }) {
  const lines: Array<[string, string, string, boolean]> = [
    ["FUNNEL_SCORED_PCT", "Scored", C_SLATE, true],
    ["FUNNEL_OPENING_PCT", "Opening", C_BLUE, false],
    ["FUNNEL_OFFER_PCT", "Offer", C_PURPLE, false],
    ["FUNNEL_SALE_PCT", "Sale", C_GREEN, false],
  ];
  const present = lines.filter(([k]) => metrics.some((m) => m.metricKey === k));
  if (present.length < 2) return null;
  const byDate = new Map<string, Record<string, number | string>>();
  present.forEach(([k]) => {
    const m = metrics.find((x) => x.metricKey === k);
    m?.trend.forEach((p) => {
      if (p.value === null) return;
      const row = byDate.get(p.date) ?? { date: p.date };
      row[k] = p.value;
      byDate.set(p.date, row);
    });
  });
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (data.length < 3) return null;
  return (
    <ChartCard title="Conversion funnel over time"
      subtitle="Dashed line is scoring coverage — the share of calls the rest are measured over">
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: -14 }}>
            <CartesianGrid {...GRID} vertical={false} />
            <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false}
              tickFormatter={fmtDate} minTickGap={22} />
            <YAxis domain={[0, 100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate}
              formatter={(v: number, n: string) => [`${v.toFixed(1)}%`, present.find((l) => l[0] === n)?.[1] ?? n]} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(n: string) => present.find((l) => l[0] === n)?.[1] ?? n} />
            {present.map(([key, , colour, dashed]) => (
              <Line key={key} type="monotone" dataKey={key} stroke={colour} strokeWidth={dashed ? 1.5 : 2}
                strokeDasharray={dashed ? "4 2" : undefined}
                dot={{ r: 2.5, fill: colour, strokeWidth: 0 }}
                isAnimationActive={false} connectNulls={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

const FUNNEL_STAGE_COLORS = [C_SLATE, C_BLUE, C_PURPLE, C_GREEN];

/**
 * The same four funnel metrics FunnelChart already plots over time, but as a
 * snapshot funnel of the latest reading only (Mydashboards' hand-rolled
 * FunnelBar/JourneyFunnel idiom) -- each stage's own width IS its %, so the
 * shape of the funnel narrowing is visible at a glance, with the stage-to-
 * stage drop-off called out underneath. No new data: every value here is
 * the same Reading.value FunnelChart already receives.
 */
function FunnelSnapshot({ metrics }: { metrics: Reading[] }) {
  const stages: Array<[string, string]> = [
    ["FUNNEL_SCORED_PCT", "Scored"], ["FUNNEL_OPENING_PCT", "Opening"],
    ["FUNNEL_OFFER_PCT", "Offer"], ["FUNNEL_SALE_PCT", "Sale"],
  ];
  const present = stages
    .map(([key, label]) => ({ key, label, value: metrics.find((m) => m.metricKey === key)?.value ?? null }))
    .filter((s): s is { key: string; label: string; value: number } => s.value !== null);
  if (present.length < 2) return null;

  return (
    <ChartCard title="Conversion funnel — latest reading"
      subtitle="Each bar's width is its own % of all scored calls; drop-off is stage-to-stage">
      <div className="px-3 space-y-2 py-1">
        {present.map((s, i) => {
          const prevValue = i > 0 ? present[i - 1].value : null;
          const dropoffPct = prevValue !== null && prevValue > 0 ? ((prevValue - s.value) / prevValue) * 100 : null;
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="font-semibold text-slate-600 dark:text-slate-300">{s.label}</span>
                <span className="tabular-nums font-bold text-slate-700 dark:text-slate-200">{s.value.toFixed(1)}%</span>
              </div>
              <div className="h-5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(4, s.value))}%`, background: FUNNEL_STAGE_COLORS[i] }} />
              </div>
              {dropoffPct !== null && dropoffPct > 0.05 && (
                <p className="text-[9px] mt-0.5" style={{ color: C_RED_TEXT }}>
                  ↓ {dropoffPct.toFixed(1)}% drop from {present[i - 1].label}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

/** Seven scored attributes on a fixed axis set — the case radar is actually for. */
function QualityRadar({ metrics }: { metrics: Reading[] }) {
  const data = metrics
    .filter((m) => m.value !== null && (m.unit ?? "").toLowerCase().startsWith("percent"))
    .map((m) => {
      // Full label kept for the tooltip; the axis tick gets a short form --
      // long originals ("Offer Accepted % (of calls offered)", "Opening
      // Success % (AI)") were overflowing past the card edge at outerRadius
      // 70%, clipping the first/last few characters of the labels on both
      // sides. Strip the unit suffix, any parenthetical qualifier, and the
      // redundant "Call " prefix, then hard-cap what's left.
      const full = m.label.replace(/ %$/, "").replace(/^Call /, "");
      const short = full.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const axis = short.length > 16 ? `${short.slice(0, 15)}…` : short;
      return { axis, full, value: Number(m.value) };
    });
  if (data.length < 3) return null;
  return (
    <ChartCard title="Quality shape" subtitle="Evenly strong, or lopsided? Each axis is a scored parameter">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="68%" margin={{ top: 22, right: 36, bottom: 22, left: 36 }}>
            <PolarGrid stroke="#E2E8F0" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 12, fill: "#475569", fontWeight: 600 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#94A3B8" }} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ""}
              formatter={(v: number) => [`${v.toFixed(1)}%`, ""]}
            />
            <Radar dataKey="value" stroke={C_GREEN} fill={C_GREEN} fillOpacity={0.25} strokeWidth={2}>
              <LabelList dataKey="value" position="outside"
                style={{ fontSize: 11, fill: "#047857", fontWeight: 700 }}
                formatter={(v: number) => v !== null ? `${v.toFixed(0)}%` : ""} />
            </Radar>
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** Customer risk flags side by side — a bar is the right read for "which is worst". */
function RiskBars({ metrics }: { metrics: Reading[] }) {
  const data = metrics
    .filter((m) => m.value !== null && m.metricKey.startsWith("RISK_"))
    .map((m) => ({ name: m.label.replace(/ %$/, ""), value: Number(m.value) }))
    .sort((a, b) => b.value - a.value);
  if (data.length < 2) return null;
  return (
    <ChartCard title="Customer risk flags" subtitle="Share of examined calls carrying each flag">
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 8 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={124}
              tick={{ ...AXIS_TICK, fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v.toFixed(2)}%`, ""]} />
            <Bar dataKey="value" fill={C_RED} radius={[0, 3, 3, 0]} barSize={13}>
              <LabelList dataKey="value" position="right"
                style={{ fontSize: 10, fill: "#dc2626", fontWeight: 700 }}
                formatter={(v: number) => `${v.toFixed(1)}%`} />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/**
 * The drawer's own trend chart — line or bar, the reader's choice, with the
 * metric's real configured target drawn as a reference line when one exists.
 * Only points that actually have a value are plotted; a gap in the middle of
 * the range stays a gap rather than being interpolated across, the same
 * honesty rule the top-level sparkline already follows.
 */
function DrilldownTrendChart({ readings, unit, targetValue, direction }: {
  readings: Drilldown["readings"]; unit: string | null; targetValue: number | null; direction: string | null;
}) {
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const data = useMemo(
    () => [...readings].filter((r) => r.value !== null).reverse()
      .map((r) => ({ date: r.date, value: r.value as number })),
    [readings],
  );
  if (data.length < 2) return null;

  const barColor = (v: number) => {
    if (targetValue === null || !direction) return C_BLUE;
    const pass = direction === "higher_is_better" ? v >= targetValue : v <= targetValue;
    return pass ? C_GREEN : C_RED;
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Trend</div>
        <div role="tablist" aria-label="Chart type" className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 p-0.5 shrink-0">
          {(["line", "bar"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={chartType === t} onClick={() => setChartType(t)}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold capitalize cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                chartType === t ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="h-40 rounded-lg border border-slate-200 dark:border-slate-800 p-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "line" ? (
            <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false}
                tickFormatter={fmtDate} minTickGap={18} />
              <YAxis tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false} width={38} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate} formatter={(v: number) => [formatValue(v, unit), "Value"]} />
              {targetValue !== null && (
                <ReferenceLine y={targetValue} stroke={C_AMBER} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: "Target", position: "insideTopRight", fontSize: 9, fill: C_AMBER }} />
              )}
              <Line type="monotone" dataKey="value" stroke={C_BLUE} strokeWidth={2}
                dot={{ r: 2.5, fill: C_BLUE }} isAnimationActive={false}>
                <LabelList dataKey="value" position="top"
                  style={{ fontSize: 9, fill: "#2563eb", fontWeight: 700 }}
                  formatter={(v: number | null) => v === null ? "" : formatValue(v, unit)} />
              </Line>
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -14 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="date" tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false}
                tickFormatter={fmtDate} minTickGap={18} />
              <YAxis tick={{ ...AXIS_TICK, fontSize: 9 }} tickLine={false} axisLine={false} width={38} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={fmtDate} formatter={(v: number) => [formatValue(v, unit), "Value"]} />
              {targetValue !== null && (
                <ReferenceLine y={targetValue} stroke={C_AMBER} strokeDasharray="4 2" strokeWidth={1.5}
                  label={{ value: "Target", position: "insideTopRight", fontSize: 9, fill: C_AMBER }} />
              )}
              <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {data.map((pt) => <Cell key={pt.date} fill={barColor(pt.value)} />)}
                <LabelList dataKey="value" position="top"
                  style={{ fontSize: 9, fill: "#475569", fontWeight: 700 }}
                  formatter={(v: number | null) => v === null ? "" : formatValue(v, unit)} />
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {targetValue !== null && chartType === "bar" && (
        <p className="text-[10px] text-slate-400 mt-1">Green meets target, red misses it — the same rule the tile above colours by.</p>
      )}
    </section>
  );
}

/** A raw column value, formatted for reading rather than left as whatever mysql2 handed back. */
function formatCellValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

/** One field, RFC-4180 quoted only when it actually needs to be. */
function csvField(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Client-side only — the rows are already on the page (this endpoint's own
 * response), so exporting them is a local file write, not a second request.
 * A BOM is prepended so Excel opens the file as UTF-8 instead of guessing.
 */
function downloadCsv(filename: string, columns: string[], rows: Array<Record<string, unknown>>) {
  const lines = [
    columns.map(csvField).join(","),
    ...rows.map((row) => columns.map((c) => csvField(row[c])).join(",")),
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * The last drill-down level: the individual rows behind ONE day's number,
 * expanded inline under that day's row. Not a new query — the same source and
 * filters that computed the aggregate, just unaggregated, so a viewer sees
 * exactly what was summed rather than a plausible-looking lookalike.
 */
function RawRowsPanel({ processId, metricKey, date, columnCount }: {
  processId: string; metricKey: string; date: string; columnCount: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "raw-rows", processId, metricKey, date],
    queryFn: () => hrmsApi.get<HrmsEnvelope<RawRows>>(
      `/api/process-operations/${processId}/metric/${metricKey}/raw?date=${date}`),
  });
  const r = data?.data;
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const sortedRows = useMemo(() => {
    if (!r || !sort) return r?.rows ?? [];
    const { col, dir } = sort;
    return [...r.rows].sort((a, b) => {
      const av = a[col]; const bv = b[col];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      // Numeric columns compare as numbers even though the value arrives as
      // an unknown (raw DB rows carry strings/numbers/dates all mixed) --
      // fall back to locale string compare for anything that isn't a clean
      // number on both sides, same "don't guess" rule as formatCellValue.
      const an = Number(av); const bn = Number(bv);
      const cmp = (!Number.isNaN(an) && !Number.isNaN(bn))
        ? an - bn
        : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [r, sort]);
  const toggleSort = (col: string) => setSort((s) =>
    s?.col === col ? (s.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" });
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30">
      <td colSpan={columnCount} className="px-2 py-2">
        {isLoading || !r ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 py-1">
            <Loader2 className="h-3 w-3 animate-spin" />Loading the individual records…
          </div>
        ) : !r.available ? (
          <p className="text-[11px] text-slate-400 italic py-1">{r.reason ?? "No underlying records to show."}</p>
        ) : r.rows.length === 0 ? (
          <p className="text-[11px] text-slate-400 italic py-1">
            The source was read for this day and returned zero rows — not that a number was zero.
          </p>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-[10px] text-slate-500">
                {r.sourceObject} · {r.totalRows?.toLocaleString()} row{r.totalRows === 1 ? "" : "s"}
                {r.truncated ? ` · showing first ${r.rows.length.toLocaleString()}` : ""}
              </p>
              <button type="button"
                onClick={() => downloadCsv(`${metricKey}_${date}.csv`, r.columns, sortedRows)}
                title="Download the rows shown here as a .csv file"
                className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded">
                <Download size={11} />CSV
              </button>
            </div>
            <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800 max-h-56 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="bg-white dark:bg-slate-900 text-slate-400 sticky top-0">
                  <tr>{r.columns.map((c) => (
                    <th key={c} className="text-left px-2 py-1 font-semibold font-mono">
                      <button type="button" onClick={() => toggleSort(c)}
                        className="inline-flex items-center gap-0.5 cursor-pointer hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded">
                        {c}
                        {sort?.col === c && <span className="text-[8px]">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}</tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                      {r.columns.map((c) => (
                        <td key={c} className="px-2 py-1 tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatCellValue(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

/**
 * The deepest level of the drill-down: not a row of raw data, a row per
 * PERSON — name, employee code, their own score on this exact metric, real
 * designation, and the real reporting chain (Team Leader / Assistant Manager
 * picked out of it when one genuinely exists, honestly absent when it
 * doesn't — see the backend's TL_PATTERN/AM_PATTERN comment). Only meaningful
 * for a metric attributed to individual employees; a whole-process metric
 * says so rather than render an empty table.
 */
interface EmployeeImportOutcome {
  row: number; employeeCode: string; scoreDate: string; value: number | null;
  ok: boolean; message?: string;
}

/**
 * The deepest-level manual path: hand-enter a score per analyst for a metric
 * that genuinely has no automated per-employee feed. Only ever shown when the
 * backend has already confirmed this metric IS 'employee'-kind but has zero
 * automated rows this period — never offered for a whole-process metric
 * (nothing to attribute to) or one that already has real per-employee data
 * (an upload here would just never be read; see getMetricAnalystBreakdown's
 * fallback ordering).
 */
function EmployeeUploadBox({ processId, metricKey, period, onSaved }: {
  processId: string; metricKey: string; period: ReportPeriod; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<EmployeeImportOutcome[] | null>(null);
  const [previewDryRun, setPreviewDryRun] = useState(true);

  const parseRows = (text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const body = lines.length && /^employee[_ ]?code\s*,/i.test(lines[0]) ? lines.slice(1) : lines;
    return body.map((line) => {
      const [employeeCode, scoreDate, value, ...noteParts] = line.split(",").map((c) => c.trim());
      return { employeeCode, scoreDate, value, note: noteParts.join(",") || undefined };
    });
  };
  const run = (dryRun: boolean) =>
    hrmsApi.post<HrmsEnvelope<{ imported: number; errors: Array<{ row: number; message: string }>; outcomes: EmployeeImportOutcome[] }>>(
      `/api/process-data-source/${processId}/metric/${metricKey}/employee-import`,
      { rows: parseRows(pasted), dry_run: dryRun },
    );
  const check = useMutation({
    mutationFn: () => run(true),
    onSuccess: (res) => { setPreview(res.data.outcomes); setPreviewDryRun(true); },
    onError: (err: unknown) => toast({
      title: "Could not check rows", variant: "destructive",
      description: err instanceof Error ? err.message : "Request failed",
    }),
  });
  const doImport = useMutation({
    mutationFn: () => run(false),
    onSuccess: (res) => {
      setPreview(res.data.outcomes); setPreviewDryRun(false);
      const failed = res.data.errors.length;
      toast({
        title: `${res.data.imported} row${res.data.imported === 1 ? "" : "s"} saved`,
        description: failed ? `${failed} row${failed === 1 ? "" : "s"} rejected — see the list below.` : undefined,
        variant: failed ? "destructive" : undefined,
      });
      onSaved();
    },
    onError: (err: unknown) => toast({
      title: "Import failed", variant: "destructive",
      description: err instanceof Error ? err.message : "Request failed",
    }),
  });
  const readyCount = preview?.filter((o) => o.ok).length ?? 0;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded">
        <Upload size={11} />Add per-analyst values by hand
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/60 dark:bg-slate-800/30">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Paste rows: <code className="font-mono text-[10px] bg-white dark:bg-slate-900 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700">employee_code,date,value,note</code>
        </p>
        <button type="button" onClick={() => { setOpen(false); setPasted(""); setPreview(null); }}
          aria-label="Close" className="text-slate-400 hover:text-slate-600 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded"><X size={13} /></button>
      </div>
      <textarea value={pasted} onChange={(e) => { setPasted(e.target.value); setPreview(null); }}
        rows={4} placeholder={"MAS12345,2026-09-09,78.5\nMAS12346,2026-09-09,64.0,typed from the weekly QA sheet"}
        className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-[11px] font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
      <p className="text-[10px] text-slate-400 mt-1">
        Each row is one analyst's score for one day — never a whole-process average split across people.
        This is only used when no automated reading exists; a real feed starting later takes over automatically.
      </p>
      <div className="flex items-center gap-2 mt-2">
        <button type="button" disabled={!pasted.trim() || check.isPending}
          onClick={() => check.mutate()}
          className="rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold px-3 py-1.5 hover:bg-slate-300 dark:hover:bg-slate-600 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
          {check.isPending ? "Checking…" : "Check rows"}
        </button>
        <button type="button" disabled={!preview || !previewDryRun || readyCount === 0 || doImport.isPending}
          onClick={() => doImport.mutate()}
          className="rounded-lg bg-blue-600 text-white text-[11px] font-semibold px-3 py-1.5 hover:bg-blue-700 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
          {doImport.isPending ? "Saving…" : `Save ${readyCount || ""} row${readyCount === 1 ? "" : "s"}`}
        </button>
      </div>
      {preview && (
        <div className="mt-2 rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table className="w-full text-[10px]">
            <thead className="bg-white dark:bg-slate-900 text-slate-400">
              <tr>
                <th className="text-left px-2 py-1 font-semibold">Employee code</th>
                <th className="text-left px-2 py-1 font-semibold">Date</th>
                <th className="text-right px-2 py-1 font-semibold">Value</th>
                <th className="text-left px-2 py-1 font-semibold">{previewDryRun ? "Ready?" : "Saved?"}</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((o) => (
                <tr key={o.row} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1 font-mono">{o.employeeCode || "—"}</td>
                  <td className="px-2 py-1">{o.scoreDate || "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{o.value === null ? "no data" : o.value}</td>
                  <td className="px-2 py-1" style={{ color: o.ok ? C_GREEN : C_RED }}>
                    {o.ok ? (previewDryRun ? "ready" : "saved") : (o.message ?? "rejected")}
                  </td>
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
 * Top/Bottom performer split (Mydashboards' side-by-side Top-10/Bottom-5
 * leaderboard idiom) -- the analyst table below is already sorted worst-
 * first, direction-aware, with nulls (no reading this period) sorted last;
 * this is the exact same list, just the two ends pulled forward as a quick
 * summary instead of making the reader scroll a long table to find them.
 * Only renders once there are enough scored analysts (6+) for "top" and
 * "bottom" to mean something different from "the whole list".
 */
function TopBottomPerformers({ analysts, unit, direction }: {
  analysts: AnalystScore[]; unit: string | null; direction: string | null;
}) {
  const scored = analysts.filter((a) => a.value !== null);
  if (scored.length < 6) return null;

  const bottom = scored.slice(0, 5); // already worst-first
  const top = [...scored].slice(-5).reverse(); // best-first

  const Card = ({ title, rows, good }: { title: string; rows: AnalystScore[]; good: boolean }) => (
    <div className={`rounded-lg border px-2.5 py-2 ${good
      ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/20"
      : "border-red-200 dark:border-red-900 bg-red-50/70 dark:bg-red-950/20"}`}>
      <p className={`text-[9px] font-bold uppercase tracking-wide mb-1.5 ${good ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
        {title}
      </p>
      <div className="space-y-1">
        {rows.map((a) => (
          <div key={a.employeeId} className="flex items-center justify-between gap-2 text-[10.5px]">
            <span className="text-slate-700 dark:text-slate-300 truncate">{a.name}</span>
            <span className={`font-bold tabular-nums shrink-0 ${good ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
              {formatValue(a.value, unit)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-2 mb-2">
      <Card title={direction === "lower_is_better" ? "Best (lowest)" : "Top performers"} rows={top} good={true} />
      <Card title="Needs coaching" rows={bottom} good={false} />
    </div>
  );
}

function AnalystBreakdownPanel({ processId, metricKey, period }: {
  processId: string; metricKey: string; period: ReportPeriod;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "by-analyst", processId, metricKey, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<AnalystBreakdown>>(
      `/api/process-operations/${processId}/metric/${metricKey}/by-analyst?period=${period}`),
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { openCall, drawer } = useCallDetailDrawer(processId);
  const ab = data?.data;
  const invalidateBreakdown = () => qc.invalidateQueries({
    queryKey: ["process-operations", "by-analyst", processId, metricKey, period],
  });

  const passes = (v: number | null, target: number | null, direction: string | null) => {
    if (v === null || target === null || !direction) return null;
    return direction === "higher_is_better" ? v >= target : v <= target;
  };

  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 inline-flex items-center gap-1">
        <Users size={11} />Employee breakdown — each individual's value for this metric
      </div>
      {isLoading || !ab ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading each analyst's own score…
        </div>
      ) : !ab.available ? (
        <p className="text-xs text-slate-400 italic py-1">{ab.reason ?? "Not available for this metric."}</p>
      ) : ab.analysts.length === 0 ? (
        <div>
          <p className="text-xs text-slate-400 italic py-1">
            No analyst has a reading for this metric in this period — not that everyone scored zero.
          </p>
          <EmployeeUploadBox processId={processId} metricKey={metricKey} period={period} onSaved={invalidateBreakdown} />
        </div>
      ) : (
        <div>
          <TopBottomPerformers analysts={ab.analysts} unit={ab.unit} direction={ab.direction} />
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-96 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold">Analyst</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Employee code</th>
                  <th className="text-right px-2 py-1.5 font-semibold">Score</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Team Leader</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Assistant Manager</th>
                </tr>
              </thead>
              <tbody>
                {ab.analysts.map((a) => {
                  const pass = passes(a.value, ab.targetValue, ab.direction);
                  const open = expandedId === a.employeeId;
                  return (
                    <Fragment key={a.employeeId}>
                      <tr onClick={() => setExpandedId(open ? null : a.employeeId)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedId(open ? null : a.employeeId); } }}
                        role="button" tabIndex={0} aria-expanded={open}
                        title="Show this analyst's full reporting chain"
                        className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${open ? "bg-slate-50 dark:bg-slate-800/40" : ""}`}>
                        <td className="px-2 py-1.5 text-slate-700 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1">
                            <ChevronRight size={11} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                            <span className="font-medium">{a.name}</span>
                            {a.manual && (
                              <PenLine size={10} className="text-purple-500 shrink-0"
                                aria-label="Typed in by hand — no automated feed for this metric" />
                            )}
                          </span>
                          {a.designation && <span className="block text-[10px] text-slate-400 pl-4">{a.designation}</span>}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-slate-500">{a.employeeCode || "—"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                          <span style={{ color: a.value === null ? undefined : pass === null ? undefined : pass ? C_GREEN : C_RED }}>
                            {a.value === null ? <span className="text-slate-400 italic font-normal">no data</span> : formatValue(a.value, ab.unit)}
                          </span>
                          {/* Tier badge (Mydashboards' TQ/MQ/BQ idiom): only two real
                              tiers here since this is one score against one target, not
                              a percentile band across analysts -- a fabricated "near
                              target" middle tier would need a threshold this system
                              doesn't define anywhere else. */}
                          {pass !== null && (
                            <span className="ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[8.5px] font-bold align-middle"
                              style={{ background: pass ? "#DCFCE7" : "#FEE2E2", color: pass ? "#166534" : "#991B1B" }}>
                              {pass ? "On target" : "Below"}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">
                          {a.teamLeader ? `${a.teamLeader.name} (${a.teamLeader.employeeCode})` : <span className="text-slate-400 italic">none on record</span>}
                        </td>
                        <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300">
                          {a.assistantManager ? `${a.assistantManager.name} (${a.assistantManager.employeeCode})` : <span className="text-slate-400 italic">none on record</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30">
                          <td colSpan={5} className="px-2 py-2 space-y-2">
                            {a.reportsTo.length ? (
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="text-slate-400 shrink-0">Full reporting chain:</span>
                                {a.reportsTo.map((m, i) => (
                                  <span key={`${m.employeeCode}-${i}`} className="inline-flex items-center gap-1">
                                    {i > 0 && <span className="text-slate-300">→</span>}
                                    <span className="rounded-full px-2 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                                      {m.name} ({m.employeeCode}){m.designation ? ` · ${m.designation}` : ""}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-400 italic">
                                No one is recorded as this analyst's manager — the reporting chain stops here.
                              </p>
                            )}
                            {a.employeeCode && (
                              <EmployeeRecentCallsRow processId={processId} employeeCode={a.employeeCode} period={period}
                                onSelectCall={openCall} />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            Sorted worst first. Team Leader / Assistant Manager are pulled from each analyst's real
            reporting chain — "none on record" means that layer genuinely doesn't exist for them, not a loading gap.
            {ab.analysts.some((a) => a.manual) && (
              <> The <PenLine size={9} className="inline text-purple-500 mx-0.5" />
                mark means that score was typed in by hand — this metric has no automated per-employee feed yet.</>
            )}
          </p>
        </div>
      )}
      {drawer}
    </section>
  );
}

/**
 * Third real consumer of CallDetailDrawer -- this analyst's own recent
 * audited calls, regardless of which metric the breakdown table above is
 * showing (AnalystBreakdownPanel is generic over any metric). An employee
 * genuinely outside the quality-audit pass (this metric came from a manual
 * upload or a different source) gets an honest reason, not an empty list
 * indistinguishable from "audited, zero calls".
 */
function EmployeeRecentCallsRow({ processId, employeeCode, period, onSelectCall, bandFilter }: {
  processId: string; employeeCode: string; period: ReportPeriod;
  onSelectCall: (call: { employeeCode: string; callDate: string }) => void;
  /** Narrows to one TQ/MQ/BQ band, same thresholds the Agent Audit Summary
   *  table stack-ranks by (>=80 / 60-79.99 / 0-59.99). Undefined = unfiltered. */
  bandFilter?: "TQ" | "MQ" | "BQ";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "employee-calls", processId, employeeCode, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<EmployeeRecentCalls>>(
      `/api/process-operations/${processId}/employee-calls?employeeCode=${encodeURIComponent(employeeCode)}&period=${period}`),
  });
  const ec = data?.data;
  const bandOf = (pct: number | null): "TQ" | "MQ" | "BQ" | null =>
    pct === null ? null : pct >= 80 ? "TQ" : pct >= 60 ? "MQ" : pct > 0 ? "BQ" : null;
  const filteredCalls = useMemo(
    () => (bandFilter ? (ec?.calls ?? []).filter((c) => bandOf(c.qualityPercentage) === bandFilter) : ec?.calls ?? []),
    [ec, bandFilter],
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-[9.5px] text-slate-400">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />Checking this analyst's own audited calls…
      </div>
    );
  }
  if (!ec?.available) {
    return <p className="text-[9.5px] text-slate-400 italic">{ec?.reason ?? "No audited calls to show."}</p>;
  }
  if (!filteredCalls.length) {
    return (
      <p className="text-[9.5px] text-slate-400 italic">
        {bandFilter ? `None of this analyst's most recent audited calls fall in the ${bandFilter} band.` : "No audited calls to show."}
      </p>
    );
  }

  return (
    <div>
      <span className="text-[9.5px] text-slate-400 block mb-1">
        {bandFilter
          ? `This analyst's most recent ${bandFilter} calls (click one for its transcript, recording and customer mobile number):`
          : "This analyst's own recent audited calls:"}
      </span>
      <div className="flex flex-wrap gap-1">
        {filteredCalls.slice(0, 10).map((c, i) => (
          <button key={i} type="button"
            onClick={() => c.hasTranscript && onSelectCall({ employeeCode, callDate: c.callDate })}
            disabled={!c.hasTranscript}
            title={c.hasTranscript ? "Open this call's full audit detail" : "No transcript recorded for this call"}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 hover:border-slate-300 dark:hover:border-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
            <span className="text-slate-500">{c.callDate.slice(5, 16)}</span>
            <span className="font-semibold tabular-nums"
              style={{ color: c.qualityPercentage === null ? undefined : c.qualityPercentage >= 80 ? C_GREEN : C_RED_TEXT }}>
              {c.qualityPercentage === null ? "—" : `${c.qualityPercentage.toFixed(0)}%`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Honest, derived-only read of what the numbers say: never a canned verdict,
 * every line traces to a real value already on screen (the latest reading vs.
 * the one before it, the configured target, and — when this metric has one —
 * the per-analyst breakdown). A category with nothing to report says so
 * rather than show a filler line.
 */
function InsightsPanel({ d, processId, metricKey, period }: {
  d: Drilldown; processId: string; metricKey: string; period: ReportPeriod;
}) {
  // Same query key as AnalystBreakdownPanel -- react-query dedupes this into
  // the one request already in flight/cached for that panel, not a second
  // network round-trip, so the worst-performer/target-gap lines below stay
  // exactly consistent with the analyst table sitting right underneath them.
  const { data: abData } = useQuery({
    queryKey: ["process-operations", "by-analyst", processId, metricKey, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<AnalystBreakdown>>(
      `/api/process-operations/${processId}/metric/${metricKey}/by-analyst?period=${period}`),
  });
  const ab = abData?.data;
  const target = d.definition?.targetValue ?? null;
  const direction = d.direction;
  const passes = (v: number | null) => {
    if (v === null || target === null || !direction) return null;
    return direction === "higher_is_better" ? v >= target : v <= target;
  };
  const latest = d.readings[0] ?? null;
  const prev = d.readings.find((r) => r.value !== null && r.date !== latest?.date) ?? null;
  const latestPass = latest ? passes(latest.value) : null;
  const delta = latest?.value != null && prev?.value != null ? latest.value - prev.value : null;
  const improving = delta !== null ? (direction === "higher_is_better" ? delta > 0 : delta < 0) : null;

  const scored = (ab?.available ? ab.analysts : []).filter((a) => a.value !== null);
  const worst = scored[0] ?? null; // backend already sorts worst-first
  const best = scored.length ? scored[scored.length - 1] : null;
  const worstPass = worst ? passes(worst.value) : null;
  const bestPass = best ? passes(best.value) : null;
  const failingCount = target !== null && direction
    ? scored.filter((a) => !passes(a.value)).length : null;
  const passingCount = failingCount !== null ? scored.length - failingCount : null;

  const good: string[] = [];
  const alert: string[] = [];
  const actions: string[] = [];

  if (latest && latestPass === true) good.push(`Latest reading (${latest.date}) meets target at ${formatValue(latest.value, d.unit)}.`);
  if (latest && latestPass === false) alert.push(`Latest reading (${latest.date}) is missing target: ${formatValue(latest.value, d.unit)} vs ${formatValue(target, d.unit)}.`);
  if (improving === true) good.push(`Moving the right way vs. the previous reading (${prev?.date}).`);
  if (improving === false) alert.push(`Moving the wrong way vs. the previous reading (${prev?.date}).`);
  if (!latest) alert.push("No reading has ever been recorded for this metric on this process.");
  if (target === null) actions.push("No target is configured for this metric — set one so \"pass/fail\" is meaningful here.");

  if (passingCount !== null && passingCount > 0) good.push(`${passingCount} of ${scored.length} analysts are meeting target.`);
  if (best && bestPass === true) good.push(`${best.name} (${best.employeeCode}) is the strongest performer at ${formatValue(best.value, ab?.unit ?? d.unit)}.`);
  if (failingCount !== null && failingCount > 0) alert.push(`${failingCount} of ${scored.length} analysts are missing target.`);
  if (worst && worstPass === false) {
    alert.push(`${worst.name} (${worst.employeeCode}) is furthest from target at ${formatValue(worst.value, ab?.unit ?? d.unit)}.`);
    if (worst.teamLeader) {
      actions.push(`Loop in ${worst.teamLeader.name} (${worst.teamLeader.employeeCode}), ${worst.name}'s Team Leader, on the gap.`);
    } else {
      actions.push(`${worst.name} has no Team Leader on record to escalate through — worth checking the reporting chain.`);
    }
  }
  if (failingCount !== null && failingCount > 1) {
    actions.push(`Review the ${failingCount} analysts below target together — a shared root cause is more likely than ${failingCount} unrelated ones.`);
  }

  const Block = ({ title, icon: Icon, color, items, emptyText }: {
    title: string; icon: typeof CheckCircle2; color: string; items: string[]; emptyText: string;
  }) => (
    <div className="rounded-lg border pl-2.5" style={{ borderColor: `${color}30`, borderLeftWidth: 3, borderLeftColor: color }}>
      <div className="flex items-center gap-1.5 py-1.5 pr-2 text-[10px] font-bold uppercase tracking-wide" style={{ color }}>
        <Icon size={11} />{title}
      </div>
      <div className="pb-2 pr-2 space-y-1">
        {items.length ? items.map((t, i) => (
          <p key={i} className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">{t}</p>
        )) : <p className="text-[11px] text-slate-400 italic">{emptyText}</p>}
      </div>
    </div>
  );

  return (
    <section>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">
        Insights — what the numbers actually say
      </div>
      <div className="space-y-2.5">
        <Block title="Good things" icon={CheckCircle2} color={C_GREEN} items={good}
          emptyText="Nothing currently qualifies as a good-news line for this metric." />
        <Block title="High alert" icon={AlertTriangle} color={C_RED} items={alert}
          emptyText="Nothing currently rises to a high-alert line for this metric." />
        <Block title="Actionable points" icon={Lightbulb} color={C_AMBER} items={actions}
          emptyText="No specific action is indicated beyond the usual monitoring." />
      </div>
    </section>
  );
}

/** Drill-down drawer for CEO KPI strip and Business Health tiles — uses already-loaded health data, no extra API call. */
function SummaryTileDrillDrawer({ metricKey, health, passCount, failCount, onClose }: {
  metricKey: string | null;
  health?: ProcessBusinessHealth;
  passCount: number;
  failCount: number;
  onClose: () => void;
}) {
  // Return null immediately when closed — prevents cfg computation running with undefined data
  if (!metricKey) return null;

  const f = health?.finance;
  const hc = health?.headcount;
  const hi = health?.hiring;

  const fmtL = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return "—";
    const abs = Math.abs(v); const s = v < 0 ? "−" : "";
    if (abs >= 10_000_000) return `${s}₹${(abs / 10_000_000).toFixed(1)}Cr`;
    if (abs >= 100_000) return `${s}₹${(abs / 100_000).toFixed(1)}L`;
    if (abs >= 1_000) return `${s}₹${(abs / 1_000).toFixed(0)}K`;
    return `${s}₹${abs.toLocaleString("en-IN")}`;
  };

  const qualityPct = (passCount + failCount) > 0 ? Math.round((passCount / (passCount + failCount)) * 100) : null;
  const revPerAgent = (f?.revenue && (hc?.activeHc ?? 0) > 0) ? Math.round(f.revenue / hc!.activeHc) : null;

  type Entry = { title: string; value: string; target?: string; trend: TrendDir; trendLabel: string; analysis: string; actions: string[]; related: string[] };

  const cfg: Record<string, Entry> = {
    // ── CEO strip ──────────────────────────────────────────────────────────────
    ceo_revenue: {
      title: "Revenue", value: f?.available ? fmtL(f.revenue) : "—",
      trend: !f?.available ? "action" : (f.revenue && f.revenue > 0 ? "positive" : "action"),
      trendLabel: !f?.available ? "Data gap" : f?.revenueStatus === "accounting_fallback" ? "Fallback mode" : "On track",
      analysis: f?.available
        ? `Monthly revenue is ${fmtL(f.revenue)}, recognised via ${f.revenueStatus === "accounting_fallback" ? "accounting fallback" : "configured billing rules"}. Revenue is the top-line health signal — sustained growth indicates healthy client delivery and billing accuracy.`
        : `Revenue data unavailable for this process. ${f?.reason ?? "Configure billing rules in process settings to enable live P&L tracking."}`,
      actions: f?.available && f.revenue && f.revenue > 0
        ? ["Verify billing rule matches current client contract", "Cross-check with client invoice register", "Compare to prior month to confirm growth trajectory"]
        : ["Configure revenue billing rules for this process", "Contact finance team to map billing entries", "Upload manual revenue data if billing rules cannot be set"],
      related: ["Operating %", "EBIT", "Rev / Agent"],
    },
    ceo_op_pct: {
      title: "Operating %",
      value: f?.agentSalaryIsRealThisMonth && f.operatingProfitPct !== null ? `${f.operatingProfitPct.toFixed(1)}%` : "—",
      target: "12–18% (BPO benchmark)",
      trend: !f?.agentSalaryIsRealThisMonth || f?.operatingProfitPct === null ? "action"
        : f.operatingProfitPct >= 12 ? "positive" : f.operatingProfitPct >= 0 ? "action" : "negative",
      trendLabel: !f?.agentSalaryIsRealThisMonth ? "Payroll pending" : f?.operatingProfitPct === null ? "No data"
        : f.operatingProfitPct >= 12 ? "Healthy" : f.operatingProfitPct >= 0 ? "Below target" : "Loss",
      analysis: f?.agentSalaryIsRealThisMonth && f?.operatingProfitPct !== null
        ? `Operating margin is ${f.operatingProfitPct.toFixed(1)}% (${fmtL(f.ebit)} EBIT ÷ ${fmtL(f.revenue)} revenue). BPO benchmark is 12–18%. ${f.operatingProfitPct >= 12 ? "This process is in the healthy range." : f.operatingProfitPct >= 0 ? "Margin is below benchmark — review cost structure." : "Process is operating at a loss — immediate action required on cost or revenue."}`
        : "Operating % requires payroll data to compute. Once the current month's payroll run is complete, this will reflect EBIT ÷ Revenue.",
      actions: f?.operatingProfitPct != null && f.operatingProfitPct < 12
        ? ["Review agent salary costs against revenue ratio", "Check GRN/vendor costs for optimisation opportunities", "Verify revenue rules capture all billable volume", "Escalate to operations head if loss persists beyond this month"]
        : ["Monitor monthly — flag if drops below 12%", "Track GRN trend for creeping vendor cost increases"],
      related: ["Revenue", "EBIT", "Agent Salary", "Rev / Agent"],
    },
    ceo_quality: {
      title: "Quality Score", value: qualityPct !== null ? `${qualityPct}%` : "—",
      target: "≥ 80% metrics on target",
      trend: qualityPct === null ? "action" : qualityPct >= 80 ? "positive" : qualityPct >= 55 ? "action" : "negative",
      trendLabel: qualityPct === null ? "No data" : qualityPct >= 80 ? "On target" : qualityPct >= 55 ? "Action req." : "Critical",
      analysis: qualityPct !== null
        ? `${passCount} of ${passCount + failCount} targeted KPI metrics are meeting their targets — a quality score of ${qualityPct}%. ${qualityPct >= 80 ? "Process is performing well across all monitored KPIs." : qualityPct >= 55 ? "Over a third of metrics are off-target. Review failing metrics in the KPI sections below." : "More than half of targeted metrics are failing. Immediate review across all KPI sections required."}`
        : "No targeted metrics configured. Set targets for KPI metrics to enable quality scoring.",
      actions: qualityPct !== null && qualityPct < 80
        ? ["Scroll to KPI Sections below to identify failing metrics", "Focus on metrics with Action Required status first", "Check for stale data feeds — staleness masks true performance", "Schedule weekly review with team leads for bottom performers"]
        : ["Continue weekly monitoring cadence", "Review thresholds if all metrics consistently pass"],
      related: ["HC vs Mandate", "Rev / Agent", "Active Headcount"],
    },
    ceo_hc: {
      title: "HC vs Mandate",
      value: hc?.gap !== null && hc?.gap !== undefined ? (hc.gap >= 0 ? `+${hc.gap}` : String(hc.gap)) : "—",
      target: "0 or above (fully staffed)",
      trend: hc?.gap === null || hc?.gap === undefined ? "action" : hc.gap >= 0 ? "positive" : "negative",
      trendLabel: hc?.gap === null || hc?.gap === undefined ? "No mandate" : hc.gap >= 0 ? "Fully staffed" : "Understaffed",
      analysis: hc?.available
        ? `Active headcount is ${hc.activeHc} against a mandate of ${hc.mandatedHc ?? "unset"}. Gap: ${hc.gap !== null ? (hc.gap >= 0 ? `+${hc.gap} (above mandate)` : `${hc.gap} (below mandate)`) : "unknown"}. ${hc.gap !== null && hc.gap < 0 ? `A shortfall of ${Math.abs(hc.gap)} reduces process capacity and increases per-agent workload.` : "Process is operating at or above mandated staffing levels."}`
        : "Mandate data is not configured for this process. Set mandate headcount in the process master to enable gap tracking.",
      actions: hc?.gap !== null && hc.gap < 0
        ? [`Raise ${Math.abs(hc.gap)} requisition(s) to close the HC gap`, "Review available pipeline for quick fills", "Escalate shortfall to operations manager if persistent", "Consider cross-process allocation while hiring is in progress"]
        : ["Monitor monthly — raise requisitions proactively before mandate is breached", "Keep hiring pipeline active even when fully staffed"],
      related: ["Rev / Agent", "Quality Score", "Candidates in Pipeline", "Open Positions"],
    },
    ceo_rev_agent: {
      title: "Rev / Agent", value: fmtL(revPerAgent),
      target: "Process-specific billing rate",
      trend: revPerAgent === null ? "action" : revPerAgent > 0 ? "positive" : "action",
      trendLabel: revPerAgent === null ? "No data" : "Monthly productivity",
      analysis: revPerAgent !== null
        ? `Each active agent generates ${fmtL(revPerAgent)} of revenue per month (${fmtL(f?.revenue)} ÷ ${hc?.activeHc ?? 0} agents). Compare against your client contract rate to assess margin per seat.`
        : "Rev/Agent requires both revenue data and active headcount. Configure billing rules and verify all agents are mapped to this process.",
      actions: revPerAgent !== null
        ? ["Compare to prior month to identify productivity trajectory", "Check if revenue per seat matches client billing rate", "Flag agents with significantly below-average output for coaching", "Balance quality score against Rev/Agent — volume over compliance is a risk"]
        : ["Configure revenue billing rules for this process", "Verify all active agents are correctly mapped"],
      related: ["Revenue", "Active Headcount", "Quality Score"],
    },
    // ── Business Health — Finance ──────────────────────────────────────────────
    hs_revenue: { title: "Revenue", value: f?.available ? fmtL(f.revenue) : "—", trend: !f?.available ? "action" : f?.revenue && f.revenue > 0 ? "positive" : "action", trendLabel: !f?.available ? "No data" : "This month", analysis: `Monthly process revenue is ${fmtL(f?.revenue)}. This feeds directly into operating profit and margin calculations.`, actions: ["Verify billing rule is correctly mapped to this process", "Cross-check with client invoice register"], related: ["EBIT", "Operating %", "GRN (vendor cost)"] },
    hs_grn: { title: "GRN (Vendor Cost)", value: f?.available ? fmtL(f.grn) : "—", trend: "neutral", trendLabel: "Vendor cost", analysis: `GRN vendor costs this month: ${fmtL(f?.grn)}. This is deducted from revenue when computing EBIT.`, actions: ["Review vendor invoices for accuracy", "Identify optimisation opportunities in vendor costs"], related: ["EBIT", "Revenue"] },
    hs_salary: { title: "Agent Salary", value: f?.agentSalaryIsRealThisMonth ? fmtL(f.agentSalary) : "Pending payroll", trend: !f?.agentSalaryIsRealThisMonth ? "action" : "neutral", trendLabel: !f?.agentSalaryIsRealThisMonth ? "Payroll pending" : "This month", analysis: !f?.agentSalaryIsRealThisMonth ? "Agent salary has not yet been processed for the current month. Run payroll to populate this metric." : `Agent salary cost is ${fmtL(f?.agentSalary)}, the primary cost driver for this process.`, actions: !f?.agentSalaryIsRealThisMonth ? ["Run current month payroll", "Verify all active agents are enrolled in payroll"] : ["Monitor salary cost as % of revenue", "Review against billing rate per agent"], related: ["EBIT", "Operating %", "Revenue"] },
    hs_ebit: { title: "EBIT", value: f?.agentSalaryIsRealThisMonth ? fmtL(f.ebit) : "Pending payroll", target: "> 0 (profitable)", trend: !f?.agentSalaryIsRealThisMonth || f?.ebit == null ? "action" : f.ebit >= 0 ? "positive" : "negative", trendLabel: !f?.agentSalaryIsRealThisMonth ? "Payroll pending" : f?.ebit != null && f.ebit >= 0 ? "Profitable" : "Loss", analysis: f?.agentSalaryIsRealThisMonth && f?.ebit != null ? `EBIT is ${fmtL(f.ebit)} (Revenue ${fmtL(f?.revenue)} − GRN ${fmtL(f?.grn)} − Salary ${fmtL(f?.agentSalary)}). ${f.ebit >= 0 ? "Process is profitable this month." : "Process is at a loss — cost or revenue action required."}` : "EBIT computation requires completed payroll. Run the current month's payroll to enable P&L.", actions: f?.ebit != null && f.ebit < 0 ? ["Investigate revenue shortfall vs prior month", "Review all cost components for reduction opportunities", "Escalate to operations head"] : ["Monitor monthly EBIT trend", "Ensure all cost inputs are complete and accurate"], related: ["Revenue", "GRN (vendor cost)", "Agent Salary", "Operating %"] },
    hs_op_pct: { title: "Operating %", value: f?.agentSalaryIsRealThisMonth && f?.operatingProfitPct !== null ? `${f.operatingProfitPct.toFixed(1)}%` : "Pending payroll", target: "12–18% (BPO benchmark)", trend: !f?.agentSalaryIsRealThisMonth || f?.operatingProfitPct === null ? "action" : f.operatingProfitPct >= 12 ? "positive" : f.operatingProfitPct >= 0 ? "action" : "negative", trendLabel: !f?.agentSalaryIsRealThisMonth ? "Payroll pending" : f?.operatingProfitPct !== null && f.operatingProfitPct >= 12 ? "Healthy" : "Below target", analysis: f?.agentSalaryIsRealThisMonth && f?.operatingProfitPct !== null ? `Operating margin ${f.operatingProfitPct.toFixed(1)}% — BPO benchmark is 12–18%. ${f.operatingProfitPct >= 12 ? "This process is in the healthy range." : "Below benchmark — review cost structure."}` : "Requires completed payroll to compute.", actions: ["Compare to BPO benchmark (12–18%)", "Review cost structure if below target", "Verify revenue recognition rules are complete"], related: ["EBIT", "Revenue", "Agent Salary"] },
    // ── Business Health — Headcount ────────────────────────────────────────────
    hs_active_hc: { title: "Active Headcount", value: String(hc?.activeHc ?? "—"), trend: "neutral", trendLabel: "On process", analysis: `${hc?.activeHc ?? 0} active employees are currently allocated to this process. ${hc?.mandatedHc ? `Mandate is ${hc.mandatedHc} — gap is ${hc.gap !== null ? (hc.gap >= 0 ? `+${hc.gap}` : String(hc.gap)) : "unknown"}.` : "No mandate configured."}`, actions: ["Verify all active agents are correctly mapped to this process", "Check agents on leave that reduce availability"], related: ["HC vs Mandate", "Available Now", "Gap vs Mandate"] },
    hs_mandate: { title: "Mandate", value: hc?.mandatedHc != null ? String(hc.mandatedHc) : "Not configured", trend: hc?.mandatedHc ? "neutral" : "action", trendLabel: hc?.mandatedHc ? "Sanctioned" : "Not configured", analysis: hc?.mandatedHc ? `Mandate headcount is ${hc.mandatedHc}. This is the target staffing level set for this process.` : "No mandate has been configured for this process. Set it in process master to enable gap tracking.", actions: hc?.mandatedHc ? ["Review mandate periodically as client volume changes", "Update mandate when contract headcount changes"] : ["Configure mandate headcount in process master settings", "Align with client contract staffing requirements"], related: ["Active Headcount", "Gap vs Mandate", "Shortfall"] },
    hs_available: { title: "Available Now", value: String(hc?.availableCount ?? "—"), trend: "neutral", trendLabel: "Staffed today", analysis: `${hc?.availableCount ?? 0} agents are currently available and staffed on this process. This may differ from active headcount due to leave, training or other unavailability.`, actions: ["Review agents on leave vs mandate requirements", "Plan leave coverage to avoid availability gaps on peak days"], related: ["Active Headcount", "HC vs Mandate"] },
    hs_hc_gap: { title: "Gap vs Mandate", value: hc?.gap != null ? (hc.gap >= 0 ? `+${hc.gap}` : String(hc.gap)) : "—", target: "0 or above", trend: hc?.gap == null ? "action" : hc.gap >= 0 ? "positive" : "negative", trendLabel: hc?.gap == null ? "No mandate" : hc.gap >= 0 ? "Above mandate" : "Below mandate", analysis: hc?.gap != null ? `Current gap vs mandate: ${hc.gap >= 0 ? `+${hc.gap} (above mandate)` : `${hc.gap} (below mandate)`}. ${hc.gap < 0 ? "Understaffing increases per-agent workload and can impact quality and SLAs." : "Process is adequately staffed at or above mandate."}` : "Mandate not configured — gap cannot be computed.", actions: hc?.gap != null && hc.gap < 0 ? [`Raise ${Math.abs(hc.gap)} new requisition(s) immediately`, "Check hiring pipeline for near-ready candidates", "Escalate to operations manager if gap is persistent"] : ["Continue monitoring — proactively raise reqs before mandate is breached"], related: ["Active Headcount", "Mandate", "Buffer", "Shortfall"] },
    hs_buffer: { title: "Buffer", value: hc?.buffer != null ? `+${hc.buffer}` : "—", trend: hc?.buffer != null && hc.buffer > 0 ? "positive" : "neutral", trendLabel: "Above mandate", analysis: `Buffer of ${hc?.buffer ?? 0} agents above mandate. A positive buffer provides capacity for leave coverage and volume spikes.`, actions: ["Maintain buffer for SLA protection during leave peaks", "Review if excess buffer is generating unnecessary cost"], related: ["Active Headcount", "Mandate", "Gap vs Mandate"] },
    hs_shortfall: { title: "Shortfall", value: String(hc?.shortfall ?? "—"), target: "0", trend: hc?.shortfall != null && hc.shortfall > 0 ? "negative" : "positive", trendLabel: hc?.shortfall ? "Below mandate" : "None", analysis: `Shortfall of ${hc?.shortfall ?? 0} agents below mandate. ${hc?.shortfall && hc.shortfall > 0 ? "This directly impacts capacity, SLAs and agent workload." : "Process is fully staffed against mandate."}`, actions: hc?.shortfall && hc.shortfall > 0 ? ["Raise immediate requisitions to close the shortfall", "Escalate to operations manager", "Consider cross-process temporary allocation"] : ["Continue monitoring — proactively prevent shortfall building up"], related: ["Active Headcount", "Gap vs Mandate", "Open Positions"] },
    // ── Business Health — Hiring ───────────────────────────────────────────────
    hs_req: { title: "Open Requisitions", value: String(hi?.openRequisitions ?? "—"), trend: (hi?.openRequisitions ?? 0) > 0 ? "action" : "positive", trendLabel: (hi?.openRequisitions ?? 0) > 0 ? "Hiring active" : "No open reqs", analysis: `${hi?.openRequisitions ?? 0} open hiring requisition(s) for this process. Open requisitions indicate active demand for new hires.`, actions: ["Review each requisition for priority and timeline", "Ensure JDs are published and pipeline is active", "Close fulfilled requisitions promptly"], related: ["Open Positions", "Candidates in Pipeline", "Gap vs Mandate"] },
    hs_positions: { title: "Open Positions", value: String(hi?.openPositions ?? "—"), target: "0 (all filled)", trend: (hi?.openPositions ?? 0) > 0 ? "negative" : "positive", trendLabel: (hi?.openPositions ?? 0) > 0 ? "Unfilled" : "All filled", analysis: `${hi?.openPositions ?? 0} position(s) yet to be filled. Each unfilled position contributes to headcount gap and operational risk.`, actions: ["Prioritise filling positions linked to mandate shortfall", "Escalate aged positions to senior recruiter", "Review selection criteria if time-to-fill is high"], related: ["Open Requisitions", "Candidates in Pipeline", "Shortfall"] },
    hs_hired: { title: "Hired (All Time)", value: String(hi?.hiredCount ?? "—"), trend: "positive", trendLabel: "Cumulative", analysis: `${hi?.hiredCount ?? 0} candidates have been hired via formal requisitions for this process. This is a cumulative metric since tracking began.`, actions: ["Use hire data to benchmark time-to-fill for future planning", "Track attrition against total hires to assess retention rate"], related: ["Open Requisitions", "Pending Hiring"] },
    hs_pending: { title: "Pending Hiring", value: String(hi?.pendingHiringCount ?? "—"), trend: (hi?.pendingHiringCount ?? 0) > 0 ? "action" : "positive", trendLabel: (hi?.pendingHiringCount ?? 0) > 0 ? "Pending" : "None pending", analysis: `${hi?.pendingHiringCount ?? 0} hiring request(s) raised but not yet fulfilled. These represent demand that has not yet translated into offers or joins.`, actions: ["Review pending requests for blockers", "Escalate long-pending requests to senior recruiter", "Ensure each pending request has an active pipeline"], related: ["Open Positions", "Candidates in Pipeline", "Gap vs Mandate"] },
    hs_pipeline: { title: "Candidates in Pipeline", value: String(hi?.candidatesInPipeline ?? "—"), trend: (hi?.candidatesInPipeline ?? 0) > 0 ? "positive" : "action", trendLabel: (hi?.candidatesInPipeline ?? 0) > 0 ? "Active pipeline" : "Empty pipeline", analysis: `${hi?.candidatesInPipeline ?? 0} candidate(s) in the active hiring pipeline matched to this process. A healthy pipeline ensures open positions can be filled quickly.`, actions: ["Target pipeline of at least 3× open positions count", "Move candidates through stages promptly to reduce drop-off", "Review selection pass rate — low rate indicates JD/sourcing mismatch"], related: ["Open Positions", "Open Requisitions", "Pending Hiring"] },
  };

  const entry = cfg[metricKey ?? ""];
  if (!entry) return null;

  const headerGrad = metricKey === "ceo_revenue" ? "linear-gradient(135deg,#1e3a5f,#2f6fed)"
    : metricKey === "ceo_op_pct" ? "linear-gradient(135deg,#047857,#10b981)"
    : metricKey === "ceo_quality" ? "linear-gradient(135deg,#0369a1,#06b6d4)"
    : metricKey === "ceo_hc" ? "linear-gradient(135deg,#047857,#10b981)"
    : metricKey === "ceo_rev_agent" ? "linear-gradient(135deg,#5b21b6,#7c5ce5)"
    : (metricKey ?? "").startsWith("hs_revenue") || (metricKey ?? "").startsWith("hs_grn") || (metricKey ?? "").startsWith("hs_ebit") || (metricKey ?? "").startsWith("hs_op_pct") || (metricKey ?? "").startsWith("hs_salary") ? "linear-gradient(135deg,#1e40af,#3b82f6)"
    : (metricKey ?? "").startsWith("hs_active") || (metricKey ?? "").startsWith("hs_mandate") || (metricKey ?? "").startsWith("hs_available") || (metricKey ?? "").startsWith("hs_hc") || (metricKey ?? "").startsWith("hs_buffer") || (metricKey ?? "").startsWith("hs_shortfall") ? "linear-gradient(135deg,#6d28d9,#8b5cf6)"
    : "linear-gradient(135deg,#b45309,#f59e0b)";

  const bannerCol = entry.trend === "positive"
    ? { bg: "#f0fdf4", border: "#86efac", text: "#15803d", label: "Positive Trend" }
    : entry.trend === "negative"
    ? { bg: "#fef2f2", border: "#fca5a5", text: "#dc2626", label: "Negative Trend" }
    : entry.trend === "action"
    ? { bg: "#fffbeb", border: "#fcd34d", text: "#d97706", label: "Action Required" }
    : { bg: "#f8fafc", border: "#e2e8f0", text: "#64748b", label: "Informational" };
  const BannerIcon = entry.trend === "positive" ? ArrowUpRight : entry.trend === "negative" ? ArrowDownRight : entry.trend === "action" ? AlertTriangle : Minus;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-sm p-0 overflow-y-auto border-l-0 shadow-2xl">
        {/* Header */}
        <div style={{ background: headerGrad, padding: "18px 20px 16px" }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".45px", fontWeight: 900, color: "rgba(255,255,255,.75)", marginBottom: 4 }}>Depth Analysis</p>
              <p style={{ fontSize: 18, fontWeight: 900, color: "#fff", lineHeight: 1.2 }}>{entry.title}</p>
              <p style={{ fontSize: 22, fontWeight: 950, color: "#fff", marginTop: 4, lineHeight: 1 }}>{entry.value}</p>
              {entry.target && <p style={{ fontSize: 9, color: "rgba(255,255,255,.7)", marginTop: 3, fontWeight: 700 }}>Target: {entry.target}</p>}
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <button onClick={onClose} style={{ background: "rgba(255,255,255,.15)", border: "none", borderRadius: 8, padding: "4px 6px", cursor: "pointer", color: "#fff" }}><X size={14} /></button>
              <TrendChip trend={entry.trend} label={entry.trendLabel} />
            </div>
          </div>
        </div>
        {/* Body */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Trend status banner */}
          <div style={{ background: bannerCol.bg, border: `1px solid ${bannerCol.border}`, borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <BannerIcon size={14} style={{ color: bannerCol.text, flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: 10, fontWeight: 900, color: bannerCol.text, textTransform: "uppercase", letterSpacing: ".4px" }}>{bannerCol.label}</p>
              <p style={{ fontSize: 11, color: bannerCol.text, marginTop: 2, opacity: 0.85, lineHeight: 1.4 }}>{entry.trendLabel}</p>
            </div>
          </div>
          {/* Analysis */}
          <div>
            <p style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".45px", color: "#64748b", marginBottom: 6 }}>Analysis</p>
            <p style={{ fontSize: 12, color: "#334155", lineHeight: 1.65 }}>{entry.analysis}</p>
          </div>
          {/* Action items */}
          {entry.actions.length > 0 && (
            <div>
              <p style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".45px", color: "#64748b", marginBottom: 6 }}>Action Items</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {entry.actions.map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 10px" }}>
                    <span style={{ background: "#f59e0b", color: "#fff", borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 900, flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                    <p style={{ fontSize: 11, color: "#92400e", lineHeight: 1.5 }}>{a}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Related metrics */}
          {entry.related.length > 0 && (
            <div>
              <p style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".45px", color: "#64748b", marginBottom: 6 }}>Related Metrics</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {entry.related.map((r) => (
                  <span key={r} style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 999, padding: "3px 10px", fontSize: 10, fontWeight: 700, color: "#475569" }}>{r}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The drill-down drawer: the formula, the source it reads, the filter on every
 * field, and each daily reading with the parts it divided.
 */
function DrilldownDrawer({ processId, metricKey, period, onClose }: {
  processId: string; metricKey: string | null; period: ReportPeriod; onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["process-operations", "drilldown", processId, metricKey, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Drilldown>>(
      `/api/process-operations/${processId}/metric/${metricKey}?period=${period}`),
    enabled: Boolean(metricKey),
  });
  const d = data?.data;
  // Keyed by BOTH processId and metricKey, not metricKey alone -- most
  // workforce metrics (SHRINKAGE_PCT, ATTENDANCE_ISSUES_OPEN...) share the
  // same key across nearly every process, so metricKey alone would carry an
  // expanded date over from one process's drilldown into a completely
  // different process's drilldown for the "same" metric.
  const [expandedFor, setExpandedFor] = useState<{ processId: string; metricKey: string | null; date: string } | null>(null);
  // Collapsed by default -- the formula/source/field breakdown is real,
  // required detail (Drill-Down Mandate: nothing is hidden), but it is SQL-
  // facing detail most readers open this drawer to get past, not to read
  // first. The chart and the actual readings are what a click on a KPI tile
  // is usually for; the working behind the number is one click away, not the
  // first thing in the way of it.
  const [showDetails, setShowDetails] = useState(false);
  const expandedDate = expandedFor?.processId === processId && expandedFor.metricKey === metricKey
    ? expandedFor.date : null;
  const toggleExpanded = (date: string) => setExpandedFor((prev) =>
    prev?.processId === processId && prev.metricKey === metricKey && prev.date === date
      ? null : { processId, metricKey, date });
  const Label = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{children}</div>
  );
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex gap-3 py-1 text-xs">
      <span className="text-slate-500 w-36 shrink-0">{k}</span>
      <span className="text-slate-800 dark:text-slate-200 font-medium break-all">{v ?? "None"}</span>
    </div>
  );
  return (
    <Sheet open={Boolean(metricKey)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-[63rem] p-0 overflow-y-auto">
        <div className="sticky top-0 z-10 px-5 py-3 flex items-start gap-3" style={{ background: NAVY }}>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{d?.metricName ?? metricKey}</h2>
            <p className="text-[10px] text-indigo-200 mt-0.5">
              {d?.processName ?? ""}{d?.unit ? ` · ${d.unit}` : ""}
              {d?.direction ? ` · ${d.direction.replace("_", " ")}` : ""}
              {d && d.period !== "trend" && formatPeriodRange(d.periodFrom, d.periodTo)
                ? ` · ${PERIODS.find((p) => p.key === d.period)?.label ?? d.period} (${formatPeriodRange(d.periodFrom, d.periodTo)})`
                : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="ml-auto p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1">
            <X size={15} />
          </button>
        </div>

        {isLoading || !d ? (
          <div className="p-6 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />Loading the working…
          </div>
        ) : (
          <div className="p-5 space-y-5">
            <DrilldownTrendChart
              readings={d.readings} unit={d.unit}
              targetValue={d.definition?.targetValue ?? null} direction={d.direction} />

            <section>
              <Label>Every reading, newest first — click a day for the individual records behind it</Label>
              {d.readings.length ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-96 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-semibold">Date</th>
                        <th className="text-right px-2 py-1.5 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.readings.map((x) => (
                        <Fragment key={x.date}>
                          <tr onClick={() => toggleExpanded(x.date)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpanded(x.date); } }}
                            role="button" tabIndex={0} aria-expanded={expandedDate === x.date}
                            title="Show the individual records behind this day"
                            className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                              expandedDate === x.date ? "bg-slate-50 dark:bg-slate-800/40" : ""}`}>
                            <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300 flex items-center gap-1">
                              <ChevronRight size={11}
                                className={`shrink-0 text-slate-400 transition-transform ${expandedDate === x.date ? "rotate-90" : ""}`} />
                              {x.date}
                              {x.source === "manual" && (
                                <PenLine size={10} className="text-purple-500 shrink-0"
                                  aria-label="Typed in by hand" />
                              )}
                            </td>
                            <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                              x.value === null ? "text-slate-400 italic font-normal" : "text-slate-900 dark:text-slate-100"}`}>
                              {x.value === null ? "no data" : formatValue(x.value, d.unit)}
                            </td>
                          </tr>
                          {expandedDate === x.date && metricKey && (
                            <RawRowsPanel processId={processId} metricKey={metricKey} date={x.date} columnCount={2} />
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-xs text-slate-400 italic">None</p>}
              <p className="text-[10px] text-slate-400 mt-1.5">
                A "no data" row means the source was read and the calculation had nothing to say —
                not that the value was zero.
              </p>
            </section>

            {metricKey && <AnalystBreakdownPanel processId={processId} metricKey={metricKey} period={period} />}

            {metricKey && <InsightsPanel d={d} processId={processId} metricKey={metricKey} period={period} />}

            <section className="rounded-xl border border-slate-200 dark:border-slate-800">
              <button type="button" onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <Filter size={11} />How this number is calculated
                </span>
                <ChevronRight size={13}
                  className={`shrink-0 text-slate-400 transition-transform ${showDetails ? "rotate-90" : ""}`} />
              </button>
              {showDetails && (
                <div className="px-3 pb-3 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-3">
                  <div>
                    <Label>Formula</Label>
                    {d.definition?.formula ? (
                      <code className="block rounded-lg bg-slate-900 text-emerald-300 text-[11px] px-3 py-2 font-mono break-all">
                        {d.definition.formula}
                      </code>
                    ) : <p className="text-xs text-slate-400 italic">No formula recorded.</p>}
                    <div className="mt-2">
                      <Row k="Grain" v={d.definition?.grain} />
                      <Row k="In force from" v={d.definition?.effectiveFrom} />
                      <Row k="In force to" v={d.definition?.effectiveTo ?? "open"} />
                      <Row k="Target" v={d.definition?.targetValue ?? "None"} />
                      <Row k="Defined" v={d.definition?.createdAt ? new Date(d.definition.createdAt).toLocaleString("en-GB") : "None"} />
                      {d.definition?.notes && <Row k="Notes" v={d.definition.notes} />}
                    </div>
                  </div>

                  <div>
                    <Label><span className="inline-flex items-center gap-1"><Database size={11} />Where the data comes from</span></Label>
                    {d.source ? (
                      <div>
                        <Row k="Source" v={`${d.source.sourceCode}${d.source.sourceName ? ` — ${d.source.sourceName}` : ""}`} />
                        <Row k="Table" v={d.source.sourceObject} />
                        <Row k="Date column" v={d.source.dateColumn} />
                        <Row k="Attributed by" v={d.source.processKeyKind === "column"
                          ? `${d.source.processKeyColumn} = ${d.source.processKeyValue}`
                          : d.source.processKeyKind} />
                      </div>
                    ) : <p className="text-xs text-slate-400 italic">None</p>}
                  </div>

                  <div>
                    <Label><span className="inline-flex items-center gap-1"><Filter size={11} />The parts it counts</span></Label>
                    {d.fields.length ? (
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-[11px]">
                          <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                            <tr>
                              <th className="text-left px-2 py-1.5 font-semibold">Field</th>
                              <th className="text-left px-2 py-1.5 font-semibold">Agg</th>
                              <th className="text-left px-2 py-1.5 font-semibold">Column</th>
                              <th className="text-left px-2 py-1.5 font-semibold">Filter</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.fields.map((f) => (
                              <tr key={f.fieldName} className="border-t border-slate-100 dark:border-slate-800">
                                <td className="px-2 py-1.5 font-mono text-slate-800 dark:text-slate-200">{f.fieldName}</td>
                                <td className="px-2 py-1.5 text-slate-500">{f.aggregateFn ?? "—"}</td>
                                <td className="px-2 py-1.5 text-slate-500">{f.sourceColumn ?? "—"}</td>
                                <td className="px-2 py-1.5 text-slate-500 max-w-[15rem] truncate" title={f.filter ?? ""}>
                                  {f.filter ?? "no filter"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-xs text-slate-400 italic">None</p>}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Manual entry drawer — for a process a feed does not reach. Writes through
 * the SAME endpoint Process Data Sources uses (POST /api/process-data-source/
 * :processId/values), which lands in process_metric_actual with source
 * 'manual'; Process Operations reads that table already, so a saved reading
 * shows up here on its own next refetch with no other change needed.
 *
 * The metric dropdown is the closed set of active kpi_metric_master
 * definitions (the Form Input Rule: a free-text metric key forks an orphan
 * nobody reads), fetched once and reused across opens.
 */
function ManualEntryDrawer({ open, processId, processName, onClose, onSaved }: {
  open: boolean; processId: string | null; processName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [metricKey, setMetricKey] = useState("");
  const [scoreDate, setScoreDate] = useState(todayIso());
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  const { data: catalogData, isLoading: catalogLoading } = useQuery({
    queryKey: ["process-data-source", "metric-catalog"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<CatalogMetric[]>>("/api/process-data-source/metric-catalog"),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const catalog = catalogData?.data ?? [];
  // The code is what a bulk paste actually needs to type, so it is shown
  // alongside the name here too — this dropdown doubles as the lookup a
  // pasted row's metric_key column is checked against.
  const options: SearchableOption[] = catalog.map((m) => ({
    value: m.metricCode, label: m.metricName, hint: m.metricCode,
  }));

  // ── Bulk paste — the actual "upload" half of the mandate: many rows in one
  // go, not one value at a time. Same four columns the single-entry form
  // collects (metricKey,scoreDate,value[,note]), reusing the SAME import
  // endpoint (and therefore the same registry/date validation) Process Data
  // Sources already uses — a dry run cannot pass where the real write would
  // fail, because it is the same check, not a lookalike.
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportOutcome[] | null>(null);
  // A dry-run "ready" row and a post-import "saved" row reuse the same table,
  // but must not reuse the same word -- "saved" on a row that is only checked
  // and not yet written directly contradicts the "nothing is saved yet" line
  // right above the table.
  const [previewDryRun, setPreviewDryRun] = useState(true);

  // The drawer is one persistent component whose visibility toggles, not one
  // remounted per open -- without this, closing it half-filled and reopening
  // for a DIFFERENT process would silently carry the first process's typed
  // value or pasted rows into the second one's write, since the mutation
  // closes over whatever processId is current at click time. Reset on every
  // (re)open and on every process switch, whichever fires first.
  useEffect(() => {
    if (!open) return;
    setMode("single"); setMetricKey(""); setScoreDate(todayIso());
    setValue(""); setNote(""); setPasted(""); setFileName(null); setPreview(null);
  }, [open, processId]);

  /** Reads a .csv/.txt in the browser; nothing is sent anywhere until Check runs. */
  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPasted(String(reader.result ?? ""));
      setFileName(file.name);
      setPreview(null);
    };
    reader.readAsText(file);
  };
  const parseBulkRows = (text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const body = lines.length && /^metric[_ ]?key\s*,/i.test(lines[0]) ? lines.slice(1) : lines;
    return body.map((line) => {
      const [mk, scoreDate, val, ...noteParts] = line.split(",").map((c) => c.trim());
      return { metricKey: mk, scoreDate, value: val, note: noteParts.join(",") || undefined };
    });
  };
  const runBulkImport = (dryRun: boolean) =>
    hrmsApi.post<HrmsEnvelope<ImportResult>>(`/api/process-data-source/${processId}/import`, {
      rows: parseBulkRows(pasted), dry_run: dryRun,
    });
  const checkBulk = useMutation({
    mutationFn: () => runBulkImport(true),
    onSuccess: (res) => { setPreview(res.data.outcomes); setPreviewDryRun(true); },
    onError: (err: unknown) => toast({
      title: "Could not check rows", variant: "destructive",
      description: err instanceof Error ? err.message : "Request failed",
    }),
  });
  const importBulk = useMutation({
    mutationFn: () => runBulkImport(false),
    onSuccess: (res) => {
      setPreview(res.data.outcomes);
      setPreviewDryRun(false);
      const failed = res.data.errors.length;
      toast({
        title: `${res.data.imported} row${res.data.imported === 1 ? "" : "s"} saved`,
        description: failed ? `${failed} row${failed === 1 ? "" : "s"} rejected — see the list below.` : undefined,
        variant: failed ? "destructive" : undefined,
      });
      onSaved();
    },
    onError: (err: unknown) => toast({
      title: "Import failed", variant: "destructive",
      description: err instanceof Error ? err.message : "Request failed",
    }),
  });
  const readyCount = preview?.filter((o) => o.ok).length ?? 0;
  const blockedCount = preview?.filter((o) => !o.ok).length ?? 0;

  // Single entry has no dry-run step the way bulk paste does, so this is its
  // only warning before Save silently overwrites a real, already-measured
  // figure. Reuses the same read the bulk path's "replaces" hint is built
  // from, scoped to exactly the one day being typed into.
  const { data: existingData } = useQuery({
    queryKey: ["process-data-source", "values", processId, scoreDate],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Array<{ metricKey: string; value: number | null; source: string }>>>(
      `/api/process-data-source/${processId}/values?from=${scoreDate}&to=${scoreDate}`),
    enabled: mode === "single" && Boolean(processId && scoreDate),
    staleTime: 30 * 1000,
  });
  const existingForMetric = metricKey
    ? (existingData?.data ?? []).find((v) => v.metricKey === metricKey && v.value !== null)
    : undefined;

  const save = useMutation({
    mutationFn: () => hrmsApi.post(`/api/process-data-source/${processId}/values`, {
      metricKey, scoreDate,
      value: value.trim() === "" ? null : Number(value),
      note: note.trim() || null,
    }),
    onSuccess: () => {
      toast({ title: "Reading saved", description: "It will appear on the tile above on next refresh." });
      setValue(""); setNote("");
      onSaved();
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not save", variant: "destructive",
        description: err instanceof Error ? err.message : "Request failed",
      });
    },
  });

  const canSave = Boolean(processId && metricKey && scoreDate && value.trim() !== "" && !save.isPending);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 overflow-y-auto">
        <div className="sticky top-0 z-10 px-5 py-3 flex items-start gap-3" style={{ background: NAVY }}>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
              <PenLine size={14} />Add a reading
            </h2>
            <p className="text-[10px] text-indigo-200 mt-0.5">
              {processName ? `For ${processName}. ` : ""}
              Saved values are marked "manual" everywhere they show.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="ml-auto p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1">
            <X size={15} />
          </button>
        </div>

        <div role="tablist" aria-label="Entry mode" className="flex border-b border-slate-200 dark:border-slate-800 px-5 pt-2">
          {([["single", "Single entry"], ["bulk", "Paste multiple"]] as const).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer border-b-2 -mb-px transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                mode === m ? "border-slate-800 text-slate-900 dark:border-slate-100 dark:text-slate-100"
                  : "border-transparent text-slate-400 hover:text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                Metric
              </label>
              <SearchableSelect
                options={options}
                value={metricKey}
                onChange={setMetricKey}
                loading={catalogLoading}
                placeholder="Choose a metric…"
                searchPlaceholder="Search metrics…"
                emptyText="No matching metric"
                aria-label="Metric"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                  Date
                </label>
                <input type="date" value={scoreDate} max={todayIso()}
                  onChange={(e) => setScoreDate(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                  Value
                </label>
                <input type="number" inputMode="decimal" value={value} placeholder="e.g. 92.5"
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-400" />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1.5 block">
                Note <span className="normal-case font-normal text-slate-400">(optional, but where's this figure from?)</span>
              </label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="e.g. Manually counted from the client's own tracker, 8 Sep"
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none" />
            </div>

            {existingForMetric && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>
                  {scoreDate} already has a {existingForMetric.source === "manual" ? "manually entered" : "measured"} value
                  of <strong className="tabular-nums">
                    {formatValue(existingForMetric.value, catalog.find((m) => m.metricCode === metricKey)?.unit ?? null)}
                  </strong> for this metric — saving will replace it.
                </span>
              </div>
            )}

            <button type="button" disabled={!canSave} onClick={() => save.mutate()}
              className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              style={{ background: NAVY }}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save reading
            </button>
            <p className="text-[10px] text-slate-400">
              Only enter a value you actually have — a guess stored here reads as real on every
              chart that uses it.
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Paste rows — one per line
                </label>
                <label className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer inline-flex items-center gap-1">
                  <Upload size={11} />
                  {fileName ?? "Upload .csv/.txt"}
                  <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0])} />
                </label>
              </div>
              <textarea value={pasted} rows={7}
                onChange={(e) => { setPasted(e.target.value); setPreview(null); setFileName(null); }}
                placeholder={"metric_key,date,value,note\nACCURACY_RATE,2026-09-08,91.5,\nUTILIZATION,2026-09-08,84.3,from client tracker"}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-900 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-400 resize-none" />
              <p className="text-[10px] text-slate-400 mt-1">
                metric_key,date,value[,note] — the metric_key is the code shown next to each name in
                the Single entry tab's dropdown. A header row is fine, it's dropped automatically.
              </p>
            </div>

            <div className="flex gap-2">
              <button type="button" disabled={!pasted.trim() || checkBulk.isPending}
                onClick={() => checkBulk.mutate()}
                className="flex-1 rounded-lg py-2 text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
                {checkBulk.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Check rows
              </button>
              <button type="button" disabled={!preview || readyCount === 0 || importBulk.isPending}
                onClick={() => importBulk.mutate()}
                className="flex-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ background: NAVY }}>
                {importBulk.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Import {readyCount ? `${readyCount} row${readyCount === 1 ? "" : "s"}` : ""}
              </button>
            </div>

            {preview && (
              <div>
                <p className="text-[10px] text-slate-500 mb-1.5">
                  {readyCount} ready{blockedCount ? `, ${blockedCount} blocked` : ""} — checked against
                  the same rules the write uses, nothing is saved yet.
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 max-h-56 overflow-y-auto">
                  <table className="w-full text-[10px]">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1 font-semibold">#</th>
                        <th className="text-left px-2 py-1 font-semibold">Metric</th>
                        <th className="text-left px-2 py-1 font-semibold">Date</th>
                        <th className="text-right px-2 py-1 font-semibold">Value</th>
                        <th className="text-left px-2 py-1 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((o) => (
                        <tr key={o.row} className={`border-t border-slate-100 dark:border-slate-800 ${o.ok ? "" : "bg-red-50/60 dark:bg-red-950/20"}`}>
                          <td className="px-2 py-1 text-slate-400">{o.row}</td>
                          <td className="px-2 py-1 font-mono text-slate-700 dark:text-slate-300">{o.metricKey}</td>
                          <td className="px-2 py-1 text-slate-500">{o.scoreDate}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {o.value === null ? "no data" : o.value}
                          </td>
                          <td className={`px-2 py-1 ${o.ok ? "text-emerald-600" : "text-red-600"}`}>
                            {o.ok
                              ? (previewDryRun
                                  ? (o.replaces !== undefined
                                      ? (o.replaces === null ? "ready — new" : `ready — replaces ${o.replaces}`)
                                      : "ready")
                                  : "saved")
                              : (o.message ?? "error")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Feeds that have stopped, above the numbers they stopped feeding. */
function StoppedFeeds({ health }: { health: FeedHealth }) {
  // Collapsed by default: this is a real, worth-knowing fact, but 100 dead
  // feeds rendered as a 9-tile grid was pushing the actual dashboard --
  // the numbers a reader came here for -- below the fold before it even
  // loaded. The headline count and the "how stale" line stay visible either
  // way; only the per-process breakdown is opt-in.
  const [expanded, setExpanded] = useState(false);
  const dead = health.feeds.filter((f) => f.state === "stopped");
  if (!dead.length) return null;
  const byProcess = new Map<string, FeedRow[]>();
  dead.forEach((f) => byProcess.set(f.processName, [...(byProcess.get(f.processName) ?? []), f]));
  return (
    <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/80 dark:bg-red-950/30 p-4 shadow-sm">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        className="w-full flex items-start gap-2 text-left cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
        <Radio className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-red-800 dark:text-red-300">
              {dead.length} measurement{dead.length === 1 ? "" : "s"} stopped updating
            </h2>
            <ChevronRight size={14}
              className={`shrink-0 text-red-500 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
          <p className="text-[11px] text-red-700/80 dark:text-red-400/80 mt-0.5">
            Nothing recorded for over {health.stoppedAfterDays} days. Their last value may still be
            on a tile below, looking current.{!expanded && " Click to see which."}
          </p>
        </div>
      </button>
      {expanded && (
        <>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {[...byProcess.entries()].slice(0, 9).map(([proc, rows]) => (
              <div key={proc} className="rounded-lg bg-white/80 dark:bg-slate-900/60 border border-red-100 dark:border-red-900/60 px-2.5 py-1.5">
                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">{proc}</div>
                <div className="text-[11px] text-red-700 dark:text-red-400 tabular-nums">
                  {rows.length} metric{rows.length === 1 ? "" : "s"} · quiet {Math.max(...rows.map((r) => r.staleDays ?? 0))} days
                </div>
              </div>
            ))}
          </div>
          {byProcess.size > 9 && (
            <p className="text-[11px] text-red-700/70 mt-1.5">and {byProcess.size - 9} more processes</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The gap StoppedFeeds cannot see: a metric with a real, active configuration
 * that has never once produced a row, ever — not a feed that went quiet, one
 * that never started. Grouped by (metric, source) rather than listed per
 * process, because the dominant case here is one dead table wearing dozens of
 * process names, not dozens of independent problems.
 */
/** metric_key,date,value,note — the same 4 columns the bulk-paste box already
 *  parses, so a filled-in template pastes straight in with zero translation. */
function downloadFillInTemplate(g: NeverReportedGroup, processName: string) {
  const days = 14;
  const rows: Array<Record<string, unknown>> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    rows.push({ metric_key: g.metricKey, date: d.toISOString().slice(0, 10), value: "", note: "" });
  }
  const safeProcess = processName.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  downloadCsv(`${g.metricKey}_${safeProcess}_template.csv`, ["metric_key", "date", "value", "note"], rows);
}

function NeverReportedBanner({ groups, currentProcessId, currentProcessName }: {
  groups: NeverReportedGroup[]; currentProcessId: string | null; currentProcessName: string | null;
}) {
  // Same reasoning as StoppedFeeds: collapsed by default so this doesn't
  // push the actual dashboard off the first screen. The headline count is
  // the part worth seeing unconditionally; the per-metric breakdown (with
  // its upload-path hints) is a click away.
  const [expanded, setExpanded] = useState(false);
  if (!groups.length) return null;
  const totalConfigs = groups.reduce((s, g) => s + g.processCount, 0);
  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/80 dark:bg-amber-950/30 p-4 shadow-sm">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
        className="w-full flex items-start gap-2 text-left cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-amber-800 dark:text-amber-300">
              {totalConfigs} configured measurement{totalConfigs === 1 ? "" : "s"} across {groups.length} metric{groups.length === 1 ? "" : "s"} {groups.length === 1 ? "has" : "have"} never reported
            </h2>
            <ChevronRight size={14}
              className={`shrink-0 text-amber-600 transition-transform ${expanded ? "rotate-90" : ""}`} />
          </div>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            A real configuration exists and a source table is named, but nothing has ever been written
            there — not a feed that stopped, one that never started.{!expanded && " Click to see which."}
          </p>
        </div>
      </button>
      {expanded && (
        <>
          <div className="mt-2.5 space-y-1.5">
            {groups.slice(0, 6).map((g) => (
              <div key={`${g.metricKey}|${g.sourceObject}`}
                className="rounded-lg bg-white/80 dark:bg-slate-900/60 border border-amber-100 dark:border-amber-900/60 px-2.5 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate">{g.metricName}</span>
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 tabular-nums shrink-0">
                    {g.processCount} process{g.processCount === 1 ? "" : "es"}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate" title={g.sourceObject}>
                  {g.sourceObject}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {g.processNames.slice(0, 4).join(", ")}{g.processCount > g.processNames.length ? `, +${g.processCount - g.processNames.length} more` : ""}
                </div>
                {g.uploadTypeName && g.existingSourceRows === 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                    <Upload className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">
                      Table is empty — Bulk Upload Hub → "{g.uploadTypeName}" would start this feed
                    </span>
                  </div>
                )}
                {g.uploadTypeName && g.existingSourceRows !== null && g.existingSourceRows > 0 && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-orange-700 dark:text-orange-400">
                    <Database className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">
                      {g.existingSourceRows.toLocaleString("en-IN")} raw rows already exist — this metric was never computed from them, not missing data
                    </span>
                  </div>
                )}
                {g.uploadTypeName && g.existingSourceRows === null && (
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                    <Upload className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">
                      Manual upload available — Bulk Upload Hub → "{g.uploadTypeName}"
                    </span>
                  </div>
                )}
                {currentProcessId && currentProcessName && g.processIds.includes(currentProcessId) && (
                  <button type="button"
                    onClick={() => downloadFillInTemplate(g, currentProcessName)}
                    title={`A blank 14-day CSV for ${g.metricKey} — same 4 columns "Add a reading" → Bulk paste already reads, fill in real values and paste it back in for ${currentProcessName}`}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1">
                    <Download size={10} />Blank template for {currentProcessName}
                  </button>
                )}
              </div>
            ))}
          </div>
          {groups.length > 6 && (
            <p className="text-[11px] text-amber-700/70 mt-1.5">and {groups.length - 6} more metric groups</p>
          )}
        </>
      )}
    </div>
  );
}

export default function ProcessOperationsPage() {
  const qc = useQueryClient();
  // Deep links: ?process=<id, code or name fragment>&view=kpi|live|sales.
  // The old standalone dashboard URLs redirect here with these set.
  const [searchParams] = useSearchParams();
  const processParam = searchParams.get("process");
  const [active, setActive] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [drill, setDrill] = useState<string | null>(null);
  const [summaryDrill, setSummaryDrill] = useState<string | null>(null);
  const [period, setPeriod] = useState<ReportPeriod>("trend");
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [view, setView] = useState<"kpi" | "live" | "sales">(() => {
    const v = searchParams.get("view");
    return v === "live" || v === "sales" ? v : "kpi";
  });
  // Active section key for overview strip highlighting + scroll-to
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const { data: listData, isLoading: listLoading, isError: listErrored, refetch: refetchList } = useQuery({
    queryKey: ["process-operations", "processes"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessRow[]>>("/api/process-operations/processes"),
  });
  const processes = listData?.data ?? [];

  // Apply ?process= once, when the list arrives and nothing is picked yet.
  // A value matching no process in the user's access is ignored.
  useEffect(() => {
    if (!processParam || active || processes.length === 0) return;
    const q = processParam.toLowerCase();
    const hit = processes.find((p) => p.processId === processParam)
      ?? processes.find((p) => (p.processCode ?? "").toLowerCase() === q)
      ?? processes.find((p) => p.processName.toLowerCase().includes(q));
    if (hit) setActive(hit.processId);
  }, [processParam, processes, active]);

  // Real branches only -- built from the processes actually in view, not
  // imagined, per this codebase's own rule that dropdown options come from
  // the observed domain. A process with no branch assignment (some
  // corporate/shared processes genuinely have none) surfaces as its own
  // honest "Unassigned" option rather than disappearing from the filter.
  const branchOptions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    for (const p of processes) {
      const id = p.branchId ?? "__unassigned";
      if (!seen.has(id)) {
        seen.set(id, {
          id,
          label: p.branchId ? `${p.branchName ?? "Unnamed branch"}${p.branchCode ? ` (${p.branchCode})` : ""}` : "Unassigned",
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [processes]);

  const branchScopedProcesses = useMemo(() => {
    if (branchFilter === "all") return processes;
    return processes.filter((p) => (p.branchId ?? "__unassigned") === branchFilter);
  }, [processes, branchFilter]);

  const processOptions: SearchableOption[] = useMemo(
    () => branchScopedProcesses.map((p) => ({
      value: p.processId,
      label: p.processName,
      hint: p.processCode ?? undefined,
    })),
    [branchScopedProcesses],
  );

  // Picking a branch that doesn't hold the currently active process must
  // clear that stale selection, not leave a process from a different branch
  // silently on screen -- same "clear the child when the parent changes"
  // rule this page's own manual-entry forms already follow.
  useEffect(() => {
    if (active && !branchScopedProcesses.some((p) => p.processId === active)) {
      setActive(null);
    }
  }, [branchFilter, branchScopedProcesses, active]);

  const current = active ?? branchScopedProcesses[0]?.processId ?? null;
  const currentProcess = processes.find((p) => p.processId === current) ?? null;
  // Must be after currentProcess is declared (TDZ guard)
  const hasSalesDashboard = !!(currentProcess && PROCESS_SALES_MAP[currentProcess.processCode ?? ""]);

  const { data: feedData } = useQuery({
    queryKey: ["process-operations", "feeds"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<FeedHealth>>("/api/process-operations/feeds"),
  });
  const feedHealth = feedData?.data;

  const { data: opsData, isLoading: opsLoading } = useQuery({
    queryKey: ["process-operations", "detail", current, period],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Operations>>(
      `/api/process-operations/${current}?period=${period}`),
    enabled: Boolean(current),
  });
  const ops = opsData?.data;

  const allMetrics = useMemo(
    () => (ops ? [...ops.sections.flatMap((s) => s.metrics), ...ops.ungrouped] : []), [ops]);
  const staleCount = allMetrics.filter((m) => m.staleDays !== null && ops && m.staleDays > ops.staleAfterDays).length;
  const noDataCount = allMetrics.filter((m) => m.value === null).length;

  const conv = ops?.sections.find((s) => s.key === "conversion");
  const qual = ops?.sections.find((s) => s.key === "quality");
  const risk = ops?.sections.find((s) => s.key === "risk");
  const charts = [
    conv ? <FunnelSnapshot key="fs" metrics={conv.metrics} /> : null,
    conv ? <FunnelChart key="f" metrics={conv.metrics} /> : null,
    qual ? <QualityRadar key="q" metrics={qual.metrics} /> : null,
    risk ? <RiskBars key="r" metrics={risk.metrics} /> : null,
  ].filter(Boolean);

  // ── Derived data for the GAS executive brief (reuse allMetrics) ───────────
  const allMetricsForBrief = allMetrics;
  const passCount = useMemo(() => allMetrics.filter((m) => targetStatus(m) === "pass").length, [allMetrics]);
  const failCount = useMemo(() => allMetrics.filter((m) => targetStatus(m) === "fail").length, [allMetrics]);
  const metricsWithData = useMemo(() => allMetrics.filter((m) => m.value !== null).length, [allMetrics]);

  // ── Action board items built from insights + feed health ──────────────────
  const { data: healthForBoard } = useQuery({
    queryKey: ["process-operations", "business-health", current],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessBusinessHealth>>(
      `/api/process-operations/${current}/business-health`),
    enabled: Boolean(current),
    staleTime: 60_000,
  });
  const actionItems = useMemo(() => {
    const items: Array<{ severity: "critical" | "warning" | "positive"; title: string; body: string }> = [];
    if (ops) {
      const insights = deriveInsights(ops, healthForBoard?.data);
      insights.slice(0, 4).forEach((ins) => {
        items.push({ severity: ins.severity === "critical" ? "critical" : "warning", title: ins.what, body: ins.why });
      });
    }
    if (feedHealth) {
      const dead = feedHealth.feeds.filter((f) => f.state === "stopped").length;
      if (dead > 0) items.push({ severity: "warning", title: `${dead} metric feed${dead === 1 ? "" : "s"} stopped`, body: `No data received for over ${feedHealth.stoppedAfterDays} days — tiles may show stale values.` });
    }
    if (items.length === 0 && ops) {
      items.push({ severity: "positive", title: "All systems operating", body: "No target misses or feed issues detected for this process." });
    }
    return items;
  }, [ops, feedHealth, healthForBoard]);

  const periodLabel = ops
    ? (ops.period === "trend" ? `${ops.windowDays}d trend` : formatPeriodRange(ops.periodFrom, ops.periodTo) ?? ops.period)
    : PERIODS.find((p) => p.key === period)?.label ?? period;

  return (
    <DashboardLayout>
      {/* Full-page background matching GAS radial gradient */}
      <div style={{ minHeight: "100vh", background: "radial-gradient(circle at 5% 2%,rgba(47,111,237,.09),transparent 24%),radial-gradient(circle at 96% 3%,rgba(15,159,143,.07),transparent 25%),linear-gradient(180deg,#f1f5fa 0,#f7f9fc 310px,#f4f7fa 100%)" }}>

        {/* ── Sticky shell: accent line + topbar ─────────────────────────── */}
        <div style={{ position: "sticky", top: 0, zIndex: 100, background: "#fff", boxShadow: "0 5px 22px rgba(10,34,55,.12)" }}>
          {/* Rainbow accent line */}
          <div style={{ height: 4, background: GAS_ACCENT }} />

          {/* Topbar */}
          <div style={{ minHeight: 72, padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, color: "#fff", background: GAS_TOPBAR, position: "relative", overflow: "hidden" }}>
            <div aria-hidden style={{ position: "absolute", width: 260, height: 260, borderRadius: "50%", right: -80, top: -170, background: "linear-gradient(135deg,rgba(255,255,255,.13),rgba(255,255,255,0))", pointerEvents: "none" }} />

            {/* Brand */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 1, minWidth: 0 }}>
              <div>
                <div style={{ color: "#8dd9eb", fontSize: 9, fontWeight: 900, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 3 }}>MAS PeopleOS</div>
                <h1 style={{ margin: 0, fontSize: 20, letterSpacing: .25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textShadow: "0 3px 12px rgba(0,0,0,.24)", display: "flex", alignItems: "center", gap: 8 }}>
                  <Activity size={18} />Process Operations
                </h1>
                <p style={{ margin: "3px 0 0", color: "#c9dceb", fontWeight: 650, fontSize: 11 }}>
                  Every metric a process is measured on — click any tile to drill in
                </p>
              </div>
            </div>

            {/* Right: filters + period + live pill */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, position: "relative", zIndex: 1, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {/* Branch filter */}
              {processes.length > 0 && (
                <div style={{ minWidth: 210 }}>
                  <label style={{ display: "block", marginBottom: 4, color: "#d6e7f7", fontSize: 10, textTransform: "uppercase", letterSpacing: .4, fontWeight: 950 }}>Branch</label>
                  <SearchableSelect
                    aria-label="Filter by branch"
                    options={[{ value: "all", label: "All branches", hint: `${processes.length}` }, ...branchOptions.map((b) => ({
                      value: b.id, label: b.label,
                      hint: `${processes.filter((p) => (p.branchId ?? "__unassigned") === b.id).length}`,
                    }))]}
                    value={branchFilter}
                    onChange={setBranchFilter}
                    placeholder="All branches"
                    searchPlaceholder="Search branches…"
                  />
                </div>
              )}
              {/* Process filter */}
              {processes.length > 0 && (
                <div style={{ minWidth: 320 }}>
                  <label style={{ display: "block", marginBottom: 4, color: "#d6e7f7", fontSize: 10, textTransform: "uppercase", letterSpacing: .4, fontWeight: 950 }}>Process</label>
                  <SearchableSelect
                    aria-label="Select a process"
                    options={processOptions}
                    value={current ?? ""}
                    onChange={(id) => setActive(id)}
                    placeholder={branchScopedProcesses.length ? "Search processes…" : "No process in this branch"}
                    searchPlaceholder="Type a process name or code…"
                    emptyText="No process matches that search."
                    disabled={!branchScopedProcesses.length}
                  />
                </div>
              )}
              {/* Period tabs */}
              <div>
                <label style={{ display: "block", marginBottom: 4, color: "#d6e7f7", fontSize: 10, textTransform: "uppercase", letterSpacing: .4, fontWeight: 950 }}>Period</label>
                <div role="tablist" aria-label="Reporting period" style={{ display: "inline-flex", borderRadius: 10, background: "rgba(255,255,255,.10)", padding: 3 }}>
                  {PERIODS.map((p) => (
                    <button key={p.key} type="button" role="tab" aria-selected={period === p.key}
                      title={p.caption} onClick={() => setPeriod(p.key)}
                      style={{
                        cursor: "pointer", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 900,
                        border: 0, transition: "background .15s,color .15s",
                        background: period === p.key ? "#fff" : "transparent",
                        color: period === p.key ? "#183b59" : "#d0e8f5",
                        boxShadow: period === p.key ? "0 3px 8px rgba(0,0,0,.15)" : "none",
                      }}
                      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1">
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* View toggle: KPI Metrics / Sales Dashboard / Live Dashboard */}
              <div style={{ display: "inline-flex", borderRadius: 10, background: "rgba(255,255,255,.10)", padding: 3, alignSelf: "flex-end" }}>
                <button type="button" onClick={() => setView("kpi")}
                  style={{ cursor: "pointer", borderRadius: 8, padding: "6px 11px", fontSize: 11, fontWeight: 900, border: 0, transition: "background .15s,color .15s", background: view === "kpi" ? "#fff" : "transparent", color: view === "kpi" ? "#183b59" : "#d0e8f5", boxShadow: view === "kpi" ? "0 3px 8px rgba(0,0,0,.15)" : "none" }}>
                  KPI Metrics
                </button>
                {hasSalesDashboard && (
                  <button type="button" onClick={() => setView("sales")}
                    style={{ cursor: "pointer", borderRadius: 8, padding: "6px 11px", fontSize: 11, fontWeight: 900, border: 0, transition: "background .15s,color .15s", background: view === "sales" ? "#e89b19" : "transparent", color: view === "sales" ? "#fff" : "#d0e8f5", boxShadow: view === "sales" ? "0 3px 8px rgba(0,0,0,.20)" : "none" }}>
                    Sales Dashboard
                  </button>
                )}
                <button type="button" onClick={() => setView("live")}
                  style={{ cursor: "pointer", borderRadius: 8, padding: "6px 11px", fontSize: 11, fontWeight: 900, border: 0, transition: "background .15s,color .15s", background: view === "live" ? "#10b8d4" : "transparent", color: view === "live" ? "#fff" : "#d0e8f5", boxShadow: view === "live" ? "0 3px 8px rgba(0,0,0,.20)" : "none" }}>
                  {isOnfidoProcess(currentProcess?.processName) ? "Onfido Dashboard" : "Live Dashboard"}
                </button>
              </div>
              {/* Live pill */}
              <div style={{ height: 34, padding: "0 12px", border: "1px solid rgba(255,255,255,.19)", borderRadius: 999, background: "rgba(255,255,255,.09)", display: "flex", alignItems: "center", gap: 8, color: "#e9f8f4", fontWeight: 850, fontSize: 11, whiteSpace: "nowrap", alignSelf: "flex-end" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#45e59b", boxShadow: "0 0 0 5px rgba(69,229,155,.13)", animation: "pulse 2.2s ease-in-out infinite" }} />
                LIVE
              </div>
              {/* Add reading button */}
              <button type="button" onClick={() => setManualEntryOpen(true)}
                title="Type in today's number for a metric no automated feed reaches"
                style={{ height: 34, padding: "0 12px", border: "1px solid rgba(255,255,255,.24)", borderRadius: 10, background: "linear-gradient(135deg,rgba(255,255,255,.18),rgba(255,255,255,.08))", color: "#fff", display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 10, fontWeight: 950, whiteSpace: "nowrap", letterSpacing: .25, boxShadow: "0 5px 14px rgba(0,0,0,.16)", transition: ".18s", alignSelf: "flex-end" }}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <PenLine size={13} />Add reading
              </button>
            </div>
          </div>
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main style={{ maxWidth: 1880, margin: "auto", padding: "18px 20px 38px" }}>

          {/* Loading / error / empty states */}
          {listLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
              <Loader2 className="h-4 w-4 animate-spin" />Loading processes…
            </div>
          ) : listErrored ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-6 text-sm text-red-700 dark:text-red-400 shadow-sm flex items-center justify-between gap-3">
              <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />Could not reach the server. This is not "no processes" — the request itself failed.</span>
              <button type="button" onClick={() => refetchList()} className="shrink-0 rounded-lg bg-red-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-red-700 transition cursor-pointer focus:outline-none">Retry</button>
            </div>
          ) : processes.length === 0 ? (
            <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">No process in your access is currently reporting a metric.</div>
          ) : !current ? (
            <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500 shadow-sm">Select a process above to view its metrics.</div>
          ) : view === "sales" && currentProcess ? (
            /* ── Sales Dashboard view ────────────────────────────────────────── */
            <ProcessSalesDashboardView
              processCode={currentProcess.processCode ?? ""}
              processName={currentProcess.processName}
            />
          ) : view === "live" && isOnfidoProcess(currentProcess?.processName) ? (
            /* ── Onfido: its own dashboard (upload-fed, not dialler) ───────── */
            <Suspense fallback={
              <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
                <Loader2 className="h-4 w-4 animate-spin" />Loading Onfido dashboard…
              </div>
            }>
              <OnfidoProcessDashboard embedded />
            </Suspense>
          ) : view === "live" ? (
            /* ── Live Dashboard (Dialler) view ─────────────────────────────── */
            <div>
              <DiallerLivePanel processName={currentProcess?.processName ?? ""} />
            </div>
          ) : (
            <div className="space-y-4">

              {/* ── Row 0: CEO KPI strip — financial + quality + workforce ── */}
              {ops && currentProcess && (() => {
                const h = healthForBoard?.data;
                const totalTargeted = failCount + passCount;
                const qualityPct = totalTargeted > 0 ? Math.round((passCount / totalTargeted) * 100) : null;
                const hcGap = h?.headcount?.gap ?? null;
                const revPerAgent = (h?.finance?.revenue && (h?.headcount?.activeHc ?? 0) > 0)
                  ? Math.round(h.finance.revenue / h.headcount.activeHc) : null;
                const fmtL = (v: number | null): string => {
                  if (v === null) return "—";
                  const abs = Math.abs(v); const s = v < 0 ? "-" : "";
                  if (abs >= 10_000_000) return `${s}₹${(abs / 10_000_000).toFixed(1)}Cr`;
                  if (abs >= 100_000) return `${s}₹${(abs / 100_000).toFixed(1)}L`;
                  if (abs >= 1000) return `${s}₹${(abs / 1000).toFixed(0)}K`;
                  return `${s}₹${abs.toLocaleString("en-IN")}`;
                };
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(155px,1fr))", gap: 10 }}>
                    <LiveKpiCard label="Revenue"
                      value={h?.finance?.available ? fmtL(h.finance.revenue) : "—"}
                      sub={h?.finance?.revenueStatus === "accounting_fallback" ? "accounting fallback" : "this month"}
                      color="linear-gradient(135deg,#1e3a5f,#2f6fed)"
                      onClick={() => setSummaryDrill("ceo_revenue")}
                      trend={!h?.finance?.available ? "action" : h?.finance?.revenue && h.finance.revenue > 0 ? "positive" : "action"}
                      trendLabel={!h?.finance?.available ? "Data gap" : h?.finance?.revenueStatus === "accounting_fallback" ? "Fallback" : "On track"} />
                    <LiveKpiCard label="Operating %"
                      value={h?.finance?.agentSalaryIsRealThisMonth && h.finance.operatingProfitPct !== null
                        ? `${h.finance.operatingProfitPct.toFixed(1)}%` : "—"}
                      sub={!h?.finance?.agentSalaryIsRealThisMonth ? "payroll pending" : "EBIT ÷ Revenue"}
                      color={h?.finance?.agentSalaryIsRealThisMonth && h.finance.operatingProfitPct !== null
                        ? (h.finance.operatingProfitPct >= 0 ? "linear-gradient(135deg,#047857,#10b981)" : "linear-gradient(135deg,#be123c,#f43f5e)")
                        : "linear-gradient(135deg,#334155,#64748b)"}
                      onClick={() => setSummaryDrill("ceo_op_pct")}
                      trend={!h?.finance?.agentSalaryIsRealThisMonth || h?.finance?.operatingProfitPct === null ? "action" : h.finance.operatingProfitPct >= 12 ? "positive" : h.finance.operatingProfitPct >= 0 ? "action" : "negative"}
                      trendLabel={!h?.finance?.agentSalaryIsRealThisMonth ? "Payroll pending" : h?.finance?.operatingProfitPct === null ? "No data" : h.finance.operatingProfitPct >= 12 ? "Healthy" : h.finance.operatingProfitPct >= 0 ? "Below target" : "Loss"} />
                    <LiveKpiCard label="Quality Score"
                      value={qualityPct !== null ? `${qualityPct}%` : "—"}
                      sub={`${passCount} on target · ${failCount} failing`}
                      color={qualityPct !== null
                        ? (qualityPct >= 80 ? "linear-gradient(135deg,#047857,#10b981)"
                          : qualityPct >= 55 ? "linear-gradient(135deg,#b45309,#f59e0b)"
                          : "linear-gradient(135deg,#be123c,#f43f5e)")
                        : "linear-gradient(135deg,#0369a1,#06b6d4)"}
                      onClick={() => setSummaryDrill("ceo_quality")}
                      trend={qualityPct === null ? "action" : qualityPct >= 80 ? "positive" : qualityPct >= 55 ? "action" : "negative"}
                      trendLabel={qualityPct === null ? "No data" : qualityPct >= 80 ? "On target" : qualityPct >= 55 ? "Action req." : "Critical"} />
                    <LiveKpiCard label="HC vs Mandate"
                      value={hcGap !== null ? (hcGap >= 0 ? `+${hcGap}` : String(hcGap)) : `${ops.headcount} HC`}
                      sub={hcGap !== null ? (hcGap >= 0 ? "above mandate" : "below mandate") : "no mandate set"}
                      color={hcGap !== null
                        ? (hcGap >= 0 ? "linear-gradient(135deg,#047857,#10b981)" : "linear-gradient(135deg,#be123c,#f43f5e)")
                        : "linear-gradient(135deg,#1e3a5f,#2f6fed)"}
                      onClick={() => setSummaryDrill("ceo_hc")}
                      trend={hcGap === null ? "action" : hcGap >= 0 ? "positive" : "negative"}
                      trendLabel={hcGap === null ? "No mandate" : hcGap >= 0 ? "Fully staffed" : "Understaffed"} />
                    <LiveKpiCard label="Rev / Agent"
                      value={fmtL(revPerAgent)}
                      sub="monthly productivity"
                      color="linear-gradient(135deg,#5b21b6,#7c5ce5)"
                      onClick={() => setSummaryDrill("ceo_rev_agent")}
                      trend={revPerAgent === null ? "action" : "positive"}
                      trendLabel={revPerAgent === null ? "No data" : "Per seat"} />
                  </div>
                );
              })()}

              {/* ── Row 1: Executive Brief + Action Board ─────────────────── */}
              {ops && currentProcess && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,.9fr)", gap: 14, alignItems: "stretch" }}>
                  <GasExecutiveBrief
                    processName={currentProcess.processName}
                    headcount={ops.headcount}
                    metrics={allMetricsForBrief.length}
                    metricsWithData={metricsWithData}
                    staleCount={staleCount}
                    failCount={failCount}
                    passCount={passCount}
                    periodLabel={periodLabel ?? period}
                    health={healthForBoard?.data}
                  />
                  <GasActionBoard items={actionItems} />
                </div>
              )}

              {/* ── Section nav — sticky below topbar for instant KPI jumping ── */}
              {ops && ops.sections.length > 0 && (
                <div style={{ position: "sticky", top: 72, zIndex: 90, background: "#f1f5fa", paddingTop: 4, paddingBottom: 6, marginLeft: -20, marginRight: -20, paddingLeft: 20, paddingRight: 20, borderBottom: "1px solid #dce4ed", boxShadow: "0 4px 12px rgba(16,35,57,.06)" }}>
                  <SectionOverviewStrip
                    sections={ops.sections}
                    ungrouped={ops.ungrouped}
                    staleAfterDays={ops.staleAfterDays}
                    activeSectionKey={activeSectionKey}
                    onSectionClick={(key) => {
                      setActiveSectionKey(prev => prev === key ? null : key);
                      const el = sectionRefs.current[key];
                      if (el) { setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
                    }}
                  />
                </div>
              )}

              {/* ── Row 2: Feed health banners ────────────────────────────── */}
              {feedHealth && <StoppedFeeds health={feedHealth} />}
              {feedHealth && (
                <NeverReportedBanner groups={feedHealth.neverReported}
                  currentProcessId={current} currentProcessName={currentProcess?.processName ?? null} />
              )}

              {/* ── Row 3: Ops loading state ──────────────────────────────── */}
              {opsLoading || !ops ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading metrics…
                </div>
              ) : (
                <div className="space-y-4">
                  {ops.headcount === 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>This process has no active employees — a headcount-based metric below counts over nobody.</span>
                    </div>
                  )}

                  {/* ── ZONE 1: Business Context (CEO reads first) ──────────── */}
                  {current && <LivePanel title="Business Health"><BusinessHealthPanel processId={current} onOpen={setSummaryDrill} /></LivePanel>}

                  {/* ── ZONE 2: Root Cause — why quality is where it is ─────── */}
                  {current && <LivePanel title="Root Cause vs. Workforce"><WorkforceCorrelationPanel processId={current} period={period} /></LivePanel>}

                  {/* ── ZONE 3: Quality Overview ────────────────────────────── */}
                  {current && ops && <LivePanel title="Performance Distribution"><ProcessCardInsightsPanel processId={current} ops={ops} onDrill={setDrill} /></LivePanel>}

                  {/* Voice of the customer — what clients/customers are saying */}
                  {current && <LivePanel title="Voice of Customer"><VoiceOfCustomerPanel processId={current} period={period} /></LivePanel>}

                  {/* Conversion funnel + quality trend charts */}
                  {charts.length > 0 && (
                    <LivePanel title="Trend Charts" sub={`${charts.length}`}>
                      <div className="grid gap-3 grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">{charts}</div>
                    </LivePanel>
                  )}

                  {/* ── Zone divider: executive summary above / operational detail below ── */}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2 select-none">
                      Operations Detail — Managers &amp; QA
                    </span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  </div>

                  {/* ── ZONE 4: Quality Deep-Dives (operations managers) ─────── */}
                  {current && <LivePanel title="Fatal Calls Analysis"><FatalCallsPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Critical Signals"><CriticalSignalsPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Customer Risk"><CustomerRiskCardsPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Agent Audit Summary"><AgentAuditSummaryPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Score Components"><ScoreComponentsPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="ACHT Categorization"><AchtCategorizationPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Daily Quality Trend"><DailyQualityTrendPanel processId={current} /></LivePanel>}

                  {/* ── Zone divider: quality deep-dives above / analyst drill-downs below ── */}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2 select-none">
                      Analyst Drill-Downs
                    </span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  </div>

                  {/* ── ZONE 5: Analyst Drill-Downs (QA / Process analysts) ─── */}
                  {current && <LivePanel title="Fatal Analysis"><FatalAnalysisPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Scenario Distribution"><ScenarioDistributionPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Day-wise Scenario Audit"><DayWiseScenarioAuditPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Repeat Analysis"><RepeatAnalysisPanel processId={current} period={period} /></LivePanel>}
                  {current && <LivePanel title="Fraud Call Detection"><FraudCallPanel processId={current} period={period} /></LivePanel>}

                  {/* ── KPI Sections header ──────────────────────────────── */}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2 select-none">
                      KPI Metric Sections
                    </span>
                    <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  </div>

                  {/* ── Enhanced metric sections ──────────────────────────── */}
                  {[...ops.sections, ...(ops.ungrouped.length
                    ? [{ key: "other", title: "Other metrics", blurb: "Wired for this process but not yet placed in a section.", metrics: ops.ungrouped }]
                    : [])].map((s) => (
                    <EnhancedSectionBlock
                      key={s.key}
                      s={s as Section & { key: string }}
                      staleAfterDays={ops.staleAfterDays}
                      period={period}
                      onOpenDrill={setDrill}
                      isActive={activeSectionKey === s.key}
                      onRef={(el) => { sectionRefs.current[s.key] = el; }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {current && (
            <DrilldownDrawer processId={current} metricKey={drill} period={period} onClose={() => setDrill(null)} />
          )}
          <SummaryTileDrillDrawer
            metricKey={summaryDrill}
            health={healthForBoard?.data}
            passCount={passCount}
            failCount={failCount}
            onClose={() => setSummaryDrill(null)}
          />
          <ManualEntryDrawer
            open={manualEntryOpen}
            processId={current}
            processName={ops?.processName ?? processes.find((p) => p.processId === current)?.processName ?? null}
            onClose={() => setManualEntryOpen(false)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ["process-operations", "detail", current] });
              qc.invalidateQueries({ queryKey: ["process-operations", "processes"] });
              qc.invalidateQueries({ queryKey: ["process-operations", "drilldown"] });
              qc.invalidateQueries({ queryKey: ["process-operations", "raw-rows"] });
            }}
          />

          {/* Pulse animation for live dot */}
          <style>{`@keyframes pulse{50%{box-shadow:0 0 0 8px rgba(69,229,155,0)}}`}</style>
        </main>
      </div>
    </DashboardLayout>
  );
}
