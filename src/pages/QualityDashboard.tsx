import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { useUserRole } from "@/hooks/useUserRole";
import { QualityTargetGapCard } from "@/components/quality/QualityTargetGapCard";
import {
  QualityFilterBar, QualityHeroStrip, QualityTrendPanel,
  QualityPassFailDonut, QualityFraudGrid, AgentLeaderboard,
  FailRatesBars,
  today, firstOfMonth,
  type QDSummary, type TrendPoint, type AgentRow, type FraudSignals, type ClientRow,
} from "@/components/quality-dashboard/v2";

// ─── Shared helpers (also duplicated in ExecutiveQualityDashboard.tsx, which owns the
//     drill-down/analyst-detail code these used to sit beside — see Issue 6 of the
//     2026-08-17 GRN/Imprest/Vendor + dashboard-split plan) ─────────────────────────

function qualityTone(pct: number | null): "good" | "warn" | "bad" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 70) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}

// ─── Self scorecard (unchanged) ───────────────────────────────────────────────

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

  // V2 manager filter state
  const [from, setFrom]                = useState(firstOfMonth());
  const [to, setTo]                    = useState(today());
  const [clientId, setClientId]        = useState("");
  const [granularity, setGranularity]  = useState<"day" | "week">("day");
  const [refreshKey, setRefreshKey]    = useState(0);

  const isSelfOnly = !!roleData?.primaryRole && SELF_ONLY_ROLES.has(roleData.primaryRole);

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

            {/* ── Link out to the detailed analytics (Drill-Down, Heatmap, Agent Risk,
                   Inbound, CLAP VOC, Sales & Funnel, AI & ROI) — moved to the Executive
                   Quality Dashboard 2026-08-17 so this page stays a fast org-level summary
                   instead of bundling seven deep-dive panels inline. ─────────────────── */}
            <Link
              to="/quality/executive"
              className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-white/90 px-5 py-4 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800">View detailed analytics</p>
                <p className="text-xs text-slate-500">
                  Drill-down, heatmap, agent risk, inbound, CLAP VOC, and (for eligible roles) sales &amp; ROI
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
