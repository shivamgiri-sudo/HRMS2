import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, PhoneCall, TrendingUp } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  DrillDownDashboardShell,
  type DrillLevel,
  type DrillLevelResponse,
  type DrillNode,
} from "@/components/dashboards/DrillDownDashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { useUserRole, useWorkforceAccess } from "@/hooks/useUserRole";
import { DashboardInsights, computeQualityInsights } from "@/components/dashboards/DashboardInsights";
import { QualityTargetGapCard } from "@/components/quality/QualityTargetGapCard";
import {
  QualityFilterBar, QualityHeroStrip, QualityTrendPanel,
  QualityPassFailDonut, QualityFraudGrid, AgentLeaderboard,
  FailRatesBars, QualityHeatmapPanel, AgentRiskTable,
  InboundQualityPanel, ClapVocPanel, SalesFunnelPanel, AiInsightsPanel,
  today, firstOfMonth,
  type QDSummary, type TrendPoint, type AgentRow, type FraudSignals, type ClientRow,
} from "@/components/quality-dashboard/v2";

// ─── Types (drill-down shell) ─────────────────────────────────────────────────

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

function qualityTone(pct: number | null): "good" | "warn" | "bad" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 70) return "good";
  if (pct >= 50) return "warn";
  return "bad";
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

// ─── Analyst detail sheet (unchanged) ────────────────────────────────────────

interface AnalystCall {
  id: number;
  callDate: string;
  client: string | null;
  qualityPct: number | null;
  totalScore: number | null;
  maxScore: number | null;
  areasForImprovement: string | null;
}

interface AnalystCallsResponse {
  employee: { id: string; fullName: string; employeeCode: string } | null;
  calls: AnalystCall[];
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

