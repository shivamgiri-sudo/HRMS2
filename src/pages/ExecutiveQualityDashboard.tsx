/**
 * Executive Quality Dashboard
 * Org-level quality summary for executive/management roles, plus the detailed analytics
 * tabs (Drill-Down, Heatmap, Agent Risk, Inbound, CLAP VOC, Sales & Funnel, AI & ROI) moved
 * here from QualityDashboard.tsx on 2026-08-17 so that page stays a fast org-level summary.
 *
 * This page was dead code until 2026-08-17: its route (`/quality/executive`) had redirected
 * to `/quality-dashboard` since the 2026-08-04 unified-dashboards consolidation (see
 * docs/superpowers/specs/2026-08-04-unified-quality-operations-dashboards-design.md), which
 * explicitly retired this page as a near-duplicate. It is revived here specifically to hold
 * the moved analytics tabs, at the user's explicit choice after being told that history.
 *
 * Auth Gate: Route-level Gate pageCode="QUALITY_EXECUTIVE" is now the real access boundary
 * (widened by migration 1141 to match everyone who can already reach /quality-dashboard).
 * The Executive Summary section below keeps its own narrower ALLOWED_ROLES gate, unchanged
 * from before — only the page-level "you may not even open this route" gate changed; nobody
 * who previously saw the Executive Summary loses it, and nobody who could see the Drill-Down/
 * Heatmap/etc. tabs on the old unified page loses those either.
 *
 * Layout: Header → KPI Hero → Trends → Top/Bottom Performers → Process Scorecard → Benchmarks
 *         → Detailed Analytics (Drill-Down / Heatmap / Agent Risk / Inbound / CLAP VOC / Sales & Funnel / AI & ROI)
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole, useWorkforceAccess } from "@/hooks/useUserRole";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Award,
  AlertCircle,
  Loader2,
  BarChart2,
  PhoneCall,
  ChevronDown,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  DrillDownDashboardShell,
  type DrillLevel,
  type DrillLevelResponse,
  type DrillNode,
} from "@/components/dashboards/DrillDownDashboardShell";
import { DashboardInsights, computeQualityInsights } from "@/components/dashboards/DashboardInsights";
import {
  QualityFilterBar, QualityHeatmapPanel, AgentRiskTable,
  InboundQualityPanel, ClapVocPanel, SalesFunnelPanel, AiInsightsPanel,
  today, firstOfMonth,
  type ClientRow,
} from "@/components/quality-dashboard/v2";

interface ExecutiveQualityData {
  metrics: {
    overall_quality_score: number;
    target_quality_score: number;
    gap_pct: number;
    status: string;
    trend_7day: { direction: string; change_pct: number };
    trend_30day: { direction: string; change_pct: number };
  };
  top_performers: Array<{ rank: number; agent_code: string; agent_name: string; quality_score: number; calls_handled: number; process: string }>;
  bottom_performers: Array<{ rank: number; agent_code: string; agent_name: string; quality_score: number; calls_handled: number; process: string }>;
  process_performance: Array<{ process: string; avg_quality: number; agent_count: number; calls_handled: number; status: string }>;
  risk_summary: { critical_agents_count: number; at_risk_agents_count: number; coaching_priority_count: number };
  org_benchmarks: { avg_quality: number; median_quality: number; std_deviation: number };
}

function qualityColor(score: number): string {
  if (score >= 80) return "text-green-600 font-semibold";
  if (score >= 70) return "text-yellow-600 font-semibold";
  return "text-red-600 font-semibold";
}

function statusBadge(status: string): string {
  if (status === "On Track") return "bg-green-100 text-green-700 border-green-200";
  if (status === "At Risk") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-red-100 text-red-700 border-red-200";
}

const ALLOWED_ROLES = ["super_admin", "admin", "ceo", "coo"] as const;

function toISODate(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return toISODate(d); }

// ─── Drill-down / analyst-detail infrastructure — moved from QualityDashboard.tsx.
//     qualityTone is duplicated there too (still needed by its SelfQualityScorecard). ──────

function qualityTone(pct: number | null): "good" | "warn" | "bad" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 70) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}

interface QualityApiNode {
  id: string;
  name: string;
  secondaryLabel: string | null;
  agentCount: number;
  callsAudited: number;
  avgQualityPct: number | null;
  hasChildren: boolean;
}

interface QualityApiResponse {
  level: DrillLevel;
  parentId: string | null;
  parentLabel: string | null;
  nodes: QualityApiNode[];
  rangeDays: number;
  asOf: string;
}

function toDrillNode(n: QualityApiNode): DrillNode {
  return {
    id: n.id,
    name: n.name,
    secondaryLabel: n.secondaryLabel,
    hasChildren: n.hasChildren,
    metrics: [
      { label: "Agents",       value: String(n.agentCount) },
      { label: "Calls audited", value: n.callsAudited.toLocaleString() },
      { label: "Avg quality",  value: n.avgQualityPct !== null ? `${n.avgQualityPct}%` : "—", tone: qualityTone(n.avgQualityPct) },
    ],
  };
}

async function fetchQualityLevel(level: DrillLevel, parentId: string | null): Promise<DrillLevelResponse> {
  const params = new URLSearchParams({ level });
  if (parentId) params.set("id", parentId);
  const res = await hrmsApi.get<{ success: boolean; data: QualityApiResponse }>(
    `/api/quality-dashboard-v2/summary?${params.toString()}`,
  );
  return { ...res.data, nodes: res.data.nodes.map(toDrillNode), raw: res.data.nodes };
}

interface AnalystCall {
  id: number;
  callDate: string;
  client: string | null;
  qualityPct: number | null;
  totalScore: number | null;
  maxScore: number | null;
  areasForImprovement: string | null;
  params?: {
    callOpen: number | null;
    professionalism: number | null;
    activeListening: number | null;
    callClosure: number | null;
    accuracy: number | null;
  };
}

interface AnalystCallsResponse {
  employee: { id: string; fullName: string; employeeCode: string } | null;
  calls: AnalystCall[];
}

const PARAM_LABELS: [keyof NonNullable<AnalystCall["params"]>, string][] = [
  ["callOpen",       "Call Opening"],
  ["professionalism","Professionalism"],
  ["activeListening","Active Listening"],
  ["callClosure",    "Call Closure"],
  ["accuracy",       "Accuracy"],
];

function CallAuditRow({ c }: { c: AnalystCall }) {
  const [expanded, setExpanded] = useState(false);
  const tone = qualityTone(c.qualityPct);
  const scoreColor =
    tone === "good" ? "text-emerald-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "bad"  ? "text-rose-600" : "text-slate-500";

  const hasParams = c.params && Object.values(c.params).some((v) => v !== null);

  return (
    <Card className="overflow-hidden border-border/60">
      <button
        onClick={() => hasParams && setExpanded((x) => !x)}
        className={`w-full text-left ${hasParams ? "cursor-pointer hover:bg-slate-50" : "cursor-default"}`}
      >
        <CardContent className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">
              {new Date(c.callDate).toLocaleString(undefined, {
                day: "numeric", month: "short", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </p>
            {c.client && <p className="text-[11px] text-slate-400">{c.client}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-right">
              <p className={`text-base font-black tabular-nums ${scoreColor}`}>
                {c.qualityPct !== null ? `${c.qualityPct}%` : "—"}
              </p>
              {c.totalScore !== null && c.maxScore !== null && (
                <p className="text-[10px] text-slate-400">{c.totalScore}/{c.maxScore}</p>
              )}
            </div>
            {hasParams && (
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
            )}
          </div>
        </CardContent>
      </button>

      {expanded && hasParams && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 pb-4 pt-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Parameter Scores</p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {PARAM_LABELS.map(([key, label]) => {
              const val = c.params![key];
              const passed = val === 1 || val === null ? val === 1 : Number(val) === 1;
              return (
                <div key={key} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <span className="text-xs text-slate-600">{label}</span>
                  {val === null ? (
                    <span className="text-[10px] text-slate-400">N/A</span>
                  ) : passed ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Pass
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
                      <XCircle className="h-3.5 w-3.5" /> Fail
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {c.areasForImprovement && (
            <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
              <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600">Areas for Improvement</p>
              <p className="text-xs leading-relaxed text-slate-700">{c.areasForImprovement}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AnalystDetailSheet({ node, open, onOpenChange }: { node: DrillNode | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["quality-dashboard-v2-analyst", node?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: AnalystCallsResponse }>(
        `/api/quality-dashboard-v2/analyst/${node!.id}/calls`,
      );
      return res.data;
    },
    enabled: !!node && open,
  });

  const scoredCalls = (data?.calls ?? []).filter((c) => c.qualityPct !== null);

  const chartData = scoredCalls
    .slice()
    .reverse()
    .map((c) => ({ date: new Date(c.callDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }), quality: c.qualityPct }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data?.employee?.fullName ?? node?.name ?? "Analyst"}</SheetTitle>
          <SheetDescription>
            {scoredCalls.length > 0
              ? `${scoredCalls.length} audited call${scoredCalls.length !== 1 ? "s" : ""} — click any row for parameter detail`
              : "Individually audited calls"}
          </SheetDescription>
        </SheetHeader>

        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && scoredCalls.length === 0 && (
          <div className="mt-6">
            <EmptyState title="No audited calls in range" description="This analyst has no scored calls in the selected window." />
          </div>
        )}

        {!isLoading && chartData.length > 1 && (
          <div className="mt-6 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={10} />
                <YAxis fontSize={10} domain={[0, 100]} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="quality" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {scoredCalls.slice(0, 100).map((c) => (
            <CallAuditRow key={c.id} c={c} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Detailed Analytics — the 7 tabs moved from QualityDashboard.tsx 2026-08-17. Owns its
//     own filter state; it can't share QualityDashboard's, since that's a different page. ──

function DetailedAnalyticsSection() {
  const { hasAnyRole } = useWorkforceAccess();
  const canViewSalesRoi = hasAnyRole(
    "super_admin", "admin", "ceo", "process_manager", "operations_manager",
  );

  const [selectedAnalyst, setSelectedAnalyst] = useState<DrillNode | null>(null);
  const [levelData, setLevelData] = useState<DrillLevelResponse | null>(null);

  const [from, setFrom]               = useState(firstOfMonth());
  const [to, setTo]                   = useState(today());
  const [clientId, setClientId]       = useState("");
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [refreshKey, setRefreshKey]   = useState(0);

  const qKey = [from, to, clientId, granularity, refreshKey];

  const clientsQ = useQuery<ClientRow[]>({
    queryKey: ["qdv2-clients-executive", from, to],
    queryFn: () =>
      hrmsApi
        .get<{ clients: ClientRow[] }>(`/api/quality-dashboard/clients?from=${from}&to=${to}`)
        .then((r) => r.clients),
    staleTime: 10 * 60 * 1000,
  });

  const rawNodes = (levelData?.raw as QualityApiNode[] | undefined) ?? [];
  const levelNoun =
    levelData
      ? ({ branch: "branch", process: "process", team: "team", analyst: "analyst" } as const)[levelData.level]
      : "branch";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Detailed Analytics</h2>
        <p className="text-sm text-slate-500">
          Drill-down, heatmap, agent risk, inbound quality, CLAP VOC, and (for eligible roles) sales &amp; ROI.
        </p>
      </div>

      <QualityFilterBar
        from={from}
        to={to}
        clientId={clientId}
        granularity={granularity}
        clients={clientsQ.data ?? []}
        onFrom={setFrom}
        onTo={setTo}
        onClient={setClientId}
        onGranularity={setGranularity}
        onRefresh={() => setRefreshKey((k) => k + 1)}
      />

      <Tabs defaultValue="drilldown" className="w-full">
        <TabsList className="mb-4 flex h-auto flex-wrap gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
          {[
            { value: "drilldown", label: "Drill-Down" },
            { value: "heatmap",   label: "Heatmap" },
            { value: "agentrisk", label: "Agent Risk" },
            { value: "inbound",   label: "Inbound" },
            { value: "voc",       label: "CLAP VOC" },
            ...(canViewSalesRoi ? [
              { value: "sales",  label: "Sales & Funnel" },
              { value: "ai",     label: "AI & ROI" },
            ] : []),
          ].map(({ value, label }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Drill-down tab */}
        <TabsContent value="drilldown">
          <div className="space-y-4">
            {rawNodes.length > 0 && (
              <DashboardInsights data={computeQualityInsights(rawNodes, levelNoun)} />
            )}
            <DrillDownDashboardShell
              queryKeyPrefix="quality-dashboard-v2"
              accentClassName="from-emerald-500/10 via-primary/5 to-transparent"
              fetchLevel={fetchQualityLevel}
              onSelectAnalyst={setSelectedAnalyst}
              onData={setLevelData}
              headerRight={
                <Badge variant="outline" className="gap-1.5">
                  <PhoneCall className="h-3 w-3" /> Live call audits <TrendingUp className="h-3 w-3" />
                </Badge>
              }
            />
          </div>
        </TabsContent>

        <TabsContent value="heatmap">
          <QualityHeatmapPanel from={from} to={to} queryKey={qKey} />
        </TabsContent>

        <TabsContent value="agentrisk">
          <AgentRiskTable from={from} to={to} queryKey={qKey} />
        </TabsContent>

        <TabsContent value="inbound">
          <InboundQualityPanel from={from} to={to} queryKey={qKey} />
        </TabsContent>

        <TabsContent value="voc">
          <ClapVocPanel from={from} to={to} clientId={clientId} queryKey={qKey} />
        </TabsContent>

        {canViewSalesRoi && (
          <>
            <TabsContent value="sales">
              <SalesFunnelPanel from={from} to={to} clientId={clientId} queryKey={qKey} />
            </TabsContent>

            <TabsContent value="ai">
              <AiInsightsPanel from={from} to={to} queryKey={qKey} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <AnalystDetailSheet
        node={selectedAnalyst}
        open={!!selectedAnalyst}
        onOpenChange={(v) => !v && setSelectedAnalyst(null)}
      />
    </div>
  );
}

export default function ExecutiveQualityDashboard() {
  const { user } = useAuth();
  const [daysBack, setDaysBack] = useState<7 | 30>(30);
  const [fromDate, setFromDate] = useState(() => daysAgo(30));
  const [toDate, setToDate] = useState(() => toISODate(new Date()));
  const [useCustomRange, setUseCustomRange] = useState(false);

  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const isAllowed =
    roleData?.roleKeys?.some((r: string) =>
      (ALLOWED_ROLES as readonly string[]).includes(r)
    ) ?? false;

  const queryParams = useCustomRange
    ? `fromDate=${fromDate}&toDate=${toDate}`
    : `daysBack=${daysBack}`;

  const { data, isLoading, isError, error } = useQuery<ExecutiveQualityData>({
    queryKey: ["executive-quality-summary", queryParams],
    queryFn: () =>
      hrmsApi.get(`/api/executive/quality-summary?${queryParams}`).then((r) => r.data),
    enabled: !!user && isAllowed,
  });

  // Auth gate
  if (!user) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </DashboardLayout>
    );
  }

  // Role loading
  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </DashboardLayout>
    );
  }

  // Loading skeleton (executive summary only — the analytics tabs load independently below)
  const Skeleton = ({ h = "h-32" }: { h?: string }) => (
    <Card className="p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-5 bg-slate-200 rounded w-1/3" />
        <div className={`${h} bg-slate-200 rounded`} />
      </div>
    </Card>
  );

  const gapPositive = data ? data.metrics.gap_pct <= 0 : false; // gap_pct = target - current; negative means above target

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-8">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-2">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <BarChart2 className="h-7 w-7 text-slate-600" />
              Executive Quality Dashboard
            </h1>
            <p className="text-slate-500 mt-1 text-sm">
              Org-wide quality KPIs, performer rankings, process health and detailed analytics
            </p>
          </div>
          {/* Period selector — only meaningful for the Executive Summary section below */}
          {isAllowed && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500 mr-1">Summary period:</span>
              {([7, 30] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => { setDaysBack(d); setUseCustomRange(false); }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    !useCustomRange && daysBack === d
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
                  }`}
                >
                  {d}d
                </button>
              ))}
              <button
                onClick={() => setUseCustomRange(true)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  useCustomRange
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
                }`}
              >
                Custom
              </button>
              {useCustomRange && (
                <>
                  <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm" />
                  <span className="text-slate-400 text-sm">—</span>
                  <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm" />
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Executive Summary — restricted to ALLOWED_ROLES, exactly as before the tabs
               moved here. Everyone else who reached this route (route-level Gate is now the
               real boundary) just doesn't see this section and goes straight to Detailed
               Analytics below. ──────────────────────────────────────────────────────── */}
        {isAllowed && isLoading && (
          <div className="space-y-6">
            <Skeleton h="h-40" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton />
              <Skeleton />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton h="h-64" />
              <Skeleton h="h-64" />
            </div>
            <Skeleton h="h-48" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          </div>
        )}

        {isAllowed && !isLoading && (isError || !data) && (
          <Card className="p-6 border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900">Failed to load quality data</h3>
                <p className="text-sm text-red-700 mt-1">
                  {(error as Error)?.message ?? "An unexpected error occurred. Please refresh."}
                </p>
              </div>
            </div>
          </Card>
        )}

        {isAllowed && !isLoading && data && (
          <>
            {/* Org KPI Hero */}
            <Card className="p-6 md:p-8 border-slate-200 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center">
                    <Target className="h-7 w-7 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 font-medium uppercase tracking-wide">
                      Overall Quality Score
                    </p>
                    <p className="text-5xl font-extrabold text-slate-900 leading-none mt-1">
                      {data.metrics.overall_quality_score.toFixed(1)}
                      <span className="text-2xl font-semibold text-slate-400 ml-1">%</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-6 md:ml-10">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide">Target</p>
                    <p className="text-2xl font-bold text-slate-700">{data.metrics.target_quality_score}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wide">Gap</p>
                    <p className={`text-2xl font-bold ${gapPositive ? "text-green-600" : "text-red-600"}`}>
                      {gapPositive ? "" : "+"}{(-data.metrics.gap_pct).toFixed(1)}%
                    </p>
                  </div>
                  <div className="flex items-center">
                    <Badge
                      className={`text-sm px-3 py-1 border ${statusBadge(data.metrics.status)}`}
                      variant="outline"
                    >
                      {data.metrics.status}
                    </Badge>
                  </div>
                </div>
              </div>
            </Card>

            {/* Trend Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { label: "7-Day Trend", trend: data.metrics.trend_7day },
                { label: "30-Day Trend", trend: data.metrics.trend_30day },
              ].map(({ label, trend }) => {
                const up = trend.direction === "↗" || trend.change_pct > 0;
                return (
                  <Card key={label} className="p-6 flex items-center gap-4">
                    <div
                      className={`h-12 w-12 rounded-full flex items-center justify-center ${
                        up ? "bg-green-100" : "bg-red-100"
                      }`}
                    >
                      {up ? (
                        <TrendingUp className="h-6 w-6 text-green-600" />
                      ) : (
                        <TrendingDown className="h-6 w-6 text-red-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">{label}</p>
                      <p className={`text-2xl font-bold ${up ? "text-green-600" : "text-red-600"}`}>
                        {up ? "↑" : "↓"} {Math.abs(trend.change_pct).toFixed(1)}%
                      </p>
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Top 10 and Bottom 10 Performers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Top Performers */}
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="h-5 w-5 text-green-600" />
                  <h2 className="text-lg font-semibold text-slate-800">Top Performers</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left py-2 pr-3 text-slate-400 font-medium">#</th>
                        <th className="text-left py-2 pr-3 text-slate-400 font-medium">Agent</th>
                        <th className="text-right py-2 text-slate-400 font-medium">Quality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.top_performers.map((p) => (
                        <tr key={p.agent_code} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-2 pr-3 text-slate-400">{p.rank}</td>
                          <td className="py-2 pr-3 text-slate-700">{p.agent_name}</td>
                          <td className={`py-2 text-right ${qualityColor(p.quality_score)}`}>
                            {p.quality_score.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Bottom Performers */}
              <Card className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <h2 className="text-lg font-semibold text-slate-800">Bottom Performers</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left py-2 pr-3 text-slate-400 font-medium">#</th>
                        <th className="text-left py-2 pr-3 text-slate-400 font-medium">Agent</th>
                        <th className="text-right py-2 text-slate-400 font-medium">Quality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bottom_performers.map((p) => (
                        <tr key={p.agent_code} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-2 pr-3 text-slate-400">{p.rank}</td>
                          <td className="py-2 pr-3 text-slate-700">{p.agent_name}</td>
                          <td className="py-2 text-right text-red-600 font-semibold">
                            {p.quality_score.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {/* Process Scorecard */}
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-slate-500" />
                Process Scorecard
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 pr-6 text-slate-400 font-medium">Process</th>
                      <th className="text-right py-2 pr-6 text-slate-400 font-medium">Avg Quality</th>
                      <th className="text-right py-2 text-slate-400 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.process_performance.map((row, idx) => (
                      <tr key={row.process ?? idx} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2 pr-6 text-slate-700">{row.process || "—"}</td>
                        <td className={`py-2 pr-6 text-right ${qualityColor(row.avg_quality)}`}>
                          {(row.avg_quality ?? 0).toFixed(1)}%
                        </td>
                        <td className="py-2 text-right">
                          <Badge
                            className={`text-xs px-2 py-0.5 border ${statusBadge(row.status)}`}
                            variant="outline"
                          >
                            {row.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Benchmarks */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { label: "Mean", value: data.org_benchmarks.avg_quality },
                { label: "Median", value: data.org_benchmarks.median_quality },
                { label: "Std Dev", value: data.org_benchmarks.std_deviation },
              ].map(({ label, value }) => (
                <Card key={label} className="p-6 text-center">
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
                  <p className="text-3xl font-bold text-slate-800">
                    {(value ?? 0).toFixed(2)}
                    {label !== "Std Dev" && (
                      <span className="text-lg font-medium text-slate-400 ml-0.5">%</span>
                    )}
                  </p>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* ── Detailed Analytics — everyone who reached this route sees this, independent
               of the Executive Summary's narrower ALLOWED_ROLES gate above. ─────────────── */}
        <DetailedAnalyticsSection />
      </div>
    </DashboardLayout>
  );
}