  const chartData = (data?.calls ?? [])
    .filter((c) => c.qualityPct !== null)
    .slice()
    .reverse()
    .map((c) => ({ date: new Date(c.callDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }), quality: c.qualityPct }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data?.employee?.fullName ?? node?.name ?? "Analyst"}</SheetTitle>
          <SheetDescription>Individually audited calls, most recent first</SheetDescription>
        </SheetHeader>
        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && data && data.calls.length === 0 && (
          <div className="mt-6">
            <EmptyState title="No audited calls in range" description="This analyst has no scored calls in the selected window." />
          </div>
        )}
        {!isLoading && chartData.length > 1 && (
          <div className="mt-6 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="quality" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-6 space-y-2">
          {(data?.calls ?? []).slice(0, 50).map((c) => (
            <Card key={c.id} className="border-border/60">
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{new Date(c.callDate).toLocaleString()}</p>
                  {c.areasForImprovement && (
                    <p className="truncate text-xs text-muted-foreground">{c.areasForImprovement}</p>
                  )}
                </div>
                <Badge variant={qualityTone(c.qualityPct) === "bad" ? "destructive" : "secondary"}>
                  {c.qualityPct !== null ? `${c.qualityPct}%` : "Unscored"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Self scorecard (unchanged) ───────────────────────────────────────────────

function SelfQualityScorecard({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["quality-dashboard-v2-self", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: AnalystCallsResponse }>(
        `/api/quality-dashboard-v2/analyst/${employeeId}/calls`,
      );
      return res.data;
    },
  });

  const calls = data?.calls ?? [];
  const scored = calls.filter((c) => c.qualityPct !== null);
  const avg = scored.length
    ? Math.round((scored.reduce((s, c) => s + (c.qualityPct ?? 0), 0) / scored.length) * 10) / 10
    : null;
  const chartData = scored.slice().reverse().map((c) => ({
    date: new Date(c.callDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    quality: c.qualityPct,
  }));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading your scorecard…</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Calls audited (30d)</p><p className="mt-1 text-2xl font-semibold">{calls.length}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Average quality</p><p className={`mt-1 text-2xl font-semibold ${qualityTone(avg) === "good" ? "text-emerald-600" : qualityTone(avg) === "warn" ? "text-amber-600" : qualityTone(avg) === "bad" ? "text-rose-600" : ""}`}>{avg !== null ? `${avg}%` : "—"}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Scored calls</p><p className="mt-1 text-2xl font-semibold">{scored.length}</p></CardContent></Card>
      </div>
      {chartData.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Your quality trend</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="quality" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Role helpers ──────────────────────────────────────────────────────────────

const SELF_ONLY_ROLES = new Set(["employee", "agent", "trainee"]);


// ─── Main page ─────────────────────────────────────────────────────────────────

export default function QualityDashboard() {
  const { data: roleData } = useUserRole();
  const { hasAnyRole } = useWorkforceAccess();

  const [selectedAnalyst, setSelectedAnalyst] = useState<DrillNode | null>(null);
  const [levelData, setLevelData] = useState<DrillLevelResponse | null>(null);

  // V2 manager filter state
  const [from, setFrom]                = useState(firstOfMonth());
  const [to, setTo]                    = useState(today());
  const [clientId, setClientId]        = useState("");
  const [granularity, setGranularity]  = useState<"day" | "week">("day");
  const [refreshKey, setRefreshKey]    = useState(0);

  const isSelfOnly = !!roleData?.primaryRole && SELF_ONLY_ROLES.has(roleData.primaryRole);
  const canViewSalesRoi = hasAnyRole(
    "super_admin", "admin", "ceo", "process_manager", "operations_manager",
  );

  const rawNodes = (levelData?.raw as QualityApiNode[] | undefined) ?? [];
  const levelNoun =
    levelData
      ? ({ branch: "branch", process: "process", team: "team", analyst: "analyst" } as const)[levelData.level]
      : "branch";

  // Always-on queries — keyed on filters + refreshKey
  const qKey = [from, to, clientId, granularity, refreshKey];
  const qs   = `from=${from}&to=${to}${clientId ? `&client_id=${clientId}` : ""}`;

  const summaryQ = useQuery<QDSummary>({
    queryKey: ["qdv2-summary", ...qKey],
    queryFn: () =>
      hrmsApi
        .get<{ summary: QDSummary }>(`/api/quality-dashboard/summary?${qs}`)
        .then((r) => r.summary),
    staleTime: 5 * 60 * 1000,
    enabled: !isSelfOnly,
  });

  const clientsQ = useQuery<ClientRow[]>({
    queryKey: ["qdv2-clients", from, to],
    queryFn: () =>
      hrmsApi
        .get<{ clients: ClientRow[] }>(`/api/quality-dashboard/clients?from=${from}&to=${to}`)
        .then((r) => r.clients),
    staleTime: 10 * 60 * 1000,
    enabled: !isSelfOnly,
  });

  const trendQ = useQuery<TrendPoint[]>({
    queryKey: ["qdv2-trend", ...qKey],
    queryFn: () =>
      hrmsApi
        .get<{ trend: TrendPoint[] }>(
          `/api/quality-dashboard/trend?from=${from}&to=${to}&granularity=${granularity}`,
        )
        .then((r) => r.trend),
    staleTime: 5 * 60 * 1000,
    enabled: !isSelfOnly,
  });

  const agentsQ = useQuery<AgentRow[]>({
    queryKey: ["qdv2-agents", ...qKey],
    queryFn: () =>
      hrmsApi
        .get<{ agents: AgentRow[] }>(`/api/quality-dashboard/agents?${qs}&limit=20`)
        .then((r) => r.agents),
    staleTime: 5 * 60 * 1000,
    enabled: !isSelfOnly,
  });

  const fraudQ = useQuery<FraudSignals>({
    queryKey: ["qdv2-fraud", ...qKey],
    queryFn: () =>
      hrmsApi
        .get<{ fraud_signals: FraudSignals }>(
          `/api/quality-dashboard/fraud-signals?from=${from}&to=${to}`,
        )
        .then((r) => r.fraud_signals),
    staleTime: 5 * 60 * 1000,
    enabled: !isSelfOnly,
  });

  return (
    <DashboardLayout
      subheader={
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <p className="font-semibold">Quality</p>
        </div>
      }
    >
      <div className="relative p-4 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_50%_at_20%_0%,hsl(var(--primary)/0.08),transparent_70%),radial-gradient(45%_40%_at_85%_10%,hsl(var(--primary)/0.05),transparent_70%)]"
        />

        {/* ── Self-only view ──────────────────────────────────────────────────── */}
        {isSelfOnly && roleData?.employeeId ? (
          <SelfQualityScorecard employeeId={roleData.employeeId} />
        ) : (
          <div className="space-y-4">
            {/* ── Filter bar ───────────────────────────────────────────────────── */}
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

            {/* ── Hero strip — 7 KPI tiles ──────────────────────────────────── */}
            <QualityHeroStrip summary={summaryQ.data} loading={summaryQ.isLoading} />

            {/* ── Quality target gap (existing, unchanged) ─────────────────── */}
            <QualityTargetGapCard />

            {/* ── Primary analytics row ─────────────────────────────────────── */}
            <div className="grid gap-4 xl:grid-cols-3">
              <QualityTrendPanel
                data={trendQ.data}
                loading={trendQ.isLoading}
                error={trendQ.isError}
              />
              <div className="flex flex-col gap-4">
                <QualityPassFailDonut summary={summaryQ.data} loading={summaryQ.isLoading} />
                <QualityFraudGrid
                  data={fraudQ.data}
                  loading={fraudQ.isLoading}
                  error={fraudQ.isError}
                />
              </div>
            </div>

            {/* ── Agent intelligence row ────────────────────────────────────── */}
            <div className="grid gap-4 lg:grid-cols-2">
              <AgentLeaderboard
                agents={agentsQ.data}
                loading={agentsQ.isLoading}
                error={agentsQ.isError}
              />
              <FailRatesBars summary={summaryQ.data} loading={summaryQ.isLoading} />
            </div>

            {/* ── Tabbed deep-dive panels ───────────────────────────────────── */}
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
          </div>
        )}
      </div>

      <AnalystDetailSheet
        node={selectedAnalyst}
        open={!!selectedAnalyst}
        onOpenChange={(v) => !v && setSelectedAnalyst(null)}
      />
    </DashboardLayout>
  );
}
